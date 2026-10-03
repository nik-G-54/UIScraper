import { buildAssetIndex } from '@/src/core/assets';
import { applyNodeIds } from '@/src/core/motion/collect';
import { addComponentStates, analyzeLayout, buildTree, stateSelectors } from '@/src/core/components';
import { generateAgentPrompt, generateDesignMd } from '@/src/core/output';
import { emptyTokens, generateThemeCss, generateTokens } from '@/src/core/tokens';
import { planEffectFrames, planHeroFrames } from '@/src/core/motion/frames';
import { ASSET_LIMITS, FRAME_LIMITS, MOTION_LIMITS, OUTPUT_LIMITS, SCREENSHOT, SELECTOR_MATCH_LIMITS } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import { formatBytes } from '@/src/shared/format';
import type {
  ActiveTabInfo,
  AnalysisStep,
  AssetIndex,
  CaptureResult,
  MotionData,
  CaptureWarning,
  CssData,
  DesignTokens,
  RawImage,
  LayoutAnalysis,
  MotionFrameIndex,
  ScreenshotIndex,
  Settings,
} from '@/src/shared/types';
import { buildFileName } from '@/src/shared/url';
import { downloadAssets } from './assets';
import { captureTab, injectExtractor } from './capture';
import { collectCssData } from './css';
import { downloadBlob } from './download';
import { captureFrames, capturePageLoad } from './frames';
import type { FrameBudget } from './frames';
import { DebuggerSession, readViewport } from './emulation';
import { requestAssets, requestMotion, requestMotionIds, requestSelectorMatches } from './page';
import { takeScreenshots } from './screenshot';
import { buildZip } from './zip';
import type { PackFile } from './zip';

export interface PackResult {
  capture: CaptureResult;
  /** Null when motion capture is off or failed. */
  motion: MotionData | null;
  motionFrames: MotionFrameIndex;
  css: CssData;
  tokens: DesignTokens;
  tokensFailed: boolean;
  layout: LayoutAnalysis;
  assets: AssetIndex;
  screens: ScreenshotIndex;
  designMd: string;
  /** AGENT_PROMPT.md, ready to paste into a coding agent. */
  agentPrompt: string;
  warnings: CaptureWarning[];
  zip: { name: string; blob: Blob; fileCount: number } | null;
  /** Set when the zip was built but Chrome could not save it (the blob can be saved again). */
  saveError: string | null;
}

const MIN_DESKTOP_WIDTH = 1024;

/** Run `step`; on failure add a warning and return `fallback`. Nothing after the capture may stop the pack. */
async function attempt<T>(warnings: CaptureWarning[], code: string, what: string, fallback: T, step: () => Promise<T> | T): Promise<T> {
  try {
    return await step();
  } catch (error) {
    warnings.push({ code, message: `${what}: ${toErrorMessage(error)}.` });
    return fallback;
  }
}

function dedupe(warnings: readonly CaptureWarning[]): CaptureWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => !seen.has(w.message) && seen.add(w.message));
}

const noScreens = (): ScreenshotIndex => ({ fullPage: null, sections: [], warnings: [] });

/**
 * Generate the whole design pack for `tab`: capture (at the chosen width), CSS, tokens, layout and
 * components, assets, screenshots, design.md, zip, download. Only a failed capture stops the run;
 * every later failure becomes a warning and the zip is still produced. The viewport override and
 * the debugger are always released, success or not.
 */
