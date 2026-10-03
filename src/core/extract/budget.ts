import type { BudgetName, ExtractionBudgets } from '../../shared/types';

/** Tracks the node and time limits of the DOM walk. */
export class CaptureBudget {
  private startedAt = 0;

  constructor(
    private readonly limits: Pick<ExtractionBudgets, 'maxNodes' | 'maxCaptureTimeMs'>,
    private readonly now: () => number,
  ) {}

  start(): void {
    this.startedAt = this.now();
  }

  /** The budget that has been used up, or null if capturing may continue. */
  check(capturedNodes: number): Extract<BudgetName, 'maxNodes' | 'maxCaptureTimeMs'> | null {
    if (capturedNodes >= this.limits.maxNodes) return 'maxNodes';
    if (this.now() - this.startedAt >= this.limits.maxCaptureTimeMs) return 'maxCaptureTimeMs';
    return null;
  }
}
