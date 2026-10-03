import { detectLoader, loadFramePath, planLoadFrameTimes } from '@/src/core/motion/frames';
import type { FrameClip, OverlayObservation, PlannedFrame } from '@/src/core/motion/frames';
import { toErrorMessage } from '@/src/shared/errors';
import type { CaptureWarning, FrameLimits, LoaderInfo, MotionFrame, MotionFrameIndex } from '@/src/shared/types';
import type { DebuggerSession } from './emulation';
import { decodeJpeg } from './screenshot';
import type { PackFile } from './zip';

/** Shared across hero, effect and load frames so the caps apply to all of them together. */
export interface FrameBudget {
  frames: number;
  bytes: number;
}

export interface FrameRun {
  index: MotionFrameIndex;
  files: PackFile[];
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Scroll the page (instantly) and return where it was. A tiny injected function; nothing else is touched. */
async function scrollPage(tabId: number, y: number): Promise<number> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (top: number) => {
      const before = window.scrollY;
      window.scrollTo({ top, left: 0, behavior: 'instant' });
      return before;
    },
    args: [y],
  });
  return typeof first?.result === 'number' ? first.result : 0;
}

/** Looks for a full-viewport fixed/absolute overlay. Self-contained: it is serialized into the page. */
async function probeOverlay(tabId: number): Promise<OverlayObservation['overlay']> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let best: { tag: string; position: string; zIndex: number; coverage: number; background: string; hasText: boolean; hasGraphic: boolean } | null = null;
      const all = document.body ? Array.from(document.body.querySelectorAll('*')).slice(0, 3000) : [];
      for (const el of all) {
        const cs = getComputedStyle(el);
        if ((cs.position !== 'fixed' && cs.position !== 'absolute') || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
        const r = el.getBoundingClientRect();
        const coverage = (Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) / (vw * vh);
        if (coverage < 0.85) continue;
        const z = Number.parseInt(cs.zIndex, 10);
        const zIndex = Number.isFinite(z) ? z : 0;
        if (cs.position === 'absolute' && zIndex < 10) continue;
        if (!best || zIndex > best.zIndex) {
          best = {
            tag: el.localName,
            position: cs.position,
            zIndex,
            coverage: Math.round(coverage * 100) / 100,
            background: cs.backgroundColor,
            hasText: (el.textContent ?? '').trim().length > 0,
            hasGraphic: el.querySelector('svg,img,canvas,video,lottie-player') !== null,
          };
        }
      }
      return best;
    },
  });
  return (first?.result as OverlayObservation['overlay']) ?? null;
}

async function waitForLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [first] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState });
      if (first?.result === 'complete') return true;
    } catch {
      // the document is being replaced; try again
    }
    await delay(200);
  }
  return false;
}

/** One JPEG, optionally cropped to a document rectangle, downscaled to `limits.maxFrameWidth`. */
async function grabFrame(session: DebuggerSession, clip: FrameClip | null, limits: Pick<FrameLimits, 'maxFrameWidth' | 'jpegQuality'>): Promise<Uint8Array> {
  const params: Record<string, unknown> = { format: 'jpeg', quality: 85 };
  if (clip) {
    params.captureBeyondViewport = true;
    params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
  }
  const shot = await withTimeout(session.send<{ data: string }>('Page.captureScreenshot', params), 6_000, 'the screenshot');
  const bitmap = await decodeJpeg(shot.data);
  try {
    const width = Math.min(limits.maxFrameWidth, bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: limits.jpegQuality / 100 });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

const capped = (budget: FrameBudget, limits: FrameLimits): boolean => budget.frames >= limits.maxFrames || budget.bytes >= limits.maxTotalBytes;

/**
 * Take the planned frames in order. The page is scrolled as planned and ALWAYS put back where it
 * was. A failed frame becomes a warning; hitting a cap stops with a warning. Never throws.
 */
export async function captureFrames(session: DebuggerSession, tabId: number, plan: readonly PlannedFrame[], limits: FrameLimits, budget: FrameBudget): Promise<FrameRun> {
  const frames: MotionFrame[] = [];
  const files: PackFile[] = [];
  const warnings: CaptureWarning[] = [];
  let original: number | null = null;
  let failures = 0;
  try {
    for (const planned of plan) {
      if (capped(budget, limits)) {
        warnings.push({ code: 'motion-frames-capped', message: `Motion frames stopped at ${budget.frames} frames / ${Math.round(budget.bytes / 1000)} kB (limits: ${limits.maxFrames} frames, ${Math.round(limits.maxTotalBytes / 1000)} kB).` });
        break;
      }
      try {
        if (planned.scrollY !== null) {
          const previous = await scrollPage(tabId, planned.scrollY);
          original ??= previous;
        }
        await delay(planned.waitMs);
        const data = await grabFrame(session, planned.clip, limits);
        files.push({ path: planned.path, data });
        frames.push({ path: planned.path, kind: planned.kind, description: planned.description });
        budget.frames++;
        budget.bytes += data.byteLength;
      } catch (error) {
        failures++;
        if (failures <= 2) warnings.push({ code: 'motion-frame-failed', message: `Frame ${planned.path} was not taken: ${toErrorMessage(error)}.` });
      }
    }
  } finally {
    if (original !== null) await scrollPage(tabId, original).catch(() => undefined);
  }
  return { index: { frames, loader: null, warnings }, files };
}

/**
 * Reload the page and film the first seconds: a frame every `loadIntervalMs`, an overlay probe at
 * each, then wait for `load`. The viewport override survives the reload because the debugger stays
 * attached. The caller re-injects the extractor afterwards (the reload destroyed it).
 */
export async function capturePageLoad(session: DebuggerSession, tabId: number, limits: FrameLimits, budget: FrameBudget): Promise<FrameRun & { loader: LoaderInfo }> {
  const frames: MotionFrame[] = [];
  const files: PackFile[] = [];
  const warnings: CaptureWarning[] = [];
  const observations: OverlayObservation[] = [];
  const times = planLoadFrameTimes(limits);
  const startedAt = performance.now();
  try {
    await session.send('Page.reload', { ignoreCache: false });
    for (const [i, t] of times.entries()) {
      await delay(Math.max(0, startedAt + t - performance.now()));
      const at = Math.round(performance.now() - startedAt);
      observations.push({ t: at, overlay: await probeOverlay(tabId).catch(() => undefined) });
      if (capped(budget, limits)) continue;
      try {
        const data = await grabFrame(session, null, limits);
        const path = loadFramePath(i);
        files.push({ path, data });
        frames.push({ path, kind: 'load', description: `Page load, about ${at}ms after the reload started` });
        budget.frames++;
        budget.bytes += data.byteLength;
      } catch (error) {
        warnings.push({ code: 'load-frame-failed', message: `A page-load frame was not taken: ${toErrorMessage(error)}.` });
      }
    }
    if (!(await waitForLoad(tabId, limits.loadTimeoutMs))) {
      warnings.push({ code: 'load-timeout', message: `The page did not finish loading within ${Math.round(limits.loadTimeoutMs / 1000)}s after the reload.` });
    }
    await delay(500);
  } catch (error) {
    warnings.push({ code: 'page-load-failed', message: `Page-load capture failed: ${toErrorMessage(error)}.` });
  }
  const loader = detectLoader(observations);
  return { index: { frames, loader, warnings }, files, loader };
}
