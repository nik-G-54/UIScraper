/** Split on `separator`, ignoring separators inside parentheses or quotes. */
export function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '' || parts.length > 0) parts.push(current.trim());
  return parts.filter((p) => p !== '');
}

/** `12.00px` -> 12; null when not a plain px length. */
export function parsePx(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)px$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Count occurrences; `key` -> times seen. */
export class Tally<K> {
  readonly counts = new Map<K, number>();
  add(key: K, by = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + by);
  }
  /** Entries by count descending (ties: insertion order). */
  top(limit = Infinity): [K, number][] {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
  get total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }
}
