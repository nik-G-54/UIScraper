import type { PageProbeData } from '../../shared/types';

const NUMERIC_FIELDS = [
  'nodeCount',
  'viewportWidth',
  'viewportHeight',
  'devicePixelRatio',
  'documentHeight',
] as const;

/** Narrow data that crossed a context boundary; returns null if it is malformed. */
export function parsePageProbeData(raw: unknown): PageProbeData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.url !== 'string' || typeof r.timestamp !== 'string') {
    return null;
  }
  const numbers: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    const value = r[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    numbers[field] = value;
  }
  return {
    title: r.title,
    url: r.url,
    timestamp: r.timestamp,
    nodeCount: numbers.nodeCount as number,
    viewportWidth: numbers.viewportWidth as number,
    viewportHeight: numbers.viewportHeight as number,
    devicePixelRatio: numbers.devicePixelRatio as number,
    documentHeight: numbers.documentHeight as number,
  };
}
