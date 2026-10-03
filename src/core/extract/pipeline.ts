import type { PipelineStep, ProgressStep } from '../../shared/types';
import type { ScrollOutcome } from './scroll';
import type { StabilizeOutcome } from './stabilize';
import { abortError } from './abort';

export interface PipelineSteps<C> {
  /** Remember whatever must be restored later (e.g. the scroll position). */
  prepare(): void | Promise<void>;
  scroll(): Promise<ScrollOutcome>;
  stabilize(): Promise<StabilizeOutcome>;
  /** Back to the top for consistent coordinates, then capture. */
  capture(): Promise<C>;
  /**
   * Undo every temporary change. Each function runs even if an earlier one (or the capture)
   * threw; failures are reported, never rethrown.
   */
  cleanups: Array<() => void>;
}

export interface PipelineOutcome<C> {
  capture: C;
  scroll: ScrollOutcome;
  stabilize: StabilizeOutcome;
  durationsMs: Record<PipelineStep, number>;
  cleanupErrors: string[];
}

/**
 * prepare -> scroll -> stabilize -> capture, with cleanup in a `finally` so the page is always
 * restored. If both the capture and a cleanup fail, the capture's error is the one thrown.
 */
export async function runPipeline<C>(
  steps: PipelineSteps<C>,
  options: { autoScroll: boolean; onProgress: (step: ProgressStep) => void; now: () => number; signal?: AbortSignal },
): Promise<PipelineOutcome<C>> {
  const { onProgress, now, signal } = options;
  const durationsMs: Record<PipelineStep, number> = { prepare: 0, scroll: 0, stabilize: 0, capture: 0, cleanup: 0 };
  const cleanupErrors: string[] = [];

  const timed = async <T>(step: PipelineStep, work: () => T | Promise<T>): Promise<T> => {
    const startedAt = now();
    try {
      return await work();
    } finally {
      durationsMs[step] = Math.round(now() - startedAt);
    }
  };
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };

  try {
    await timed('prepare', () => steps.prepare());
    checkAbort();

    let scroll: ScrollOutcome = { steps: 0, stoppedBy: 'disabled' };
    if (options.autoScroll) {
      onProgress('scrolling');
      scroll = await timed('scroll', () => steps.scroll());
      checkAbort();
    }

    onProgress('stabilizing');
    const stabilize = await timed('stabilize', () => steps.stabilize());
    checkAbort();

    onProgress('capturing');
    const capture = await timed('capture', () => steps.capture());

    return { capture, scroll, stabilize, durationsMs, cleanupErrors };
  } finally {
    onProgress('cleaning-up');
    const startedAt = now();
    for (const cleanup of steps.cleanups) {
      try {
        cleanup();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    durationsMs.cleanup = Math.round(now() - startedAt);
  }
}
