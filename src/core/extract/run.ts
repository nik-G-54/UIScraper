import type { CaptureOptions, CaptureResult, CaptureWarning, ProgressStep } from '../../shared/types';
import type { DefaultStyleSource } from './defaults';
import { runPipeline } from './pipeline';
import { assembleResult, collectMeta } from './result';
import type { MetaWindow } from './result';
import { autoScroll } from './scroll';
import type { ScrollEnv } from './scroll';
import { waitForQuiet } from './stabilize';
import type { QuietEnv } from './stabilize';
import { STYLE_PROPERTIES } from './styleProps';
import { captureDom } from './walker';
import type { CaptureEnv } from './walker';

/** The page, as seen by the capture pipeline. `createBrowserEnv` provides the real one. */
export interface RunEnv extends CaptureEnv {
  win: MetaWindow;
  scroll: ScrollEnv;
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
): Promise<CaptureResult> {
  const { budgets, tuning } = options;
  let original = { x: 0, y: 0 };
  let defaults: DefaultStyleSource | null = null;
  const walkerEnv: CaptureEnv = { ...env, signal };

  const outcome = await runPipeline(
    {
      prepare: () => {
        original = env.getScroll();
      },
      scroll: () => autoScroll(env.scroll, budgets, tuning, signal),
      stabilize: () => waitForQuiet(env.quiet, budgets, tuning, signal),
      capture: async () => {
        env.scrollToPosition(0, 0);
        await env.scroll.delay(tuning.scrollSettleMs);
        defaults = env.createDefaults(STYLE_PROPERTIES);
        const meta = collectMeta(env.doc, env.win);
        const dom = await captureDom(walkerEnv, budgets, tuning, defaults);
        return { meta, dom };
      },
      cleanups: [
        () => env.scrollToPosition(original.x, original.y),
        () => defaults?.dispose(),
      ],
    },
    { autoScroll: options.autoScroll, onProgress, now: env.now, signal },
  );

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
