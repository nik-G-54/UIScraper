import type { CaptureTuning, ExtractionBudgets, ScrollTarget } from '../../shared/types';
import { autoScroll } from './scroll';
import type { ScrollEnv, ScrollOutcome } from './scroll';
import type { ScrollContainer } from './scrollContainer';

export interface ScrollRunOutcome extends ScrollOutcome {
  target: ScrollTarget;
  /** Descriptor of the inner container, or null when the window was scrolled. */
  container: string | null;
}

export interface ScrollTargets {
  window: ScrollEnv;
  /** Look for the page's main inner scroll container (only called when the window is no use). */
  findContainer(): ScrollContainer | null;
  /** Called with the container before it is scrolled, so the caller can register its restore. */
  onContainer?(container: ScrollContainer): void;
}

/** Can the window scroll by a meaningful amount? */
export function windowCanScroll(window: ScrollEnv, minOverflowPx: number): boolean {
  return window.getDocumentHeight() - window.getViewportHeight() >= minOverflowPx;
}

/**
 * Lazy-load scrolling. Scrolls the window when it can scroll meaningfully. If it cannot, or it
 * gets stuck (e.g. `overflow: hidden` on the root), falls back to the main inner scroll
 * container. The container run gets whatever is left of the scroll time budget, so the total
 * never exceeds `maxScrollTimeMs`.
 */
export async function lazyScroll(
  targets: ScrollTargets,
  budgets: Pick<ExtractionBudgets, 'maxScrollHeightPx' | 'maxScrollTimeMs'>,
  tuning: Pick<CaptureTuning, 'scrollStepRatio' | 'scrollStepDelayMs' | 'scrollBottomSettleMs' | 'scrollMinOverflowPx'>,
  signal?: AbortSignal,
): Promise<ScrollRunOutcome> {
  const { window } = targets;
  const startedAt = window.now();

  const windowScrolls = windowCanScroll(window, tuning.scrollMinOverflowPx);
  let outcome: ScrollOutcome = { steps: 0, stoppedBy: 'bottom' };
  if (windowScrolls) outcome = await autoScroll(window, budgets, tuning, signal);

  if (windowScrolls && outcome.stoppedBy !== 'stuck') {
    return { ...outcome, target: 'window', container: null };
  }

  const container = targets.findContainer();
  if (!container) return { ...outcome, target: 'window', container: null };

  targets.onContainer?.(container);
  const remainingMs = Math.max(0, budgets.maxScrollTimeMs - (window.now() - startedAt));
  const inner = await autoScroll(container.scroll, { ...budgets, maxScrollTimeMs: remainingMs }, tuning, signal);
  return {
    steps: outcome.steps + inner.steps,
    stoppedBy: inner.stoppedBy,
    target: 'container',
    container: container.descriptor,
  };
}
