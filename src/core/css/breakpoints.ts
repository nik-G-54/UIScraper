import type { CssBreakpoint } from '../../shared/types';

type Found = Omit<CssBreakpoint, 'count'>;

const LENGTH = /^(-?\d*\.?\d+)(px|em|rem)$/i;

/** Pixels for px/em/rem (em and rem both 16px); null for anything else. */
export function lengthToPx(value: string): number | null {
  const match = LENGTH.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return match[2]?.toLowerCase() === 'px' ? n : n * 16;
}

function found(feature: Found['feature'], raw: string): Found {
  const value = raw.trim().toLowerCase();
  return { feature, value, px: lengthToPx(value) };
}

/**
 * Width breakpoints used by one media query: `(min-width: 48rem)`, `(max-width: 600px)`, and the
 * range syntax `(width >= 48rem)`, `(600px <= width <= 900px)`.
 */
export function parseBreakpoints(mediaQuery: string): Found[] {
  const out: Found[] = [];
  for (const m of mediaQuery.matchAll(/\(\s*(min|max)-width\s*:\s*([^)\s]+)\s*\)/gi)) {
    out.push(found(m[1]?.toLowerCase() === 'min' ? 'min-width' : 'max-width', m[2] ?? ''));
  }
  for (const m of mediaQuery.matchAll(/\(\s*width\s*(>=|>|<=|<)\s*([^)\s]+)\s*\)/gi)) {
    out.push(found(m[1]?.startsWith('>') ? 'min-width' : 'max-width', m[2] ?? ''));
  }
  for (const m of mediaQuery.matchAll(/\(\s*([^()\s]+)\s*(<=|<|>=|>)\s*width\s*(?:(<=|<|>=|>)\s*([^()\s]+)\s*)?\)/gi)) {
    out.push(found(m[2]?.startsWith('<') ? 'min-width' : 'max-width', m[1] ?? ''));
    if (m[3] && m[4]) out.push(found(m[3].startsWith('<') ? 'max-width' : 'min-width', m[4]));
  }
  return out;
}
