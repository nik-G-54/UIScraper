import type { CaptureTuning, Rect } from '../../shared/types';

export interface OverlayInput {
  position: string;
  zIndex: string;
  /** Rect in VIEWPORT coordinates (document rect minus scroll offset). */
  viewportRect: Rect;
  viewport: { width: number; height: number };
}

/** Share of the viewport (0..1) covered by `rect`, clipped to the viewport. */
export function viewportCoverage(rect: Rect, viewport: { width: number; height: number }): number {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) return 0;
  const width = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const height = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / viewportArea;
}

/**
 * Likely cookie banner / modal / backdrop: fixed or sticky, a high numeric z-index, and a
 * large share of the viewport. Only flags it; nothing is removed.
 */
export function isPossibleOverlay(
  input: OverlayInput,
  tuning: Pick<CaptureTuning, 'overlayMinZIndex' | 'overlayMinViewportCoverage'>,
): boolean {
  if (input.position !== 'fixed' && input.position !== 'sticky') return false;
  const zIndex = Number.parseInt(input.zIndex, 10); // "auto" -> NaN
  if (!Number.isFinite(zIndex) || zIndex < tuning.overlayMinZIndex) return false;
  return viewportCoverage(input.viewportRect, input.viewport) >= tuning.overlayMinViewportCoverage;
}
