import type { MotionTarget, ScrollEffect } from '../../shared/types';

/** One sample of a candidate element at one scroll position. */
export interface ScrollPoint {
  scrollY: number;
  /** Viewport-relative top of the element. */
  top: number;
  tx: number;
  ty: number;
  scale: number;
  opacity: number;
  /** First number of the clip-path, or null when there is none. */
  clip: number | null;
}

export interface ScrollSeries {
  target: MotionTarget;
  width: number;
  height: number;
  points: ScrollPoint[];
}

/** Least-squares line y = slope * x + intercept, with the coefficient of determination. */
export function fitLine(xs: readonly number[], ys: readonly number[]): { slope: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, r2: 0 };
  // A flat y is explained perfectly by a flat line.
  return { slope: sxy / sxx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

const range = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values));
const r2px = (n: number): number => Math.round(n);
const r2dec = (n: number): number => Math.round(n * 100) / 100;

/** Longest run of consecutive points whose viewport top stays within `tolerance` of the run's first point. */
function longestPinnedRun(points: readonly ScrollPoint[], tolerance: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const broken = i === points.length || Math.abs((points[i] as ScrollPoint).top - (points[start] as ScrollPoint).top) > tolerance;
    if (!broken) continue;
    if (i - 1 - start >= 2 && (!best || i - 1 - start > best.end - best.start)) best = { start, end: i - 1 };
    start = i;
  }
  return best;
}

/** Monotonic (within tolerance) with real intermediate values, not a 0 -> 1 jump. */
function steadyChange(values: readonly number[], minRange: number): boolean {
  const total = range(values);
  if (total < minRange) return false;
  const dir = (values[values.length - 1] as number) >= (values[0] as number) ? 1 : -1;
  const tol = total * 0.05;
  for (let i = 1; i < values.length; i++) if (dir * ((values[i] as number) - (values[i - 1] as number)) < -tol) return false;
  const lo = Math.min(...values) + total * 0.1;
  const hi = Math.max(...values) - total * 0.1;
  return values.filter((v) => v > lo && v < hi).length >= 2;
}

/** Scroll positions between which `values` go from the start value to the end value. */
function changeRange(points: readonly ScrollPoint[], values: readonly number[], tol: number): { startPx: number; endPx: number } {
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  const begin = values.findIndex((v) => Math.abs(v - first) > tol);
  let endIndex = values.length - 1;
  while (endIndex > 0 && Math.abs((values[endIndex] as number) - last) <= tol) endIndex--;
  const a = (points[Math.max(0, begin - 1)] as ScrollPoint).scrollY;
  const b = (points[Math.min(points.length - 1, endIndex + 1)] as ScrollPoint).scrollY;
  return { startPx: r2px(a), endPx: r2px(b) };
}

/**
 * Classify scroll-linked behavior from samples taken at evenly spaced scroll positions: pinned
 * (the viewport position stays constant over a range), horizontal travel (tx proportional to
 * scroll), parallax (moves at a constant fraction of the scroll speed) and progress-linked
 * opacity/scale/clip. Ranges are in document px (scroll positions). A full-width bar that stays
 * pinned for the whole page is a sticky header, not a storytelling effect, and is skipped.
 */
export function classifyScrollEffects(series: readonly ScrollSeries[], viewport: { width: number; height: number }): ScrollEffect[] {
  const out: ScrollEffect[] = [];
  for (const s of series) {
    const pts = [...s.points].sort((a, b) => a.scrollY - b.scrollY);
    if (pts.length < 4) continue;
    const ys = pts.map((p) => p.scrollY);
    const effect = (kind: ScrollEffect['kind'], startPx: number, endPx: number, ratio: number | null, properties: string[], description: string) =>
      out.push({ kind, target: s.target, startPx, endPx, ratio, properties, description });

    const pinned = longestPinnedRun(pts, 2);
    if (pinned) {
      const first = pts[pinned.start] as ScrollPoint;
      const last = pts[pinned.end] as ScrollPoint;
      const span = last.scrollY - first.scrollY;
      const wholePage = pinned.start === 0 && pinned.end === pts.length - 1;
      const bar = s.width >= viewport.width * 0.9 && s.height <= 150;
      if (wholePage && bar) continue;
      if (span >= viewport.height * 0.5) {
        effect('pinned', r2px(first.scrollY), r2px(last.scrollY), null, [], `pinned at ${r2px(first.top)}px from the viewport top for ${r2px(span)}px of scrolling`);
        continue;
      }
    }

    const tx = fitLine(ys, pts.map((p) => p.tx));
    if (range(pts.map((p) => p.tx)) >= 100 && range(pts.map((p) => p.ty)) < 50 && Math.abs(tx.slope) >= 0.2 && tx.r2 >= 0.95) {
      const { startPx, endPx } = changeRange(pts, pts.map((p) => p.tx), 1);
      effect('horizontal', startPx, endPx, r2dec(Math.abs(tx.slope)), [], `horizontal scroll: moves ${r2dec(Math.abs(tx.slope))}px sideways per px scrolled (${tx.slope < 0 ? 'leftwards' : 'rightwards'})`);
      continue;
    }

    const visible = pts.filter((p) => p.top > -s.height && p.top < viewport.height);
    if (visible.length >= 4) {
      const fit = fitLine(visible.map((p) => p.scrollY), visible.map((p) => p.top));
      const ratio = fit.slope + 1;
      if (fit.r2 >= 0.98 && Math.abs(ratio) >= 0.05 && (ratio < 0 || ratio < 0.95)) {
        effect('parallax', r2px((visible[0] as ScrollPoint).scrollY), r2px((visible[visible.length - 1] as ScrollPoint).scrollY), r2dec(ratio), [], `parallax: offset ${r2dec(ratio)}px per px scrolled (element moves at ${r2dec(-fit.slope)}× the scroll speed)`);
        continue;
      }
    }

    const props: string[] = [];
    let range_: { startPx: number; endPx: number } | null = null;
    const opacity = pts.map((p) => p.opacity);
    const scale = pts.map((p) => p.scale);
    const clip = pts.every((p) => p.clip !== null) ? pts.map((p) => p.clip as number) : null;
    if (steadyChange(opacity, 0.3)) {
      props.push('opacity');
      range_ = changeRange(pts, opacity, 0.02);
    }
    if (steadyChange(scale, 0.1)) {
      props.push('scale');
      range_ ??= changeRange(pts, scale, 0.01);
    }
    if (clip && steadyChange(clip, 5)) {
      props.push('clip-path');
      range_ ??= changeRange(pts, clip, 0.5);
    }
    if (props.length > 0 && range_) {
      effect('progress', range_.startPx, range_.endPx, null, props, `${props.join(' + ')} change steadily with scroll between y=${range_.startPx} and y=${range_.endPx}`);
    }
  }
  return out;
}
