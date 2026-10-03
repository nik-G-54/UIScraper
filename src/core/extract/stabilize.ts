import type { CaptureTuning, ExtractionBudgets } from '../../shared/types';

export interface QuietEnv {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Call `onMutation` for every DOM change; returns a function that stops observing. */
  observe(onMutation: () => void): () => void;
}

export interface StabilizeOutcome {
  /** True if the DOM went quiet before the time cap. */
  settled: boolean;
  waitedMs: number;
}

/**
 * Resolve once the DOM has seen no mutations for `stabilizeQuietMs`, or when
 * `maxStabilizeTimeMs` has passed (settled: false), or when aborted.
 */
export function waitForQuiet(
  env: QuietEnv,
  budgets: Pick<ExtractionBudgets, 'maxStabilizeTimeMs'>,
  tuning: Pick<CaptureTuning, 'stabilizeQuietMs'>,
  signal?: AbortSignal,
): Promise<StabilizeOutcome> {
  return new Promise((resolve) => {
    const startedAt = env.now();
    let quietTimer: unknown;
    let finished = false;

    const finish = (settled: boolean) => {
      if (finished) return;
      finished = true;
      env.clearTimeout(quietTimer);
      env.clearTimeout(capTimer);
      stopObserving();
      signal?.removeEventListener('abort', onAbort);
      resolve({ settled, waitedMs: env.now() - startedAt });
    };
    const onAbort = () => finish(false);
    const armQuietTimer = () => {
      env.clearTimeout(quietTimer);
      quietTimer = env.setTimeout(() => finish(true), tuning.stabilizeQuietMs);
    };

    const stopObserving = env.observe(armQuietTimer);
    const capTimer = env.setTimeout(() => finish(false), budgets.maxStabilizeTimeMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    armQuietTimer();
  });
}
