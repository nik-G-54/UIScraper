import type { ScrollEnv } from './scroll';

/** An inner element that scrolls (as opposed to the window), ready to be driven by `autoScroll`. */
export interface ScrollContainer {
  /** e.g. "main (depth 3)". Tag and depth only: class names carry no meaning. */
  descriptor: string;
  scroll: ScrollEnv;
}

/** Measured facts about one element, enough to decide whether it is the page's scroller. */
export interface ScrollCandidate<T> {
  handle: T;
  tag: string;
  overflowY: string;
  clientHeight: number;
  scrollHeight: number;
  /** Bounding box in viewport coordinates. */
  rect: { left: number; top: number; width: number; height: number };
  /** Not display:none / visibility:hidden. */
  rendered: boolean;
}

const SCROLLING_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

export function containerDescriptor(tag: string, depth: number): string {
  return `${tag} (depth ${depth})`;
}

/** Area of `rect` that is inside the viewport (px²). */
export function visibleArea(
  rect: ScrollCandidate<unknown>['rect'],
  viewport: { width: number; height: number },
): number {
  const width = Math.min(rect.left + rect.width, viewport.width) - Math.max(rect.left, 0);
  const height = Math.min(rect.top + rect.height, viewport.height) - Math.max(rect.top, 0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The main scroll container: the candidate with the largest visible area among elements that
 * scroll vertically (overflow-y auto/scroll) and whose content clearly overflows (by at least
 * `minOverflowPx`). Returns null if there is none. Ties go to the earlier candidate.
 */
export function pickScrollContainer<T>(
  candidates: readonly ScrollCandidate<T>[],
  viewport: { width: number; height: number },
  minOverflowPx: number,
): ScrollCandidate<T> | null {
  let best: ScrollCandidate<T> | null = null;
  let bestArea = 0;
  for (const candidate of candidates) {
    if (!candidate.rendered || candidate.clientHeight <= 0) continue;
    if (!SCROLLING_OVERFLOW.has(candidate.overflowY)) continue;
    if (candidate.scrollHeight - candidate.clientHeight < minOverflowPx) continue;
    const area = visibleArea(candidate.rect, viewport);
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best;
}
