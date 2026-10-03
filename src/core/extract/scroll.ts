import type { CaptureTuning, ExtractionBudgets, ScrollStopReason } from '../../shared/types';
import { abortError } from './abort';

export interface ScrollEnv {
  now(): number;
  delay(ms: number): Promise<void>;
  getScrollY(): number;
  getViewportHeight(): number;
  getDocumentHeight(): number;
  /** Jump (no smooth scrolling) to a vertical offset. */
  scrollTo(y: number): void;
}

export interface ScrollOutcome {
  steps: number;
  stoppedBy: ScrollStopReason;
}

/**
 * Scroll down in viewport-sized steps so lazy content loads. Re-measures the document every
 * step, so infinite scroll keeps going until it hits the height or time budget.
 */
export async function autoScroll(
  env: ScrollEnv,
  budgets: Pick<ExtractionBudgets, 'maxScrollHeightPx' | 'maxScrollTimeMs'>,
  tuning: Pick<CaptureTuning, 'scrollStepRatio' | 'scrollStepDelayMs' | 'scrollBottomSettleMs'>,
  signal?: AbortSignal,
): Promise<ScrollOutcome> {
  const startedAt = env.now();
  let steps = 0;

  for (;;) {
    if (signal?.aborted) throw abortError();
    if (env.now() - startedAt >= budgets.maxScrollTimeMs) return { steps, stoppedBy: 'maxScrollTimeMs' };

    const y = env.getScrollY();
    const viewportHeight = env.getViewportHeight();
    const height = env.getDocumentHeight();

    // A collapsed viewport (hidden or zero-sized window) has no meaningful step size.
    if (viewportHeight <= 0) return { steps, stoppedBy: 'stuck' };

    if (y + viewportHeight >= budgets.maxScrollHeightPx && height > budgets.maxScrollHeightPx) {
      return { steps, stoppedBy: 'maxScrollHeightPx' };
    }

    if (y + viewportHeight >= height - 1) {
      // At the bottom: give lazy content a moment to extend the page before declaring victory.
      await env.delay(tuning.scrollBottomSettleMs);
      if (env.getDocumentHeight() <= height + 1) return { steps, stoppedBy: 'bottom' };
      continue;
    }

    const step = Math.max(1, Math.floor(viewportHeight * tuning.scrollStepRatio));
    const target = Math.min(y + step, Math.max(0, height - viewportHeight), budgets.maxScrollHeightPx);
    env.scrollTo(target);
    steps++;
    await env.delay(tuning.scrollStepDelayMs);

    if (env.getScrollY() <= y) return { steps, stoppedBy: 'stuck' }; // window does not scroll
  }
}
