import { TOKEN_TUNING } from '../../shared/config';
import type { CaptureResult, ScaleValue, SpacingTokens } from '../../shared/types';
import { Tally, parsePx, round2 } from './util';

const SPACING_PROPS = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'row-gap',
  'column-gap',
] as const;

function multipleOf(value: number, unit: number): boolean {
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) * unit < 0.01;
}

/**
 * Is the spacing built on a 4px or 8px grid? 8 wins when at least `baseUnitCoverage` of the
 * (weighted) values are multiples of 8, else 4 under the same rule, else none. Values at or
 * below `baseUnitMinPx` are noise (hairlines, optical nudges) and ignored. `coverage` is for the
 * chosen unit, or for 4 when there is none.
 */
export function detectBaseUnit(
  values: readonly ScaleValue[],
  minCoverage: number = TOKEN_TUNING.baseUnitCoverage,
  minPx: number = TOKEN_TUNING.baseUnitMinPx,
): { baseUnit: 4 | 8 | null; coverage: number } {
  const usable = values.filter((v) => v.px > minPx);
  const total = usable.reduce((sum, v) => sum + v.count, 0);
  if (usable.length < 2 || total === 0) return { baseUnit: null, coverage: 0 };
  const coverage = (unit: number) =>
    usable.filter((v) => multipleOf(v.px, unit)).reduce((sum, v) => sum + v.count, 0) / total;
  const c8 = coverage(8);
  if (c8 >= minCoverage) return { baseUnit: 8, coverage: round2(c8) };
  const c4 = coverage(4);
  return { baseUnit: c4 >= minCoverage ? 4 : null, coverage: round2(c4) };
}

/** Margin / padding / gap values (px, per node) with frequency, plus the detected base unit. */
export function buildSpacing(capture: CaptureResult): SpacingTokens {
  const tally = new Tally<number>();
  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const style = capture.styleTable[node.styleId];
    if (!style) continue;
    const seen = new Set<number>();
    for (const prop of SPACING_PROPS) {
      const px = parsePx(style[prop]);
      if (px !== null && px > 0 && px <= TOKEN_TUNING.maxSpacingPx) seen.add(round2(px));
    }
    for (const px of seen) tally.add(px);
  }

  const all: ScaleValue[] = [...tally.counts].map(([px, count]) => ({ px, count }));
  const { baseUnit, coverage } = detectBaseUnit(all);
  const repeated = all.filter((v) => v.count >= 2);
  const pool = repeated.length >= 3 ? repeated : all;
  const scale = pool
    .sort((a, b) => b.count - a.count || a.px - b.px)
    .slice(0, TOKEN_TUNING.maxSpacingValues)
    .sort((a, b) => a.px - b.px);
  return { baseUnit, coverage, scale };
}
