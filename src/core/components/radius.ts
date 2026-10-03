import type { Rect, StyleRecord } from '../../shared/types';
import { parsePx } from '../tokens/util';

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

export interface RadiusInfo {
  /** Exact computed value (`8px`, `50%`, `8px 8px 0px 0px`), null when the element is square. */
  value: string | null;
  /** True only when the vertical radius is at least half the element's height. */
  pill: boolean;
}

/** Vertical radius in px of one corner value (`8px`, `50%`, `8px 4px`), or null when unreadable. */
function verticalRadiusPx(corner: string, height: number): number | null {
  const parts = corner.trim().split(/\s+/);
  const vertical = parts[1] ?? parts[0] ?? '';
  if (vertical.endsWith('%')) {
    const pct = parseFloat(vertical);
    return Number.isFinite(pct) ? (pct / 100) * height : null;
  }
  return parsePx(vertical);
}

const isZero = (corner: string): boolean => corner.trim().split(/\s+/).every((p) => parseFloat(p) === 0);

/**
 * The exact border-radius of an element. "Pill" is reserved for radii of at least half the height
 * (all four corners), so a 12px radius on a 200px card is never called a pill.
 */
export function radiusInfo(style: StyleRecord, rect: Pick<Rect, 'height'>): RadiusInfo {
  const corners = CORNERS.map((c) => style[`border-${c}-radius`]);
  if (corners.every((c) => c === undefined || isZero(c))) return { value: null, pill: false };
  const resolved = corners.map((c) => c ?? '0px');
  const first = resolved[0] as string;
  const value = resolved.every((c) => c === first) ? first : resolved.join(' ');
  const half = rect.height / 2;
  const pill =
    rect.height > 0 &&
    resolved.every((c) => {
      const px = verticalRadiusPx(c, rect.height);
      return px !== null && px >= half - 0.01;
    });
  return { value, pill };
}

/** `9999px (pill)` / `8px` / `none`, for design.md. */
export function describeRadius(info: RadiusInfo): string {
  if (info.value === null) return 'none';
  return info.pill ? `${info.value} (pill)` : info.value;
}
