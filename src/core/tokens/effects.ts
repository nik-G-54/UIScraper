import { TOKEN_TUNING } from '../../shared/config';
import type {
  BreakpointToken,
  CaptureResult,
  CssBreakpoint,
  MotionTokens,
  RadiusToken,
  ShadowToken,
} from '../../shared/types';
import { Tally, parsePx, round2, splitTopLevel } from './util';

const RADIUS_PROPS = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const;

/** Beyond this a radius is a pill; browsers report `border-radius: 9999px` as huge numbers. */
const PILL_PX = 9999;

function normalizeRadius(raw: string): RadiusToken | null {
  const first = raw.trim().split(/\s+/)[0] ?? '';
  const px = parsePx(first);
  if (px !== null) {
    if (px <= 0) return null;
    const capped = px >= PILL_PX ? PILL_PX : round2(px);
    return { value: `${capped}px`, px: capped, count: 0 };
  }
  if (/^\d*\.?\d+%$/.test(first) && parseFloat(first) > 0) return { value: first, px: null, count: 0 };
  return null;
}

/** Border radii used by nodes (each distinct value counted once per node), ascending. */
export function buildRadius(capture: CaptureResult): RadiusToken[] {
  const tally = new Tally<string>();
  const sample = new Map<string, RadiusToken>();
  for (const node of capture.nodes) {
    // A radius on a zero-size box paints nothing, so it is not part of the scale.
    if (node.styleId === null || node.rect.width <= 0 || node.rect.height <= 0) continue;
    const style = capture.styleTable[node.styleId];
    if (!style) continue;
    const seen = new Set<string>();
    for (const prop of RADIUS_PROPS) {
      const raw = style[prop];
      const token = raw === undefined ? null : normalizeRadius(raw);
      if (!token) continue;
      seen.add(token.value);
      sample.set(token.value, token);
    }
    for (const value of seen) tally.add(value);
  }
  return tally
    .top(TOKEN_TUNING.maxRadii)
    .map(([value, count]) => ({ ...(sample.get(value) as RadiusToken), count }))
    .sort((a, b) => (a.px ?? Infinity) - (b.px ?? Infinity));
}

/** Visual size of a shadow, to order small to large: |y offset| + blur of its first layer. */
export function shadowSize(value: string): number {
  const layer = splitTopLevel(value, ',')[0] ?? '';
  const numbers = [...layer.replace(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi, '').matchAll(/-?\d*\.?\d+px/g)].map(
    (m) => parseFloat(m[0]),
  );
  return Math.abs(numbers[1] ?? 0) + (numbers[2] ?? 0);
}

/** Box shadows in use, most frequent first, then ordered small to large. */
export function buildShadows(capture: CaptureResult): ShadowToken[] {
  const tally = new Tally<string>();
  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const raw = capture.styleTable[node.styleId]?.['box-shadow'];
    if (raw && raw !== 'none') tally.add(raw.replace(/\s+/g, ' ').trim());
  }
  return tally
    .top(TOKEN_TUNING.maxShadows)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => shadowSize(a.value) - shadowSize(b.value));
}

function durationMs(raw: string): number | null {
  const match = /^(\d*\.?\d+)(ms|s)$/i.exec(raw.trim());
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2]?.toLowerCase() === 's' ? 1000 : 1));
}

/** Transition durations (ms, non-zero) and the easings paired with them. */
export function buildMotion(capture: CaptureResult): MotionTokens {
  const durations = new Tally<number>();
  const easings = new Tally<string>();
  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const style = capture.styleTable[node.styleId];
    const rawDurations = style?.['transition-duration'];
    if (!rawDurations) continue;
    const list = splitTopLevel(rawDurations, ',');
    const timing = splitTopLevel(style['transition-timing-function'] ?? 'ease', ',');
    const seenDurations = new Set<number>();
    const seenEasings = new Set<string>();
    list.forEach((raw, index) => {
      const ms = durationMs(raw);
      if (ms === null || ms <= 0) return;
      seenDurations.add(ms);
      seenEasings.add(timing[index % timing.length] ?? 'ease');
    });
    for (const ms of seenDurations) durations.add(ms);
    for (const easing of seenEasings) easings.add(easing);
  }
  return {
    durations: durations
      .top(8)
      .map(([ms, count]) => ({ ms, count }))
      .sort((a, b) => a.ms - b.ms),
    easings: easings.top(5).map(([value, count]) => ({ value, count })),
  };
}

/** Width breakpoints from the CSS: min-width ones when there are at least two, else all. */
export function buildBreakpoints(found: readonly CssBreakpoint[]): BreakpointToken[] {
  const withPx = found.filter((b): b is CssBreakpoint & { px: number } => b.px !== null && b.px > 0);
  const mins = withPx.filter((b) => b.feature === 'min-width');
  const pool = new Set(mins.map((b) => Math.round(b.px))).size >= 2 ? mins : withPx;
  const tally = new Tally<number>();
  for (const b of pool) tally.add(Math.round(b.px), b.count);
  return tally
    .top(TOKEN_TUNING.maxBreakpoints)
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => a.px - b.px);
}