export async function generatePack(
  tab: ActiveTabInfo,
  settings: Pick<Settings, 'autoScroll' | 'captureWidth' | 'captureMotion' | 'capturePageLoad'>,
  onStep: (step: AnalysisStep) => void,
): Promise<PackResult> {
  const warnings: CaptureWarning[] = [];
  let session: DebuggerSession | null = null;
  let emulated = false;
  const releaseOnPageHide = () => void session?.release();
  window.addEventListener('pagehide', releaseOnPageHide);

  let capture: CaptureResult;
  let motion: MotionData | null = null;
  const motionFrames: MotionFrameIndex = { frames: [], loader: null, warnings: [] };
  const frameBudget: FrameBudget = { frames: 0, bytes: 0 };
  const frameFiles: PackFile[] = [];
  let css: CssData;
  let tokens: DesignTokens;
  let tokensFailed: boolean;
  let layout: LayoutAnalysis = { sections: [], components: [], warnings: [] };
  let rawAssets: Awaited<ReturnType<typeof requestAssets>> | null = null;
  const posterImages: RawImage[] = [];
  let screens: ScreenshotIndex = noScreens();
  let screenFiles: PackFile[] = [];

  try {
    // 1. Width: force a desktop viewport through the debugger, or fall back to the current window.
    if (settings.captureWidth !== 'window') {
      onStep('emulating-width');
      try {
        const view = await readViewport(tab.id);
        session = await DebuggerSession.attach(tab.id);
        const { settled } = await session.emulateWidth(settings.captureWidth, Math.max(view.height, SCREENSHOT.minEmulatedHeightPx), view.devicePixelRatio);
        emulated = true;
        if (!settled) {
          warnings.push({ code: 'emulation-unsettled', message: `The page did not report a ${settings.captureWidth}px viewport in time; the capture may use another width.` });
        }
      } catch (error) {
        warnings.push({
          code: 'emulation-failed',
          message: `Could not set the capture width to ${settings.captureWidth}px (${toErrorMessage(error)}). Using the current window width instead; sites may show their mobile layout.`,
        });
        await session?.release();
        session = null;
      }
    }

    // 1b. Frames need the debugger even when the width is not forced.
    const wantsFrames = settings.captureMotion || settings.capturePageLoad;
    if (!session && wantsFrames) {
      session = await attempt<DebuggerSession | null>(warnings, 'frames-skipped', 'Motion frames and page-load capture were skipped because the debugger could not be attached', null, () => DebuggerSession.attach(tab.id));
    }

    // 1c. Page load: reload, film the first seconds, wait for load (the extractor is injected afterwards).
    if (session && settings.capturePageLoad) {
      onStep('capturing-page-load');
      const run = await capturePageLoad(session, tab.id, FRAME_LIMITS, frameBudget);
      motionFrames.frames.push(...run.index.frames);
      motionFrames.warnings.push(...run.index.warnings);
      motionFrames.loader = run.loader;
      frameFiles.push(...run.files);
    }

    // 1d. Hero frames, before any animation is paused.
    if (session && settings.captureMotion) {
      onStep('capturing-frames');
      const run = await captureFrames(session, tab.id, planHeroFrames(FRAME_LIMITS), FRAME_LIMITS, frameBudget);
      motionFrames.frames.push(...run.index.frames);
      motionFrames.warnings.push(...run.index.warnings);
      frameFiles.push(...run.files);
    }

    // 2. Motion, sampled BEFORE the animation-pause CSS of the capture is applied.
    let injected = false;
    if (settings.captureMotion) {
      onStep('sampling-motion');
      try {
        await injectExtractor(tab.id);
        injected = true;
        motion = await requestMotion(tab.id, MOTION_LIMITS);
        if (session) {
          // Effect frames: reveals, carousels and scroll-linked effects found by the scan.
          onStep('capturing-frames');
          const view = await readViewport(tab.id);
          const plan = planEffectFrames(motion, { width: view.width, height: view.height }, FRAME_LIMITS, frameBudget.frames);
          const run = await captureFrames(session, tab.id, plan, FRAME_LIMITS, frameBudget);
          motionFrames.frames.push(...run.index.frames);
          motionFrames.warnings.push(...run.index.warnings);
          frameFiles.push(...run.files);
        }
      } catch (error) {
        warnings.push({ code: 'motion-failed', message: `Motion could not be sampled: ${toErrorMessage(error)}.` });
      }
    }

    // 3. Capture (the only step whose failure ends the run).
    capture = await captureTab(
      tab,
      settings,
      (step) => {
        if (step !== 'done') onStep(step);
      },
      injected,
    );
    if (motion) {
      const sampled = motion;
      const ids = await attempt<Array<number | null> | null>(warnings, 'motion-ids-failed', 'Motion targets could not be matched to captured nodes', null, () => requestMotionIds(tab.id));
      motion = ids ? applyNodeIds(sampled, ids) : sampled;
      warnings.push(...motion.warnings);
      // Video posters are images the rebuild needs; the videos themselves are never downloaded.
      for (const video of motion.videos) {
        if (video.poster && video.target.nodeId !== null) posterImages.push({ nodeId: video.target.nodeId, url: video.poster, srcset: null, naturalWidth: 0, naturalHeight: 0, alt: 'video poster', inPicture: false });
      }
    }
    capture.meta.emulated = emulated;
    if (capture.meta.captureWidth < MIN_DESKTOP_WIDTH) {
      warnings.push({
        code: 'narrow-capture',
        message: `The page was captured at ${capture.meta.captureWidth}px wide, below ${MIN_DESKTOP_WIDTH}px, so it probably shows its mobile layout.`,
      });
    } else if (emulated && settings.captureWidth !== 'window' && capture.meta.captureWidth !== settings.captureWidth) {
      warnings.push({ code: 'width-mismatch', message: `Asked for ${settings.captureWidth}px but the page rendered at ${capture.meta.captureWidth}px.` });
    }

    // 4. CSS and tokens.
    css = await collectCssData(tab, (step) => onStep(step));
    onStep('generating-tokens');
    const generated = await attempt<DesignTokens | null>(warnings, 'tokens-failed', 'Design tokens could not be generated', null, () => generateTokens(capture, css));
    tokensFailed = generated === null;
    tokens = generated ?? emptyTokens(capture);

    // 5. Layout, components and their states.
    onStep('analyzing-layout');
    layout = await attempt(warnings, 'layout-failed', 'Layout and component analysis failed', layout, () => analyzeLayout(capture, tokens));
    const selectors = stateSelectors(css.stateRules);
    if (layout.components.length > 0 && selectors.length > 0) {
      layout = await attempt(warnings, 'states-failed', 'Hover/focus states could not be matched to components', layout, async () => {
        const matches = await requestSelectorMatches(tab.id, selectors, SELECTOR_MATCH_LIMITS);
        return addComponentStates(layout, capture, tokens, css.stateRules, matches);
      });
    }

    // 6. Assets as the page sees them, then screenshots while the debugger is still attached.
    onStep('collecting-assets');
    rawAssets = await attempt(warnings, 'assets-failed', 'Images and SVGs could not be read from the page', null, () => requestAssets(tab.id, ASSET_LIMITS));
    if (rawAssets && posterImages.length > 0) rawAssets = { ...rawAssets, images: [...rawAssets.images, ...posterImages] };

    onStep('taking-screenshots');
    if (!session) {
      session = await attempt<DebuggerSession | null>(warnings, 'screenshots-skipped', 'Screenshots were skipped because the debugger could not be attached', null, () => DebuggerSession.attach(tab.id));
    }
    if (session) {
      const shots = await takeScreenshots(session, layout.sections, capture.meta.captureWidth);
      screens = shots.index;
      screenFiles = shots.files;
    }
  } finally {
    // Always: clear the viewport override and detach, even after an error, abort or closed tab.
    window.removeEventListener('pagehide', releaseOnPageHide);
    await session?.release();
  }

  // From here on the page is no longer needed.
  onStep('downloading-assets');
  const emptyAssets: AssetIndex = { images: [], icons: [], favicons: [], fonts: [], logo: null, warnings: [] };
  let assets = await attempt(warnings, 'asset-index-failed', 'The asset index could not be built', emptyAssets, () =>
    buildAssetIndex(buildTree(capture), layout.sections, rawAssets, css),
  );
  let assetFiles: PackFile[] = [];
  const downloaded = await attempt(warnings, 'asset-download-failed', 'Downloading assets failed', null, () => downloadAssets(assets));
  if (downloaded) {
    assets = downloaded.index;
    assetFiles = downloaded.files;
    warnings.push(...downloaded.warnings);
  }

  onStep('writing-design-md');
  const themeCss = await attempt(warnings, 'theme-failed', 'theme.css could not be generated', '/* theme.css could not be generated. */\n', () => generateThemeCss(tokens));
  warnings.push(...motionFrames.warnings, ...capture.warnings, ...css.warnings, ...layout.warnings, ...assets.warnings, ...screens.warnings);
  const allWarnings = dedupe(warnings);
  const designMd = await attempt(
    allWarnings,
    'design-md-failed',
    'design.md could not be generated',
    `# Design pack\n\ndesign.md could not be generated. See tokens.json and capture.json.\n`,
    () => generateDesignMd({ capture, tokens, themeCss, css, layout, assets, screens, motion, motionFrames, warnings: allWarnings, maxChars: OUTPUT_LIMITS.maxDesignMdChars }),
  );
  const agentPrompt = await attempt(allWarnings, 'agent-prompt-failed', 'AGENT_PROMPT.md could not be generated', '# Agent prompt\n\nRead ./design/design.md and rebuild every section in its build checklist.\n', () =>
    generateAgentPrompt({
      title: capture.meta.title || capture.meta.url,
      sections: layout.sections.map((s) => ({ name: s.name, screenshot: screens.sections.find((x) => x.name === s.name)?.path ?? null })),
      libraries: motion?.libraries ?? [],
      hasMotion: motion !== null,
      hasRevealPresets: (motion?.revealPresets.length ?? 0) > 0,
      hasLoader: motionFrames.loader?.detected === true,
    }),
  );

  onStep('zipping');
  const files: PackFile[] = [
    { path: 'design.md', data: designMd },
    { path: 'AGENT_PROMPT.md', data: agentPrompt },
    { path: 'tokens.json', data: `${JSON.stringify(tokens, null, 2)}\n` },
    { path: 'theme.css', data: themeCss },
  ];
  const captureJson = JSON.stringify(motion ? { ...capture, motion, motionFrames } : capture);
  if (captureJson.length > OUTPUT_LIMITS.maxCaptureJsonBytes) {
    allWarnings.push({ code: 'capture-json-omitted', message: `capture.json is ${formatBytes(captureJson.length)}, over the ${formatBytes(OUTPUT_LIMITS.maxCaptureJsonBytes)} limit, so it was left out of the zip.` });
  } else files.push({ path: 'capture.json', data: captureJson });
  files.push(...assetFiles, ...screenFiles, ...frameFiles);

  let zip: PackResult['zip'] = null;
  let saveError: string | null = null;
  try {
    const blob = await buildZip(files);
    zip = { name: buildFileName(capture.meta.url, 'zip'), blob, fileCount: files.length };
    try {
      await downloadBlob(blob, zip.name);
    } catch (error) {
      saveError = toErrorMessage(error);
    }
  } catch (error) {
    allWarnings.push({ code: 'zip-failed', message: `The zip could not be built: ${toErrorMessage(error)}.` });
  }

  onStep('done');
  return { capture, motion, motionFrames, css, tokens, tokensFailed, layout, assets, screens, designMd, agentPrompt, warnings: allWarnings, zip, saveError };
}
