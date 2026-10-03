import { planClips, planCrops } from '@/src/core/assets';
import { SCREENSHOT } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import type { CaptureWarning, PageSection, ScreenshotIndex } from '@/src/shared/types';
import type { DebuggerSession } from './emulation';
import type { PackFile } from './zip';

interface LayoutMetrics {
  cssContentSize?: { width: number; height: number };
  contentSize?: { width: number; height: number };
}

async function decodeJpeg(base64: string): Promise<ImageBitmap> {
  const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
  return createImageBitmap(blob);
}

async function toJpegBytes(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: SCREENSHOT.jpegQuality / 100 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Screenshot the whole document through the debugger (captureBeyondViewport: no scrolling, nothing
 * hidden), in clips of at most `maxClipHeightPx` that are stitched on an OffscreenCanvas, then
 * crop one JPEG per section. Never throws: failures become warnings and whatever was made is returned.
 */
export async function takeScreenshots(
  session: DebuggerSession,
  sections: readonly PageSection[],
  captureWidth: number,
): Promise<{ index: ScreenshotIndex; files: PackFile[] }> {
  const warnings: CaptureWarning[] = [];
  const files: PackFile[] = [];
  const index: ScreenshotIndex = { fullPage: null, sections: [], warnings };

  try {
    const metrics = await session.send<LayoutMetrics>('Page.getLayoutMetrics');
    const size = metrics.cssContentSize ?? metrics.contentSize;
    if (!size) throw new Error('the page did not report its size');
    const width = Math.max(1, Math.round(captureWidth));
    const { clips, capped } = planClips(size.height, SCREENSHOT.maxClipHeightPx, SCREENSHOT.maxDocHeightPx);
    const height = clips.reduce((sum, clip) => sum + clip.height, 0);
    if (capped) {
      warnings.push({
        code: 'screenshot-capped',
        message: `The page is ${Math.round(size.height)}px tall; screenshots only cover the first ${SCREENSHOT.maxDocHeightPx}px.`,
      });
    }

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('could not create a canvas');
    for (const clip of clips) {
      const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
        format: 'jpeg',
        quality: SCREENSHOT.jpegQuality,
        captureBeyondViewport: true,
        clip: { x: 0, y: clip.y, width, height: clip.height, scale: 1 },
      });
      const bitmap = await decodeJpeg(shot.data);
      // Drawn at CSS-pixel size, so a high-DPR render is normalized and crops line up with section rects.
      context.drawImage(bitmap, 0, clip.y, width, clip.height);
      bitmap.close();
    }

    files.push({ path: 'assets/screens/full-page.jpg', data: await toJpegBytes(canvas) });
    index.fullPage = { name: 'full-page', path: 'assets/screens/full-page.jpg' };

    const crops = planCrops(sections, width, height, SCREENSHOT.maxCropHeightPx, SCREENSHOT.maxSectionShots);
    let cutCount = 0;
    for (const [i, crop] of crops.entries()) {
      try {
        const piece = new OffscreenCanvas(crop.width, crop.height);
        piece.getContext('2d')?.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const slug = crop.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
        const path = `assets/screens/${String(i + 1).padStart(2, '0')}-${slug}.jpg`;
        files.push({ path, data: await toJpegBytes(piece) });
        index.sections.push({ name: crop.name, path });
        if (crop.cut) cutCount++;
      } catch (error) {
        warnings.push({ code: 'screenshot-crop-failed', message: `Could not crop the “${crop.name}” section: ${toErrorMessage(error)}.` });
      }
    }
    if (cutCount > 0) {
      warnings.push({ code: 'screenshot-crop-cut', message: `${cutCount} section screenshot(s) were cut at ${SCREENSHOT.maxCropHeightPx}px tall.` });
    }
    if (sections.length > SCREENSHOT.maxSectionShots) {
      warnings.push({ code: 'screenshot-section-limit', message: `Only the first ${SCREENSHOT.maxSectionShots} sections have their own screenshot.` });
    }
  } catch (error) {
    warnings.push({ code: 'screenshot-failed', message: `Screenshots were not taken: ${toErrorMessage(error)}.` });
  }
  return { index, files };
}
