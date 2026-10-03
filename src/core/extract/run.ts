import type { CaptureOptions, CaptureResult, CaptureWarning, ProgressStep } from '../../shared/types';
import type { DefaultStyleSource } from './defaults';
import { runPipeline } from './pipeline';
import { assembleResult, collectMeta } from './result';
import type { MetaWindow } from './result';
import type { ScrollEnv } from './scroll';
import type { ScrollContainer } from './scrollContainer';
import { lazyScroll } from './scrollTarget';
import { waitForQuiet } from './stabilize';
import type { QuietEnv } from './stabilize';
import { STYLE_PROPERTIES } from './styleProps';
import { captureDom } from './walker';
import type { CaptureEnv } from './walker';

/** The page, as seen by the capture pipeline. `createBrowserEnv` provides the real one. */
export interface RunEnv extends CaptureEnv {
  win: MetaWindow;
  /** The window. */
  scroll: ScrollEnv;
  /** The page's main inner scroll container, if it has one. */
  findScrollContainer(minOverflowPx: number): ScrollContainer | null;
  quiet: QuietEnv;
  /** Jump (instantly) to an absolute scroll position. */
  scrollToPosition(x: number, y: number): void;
  createDefaults(props: readonly string[]): DefaultStyleSource;
}

/**
 * Run the whole capture: remember scroll -> lazy-load scroll -> stabilize -> scroll to top ->
 * capture -> cleanup (always). Everything temporary is undone in cleanup, success or not.
 */
export async function runCapture(
  env: RunEnv,
  options: CaptureOptions,
  onProgress: (step: ProgressStep) => void,
  signal?: AbortSignal,
  /** Receives the node id -> element map of this capture (kept page-side for selector matching). */
  onElements?: (elements: Map<number, Element>) => void,
): Promise<CaptureResult> {
  const { budgets, tuning } = options;
  let original = { x: 0, y: 0 };
  let defaults: DefaultStyleSource | null = null;
  // Filled in as soon as an inner container is chosen, so cleanup can always put its scrollTop back.
  let inner: { scroll: ScrollEnv; originalTop: number } | null = null;
  const walkerEnv: CaptureEnv = { ...env, signal };

  const outcome = await runPipeline(
    {
      prepare: () => {
        original = env.getScroll();
      },
      scroll: () =>
        lazyScroll(
          {
            window: env.scroll,
            findContainer: () => env.findScrollContainer(tuning.scrollMinOverflowPx),
            onContainer: (found) => {
              inner = { scroll: found.scroll, originalTop: found.scroll.getScrollY() };
            },
          },
          budgets,
          tuning,
          signal,
        ),
      stabilize: () => waitForQuiet(env.quiet, budgets, tuning, signal),
      capture: async () => {
        env.scrollToPosition(0, 0);
        inner?.scroll.scrollTo(0);
        await env.scroll.delay(tuning.scrollSettleMs);
        defaults = env.createDefaults(STYLE_PROPERTIES);
        const meta = collectMeta(env.doc, env.win);
        const dom = await captureDom(walkerEnv, budgets, tuning, defaults);
        return { meta, dom };
      },
      cleanups: [
        () => env.scrollToPosition(original.x, original.y),
        () => inner?.scroll.scrollTo(inner.originalTop),
        () => defaults?.dispose(),
      ],
    },
    { autoScroll: options.autoScroll, onProgress, now: env.now, signal },
  );

  onElements?.(outcome.capture.dom.elements);
  const extraWarnings: CaptureWarning[] = outcome.cleanupErrors.map((message) => ({
    code: 'cleanup-failed',
    message: `Cleanup problem: ${message}`,
  }));
  return assembleResult({
    meta: outcome.capture.meta,
    dom: outcome.capture.dom,
    scroll: outcome.scroll,
    stabilize: outcome.stabilize,
    durationsMs: outcome.durationsMs,
    extraWarnings,
  });
}
