/** 32-bit FNV-1a of a string, as 8 hex digits. Stable, fast and good enough to tell shapes apart. */
export function hashString(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Combine numbers into one 32-bit hash (order matters). */
export function hashNumbers(values: readonly number[], seed = 0x811c9dc5): number {
  let h = seed;
  for (const v of values) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}
