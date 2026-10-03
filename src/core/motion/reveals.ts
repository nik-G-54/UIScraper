import type { MotionTarget, RevealChange, RevealPreset, RevealRecord } from '../../shared/types';

/** The four properties a reveal changes, as computed strings. */
export interface StyleSnap {
  opacity: string;
  transform: string;
  filter: string;
  clipPath: string;
}

/** One element's observation across its intersection (times are absolute ms). */
export interface RevealSample {
  target: MotionTarget;
  /** Elements with the same parent key are siblings (for stagger). */
  parentKey: string;
  before: StyleSnap;
  after: StyleSnap;
  triggeredAt: number;
  changeStartedAt: number | null;
  changeEndedAt: number | null;
  /** `transition-duration` / `transition-timing-function` as declared, when available. */
  cssDurationMs: number | null;
  cssEasing: string | null;
}

interface Matrix {
  tx: number;
  ty: number;
  scale: number;
}

const IDENTITY: Matrix = { tx: 0, ty: 0, scale: 1 };

/** `matrix(a,b,c,d,tx,ty)` / `matrix3d(...)` / `none` -> translate and uniform scale. */
export function parseTransform(value: string): Matrix {
  const v = value.trim();
  if (!v || v === 'none') return IDENTITY;
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(v);
  if (!m) return IDENTITY;
  const n = (m[2] as string).split(',').map((x) => parseFloat(x));
  if (n.some((x) => !Number.isFinite(x))) return IDENTITY;
  if (m[1]) return { tx: n[12] ?? 0, ty: n[13] ?? 0, scale: Math.hypot(n[0] ?? 1, n[1] ?? 0) };
  return { tx: n[4] ?? 0, ty: n[5] ?? 0, scale: Math.hypot(n[0] ?? 1, n[1] ?? 0) };
}

const round = (n: number, step = 1): number => Math.round(n / step) * step;
const num = (n: number): string => String(Number(n.toFixed(2)));
const blurOf = (filter: string): number => parseFloat(/blur\(([\d.]+)px\)/.exec(filter)?.[1] ?? '0') || 0;

/** The cubic-bezier of the CSS keywords, so presets can use names. */
const EASINGS: Record<string, string> = {
  'cubic-bezier(0.25, 0.1, 0.25, 1)': 'ease',
  'cubic-bezier(0.42, 0, 1, 1)': 'ease-in',
  'cubic-bezier(0, 0, 0.58, 1)': 'ease-out',
  'cubic-bezier(0.42, 0, 0.58, 1)': 'ease-in-out',
};

export function normalizeEasing(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(/,(?![^(]*\))/)[0]?.trim() ?? '';
  return first ? (EASINGS[first] ?? first) : null;
}

/** Changes between two snapshots (only the properties that really changed). */
export function diffSnaps(before: StyleSnap, after: StyleSnap): RevealChange[] {
  const out: RevealChange[] = [];
  if (Math.abs(parseFloat(before.opacity) - parseFloat(after.opacity)) > 0.02) out.push({ property: 'opacity', from: before.opacity, to: after.opacity });
  const a = parseTransform(before.transform);
  const b = parseTransform(after.transform);
  if (Math.abs(a.tx - b.tx) > 0.5 || Math.abs(a.ty - b.ty) > 0.5 || Math.abs(a.scale - b.scale) > 0.005) out.push({ property: 'transform', from: before.transform, to: after.transform });
  if (before.filter !== after.filter) out.push({ property: 'filter', from: before.filter, to: after.filter });
  if (before.clipPath !== after.clipPath) out.push({ property: 'clip-path', from: before.clipPath, to: after.clipPath });
  return out;
}

/** `fade-up 40px`, `fade`, `slide-left 80px`, `scale-in 0.9`, `clip-reveal`, combined with `+ blur 8px`. */
export function presetName(changes: readonly RevealChange[]): string {
  const find = (p: RevealChange['property']) => changes.find((c) => c.property === p);
  const opacity = find('opacity');
  const transform = find('transform');
  const filter = find('filter');
  const parts: string[] = [];
  const fades = opacity !== undefined && parseFloat(opacity.to) > parseFloat(opacity.from);

  if (transform) {
    const from = parseTransform(transform.from);
    const to = parseTransform(transform.to);
    const dy = from.ty - to.ty; // starts below -> positive -> moves up
    const dx = from.tx - to.tx;
    const moved = Math.abs(dy) >= Math.abs(dx) ? { axis: 'y', d: dy } : { axis: 'x', d: dx };
    const moves = Math.abs(moved.d) > 0.5;
    const scaled = Math.abs(from.scale - to.scale) > 0.005;
    const base = fades ? 'fade' : 'slide';
    if (moves) {
      const dir = moved.axis === 'y' ? (moved.d > 0 ? 'up' : 'down') : moved.d > 0 ? 'left' : 'right';
      parts.push(`${base}-${dir} ${round(Math.abs(moved.d))}px`);
      if (scaled) parts.push(`scale ${num(from.scale)}→${num(to.scale)}`);
    } else if (scaled) parts.push(fades ? `fade + scale ${num(from.scale)}→${num(to.scale)}` : `scale-in ${num(from.scale)}`);
  } else if (fades) parts.push('fade');
  else if (opacity) parts.push('fade-out');
  if (parts.length === 0 && transform) parts.push('transform');
  if (filter) {
    const b = blurOf(filter.from) || blurOf(filter.to);
    parts.push(b ? `blur ${round(b)}px` : 'filter');
  }
  if (find('clip-path')) parts.push('clip-reveal');
  return parts.join(' + ') || 'change';
}

/** Median of a list (0 for none). */
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Per-sibling stagger: the typical step between consecutive siblings' own delays. */
function staggerOf(group: readonly RevealSample[]): number | null {
  const ordered = [...group].filter((s) => s.changeStartedAt !== null).sort((a, b) => a.target.index - b.target.index);
  if (ordered.length < 3) return null;
  const delays = ordered.map((s) => (s.changeStartedAt as number) - s.triggeredAt);
  const steps: number[] = [];
  for (let i = 1; i < delays.length; i++) {
    const d = (delays[i] as number) - (delays[i - 1] as number);
    if (d > 15 && d < 800) steps.push(d);
  }
  if (steps.length < 2) return null;
  return round(median(steps), 10);
}

export interface RevealSummary {
  records: RevealRecord[];
  presets: RevealPreset[];
}

/**
 * Turn raw observations into records and presets. Elements that did not change are dropped. A
 * preset groups records with the same effect, duration (50ms buckets) and easing.
 */
export function summarizeReveals(samples: readonly RevealSample[]): RevealSummary {
  const byParent = new Map<string, RevealSample[]>();
  for (const s of samples) byParent.set(s.parentKey, [...(byParent.get(s.parentKey) ?? []), s]);
  const stagger = new Map<string, number | null>();
  for (const [key, group] of byParent) stagger.set(key, staggerOf(group));

  const records: RevealRecord[] = [];
  const groups = new Map<string, { sample: RevealSample; record: RevealRecord }[]>();
  for (const sample of samples) {
    const changes = diffSnaps(sample.before, sample.after);
    if (changes.length === 0) continue;
    const measured = sample.changeStartedAt !== null && sample.changeEndedAt !== null ? sample.changeEndedAt - sample.changeStartedAt : null;
    const durationMs = sample.cssDurationMs && sample.cssDurationMs > 0 ? Math.round(sample.cssDurationMs) : measured !== null ? round(Math.max(measured, 0), 50) : null;
    const record: RevealRecord = {
      target: sample.target,
      changes,
      durationMs,
      delayMs: sample.changeStartedAt !== null ? Math.max(0, Math.round(sample.changeStartedAt - sample.triggeredAt)) : null,
      easing: normalizeEasing(sample.cssEasing),
      preset: presetName(changes),
    };
    records.push(record);
    const key = `${record.preset}|${record.durationMs === null ? '' : round(record.durationMs, 50)}|${record.easing ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), { sample, record }]);
  }

  const presets: RevealPreset[] = [...groups.values()]
    .map((members) => {
      const first = (members[0] as { record: RevealRecord }).record;
      const staggers = members.map((m) => stagger.get(m.sample.parentKey)).filter((v): v is number => typeof v === 'number');
      const staggerMs = staggers.length > 0 ? round(median(staggers), 10) : null;
      const description = [first.preset, first.durationMs !== null ? `${first.durationMs}ms` : null, first.easing, staggerMs ? `stagger ${staggerMs}ms` : null]
        .filter(Boolean)
        .join(', ');
      return {
        description,
        name: first.preset,
        count: members.length,
        durationMs: first.durationMs,
        easing: first.easing,
        staggerMs,
        targets: members.slice(0, 6).map((m) => m.record.target.index),
      };
    })
    .sort((a, b) => b.count - a.count);
  return { records, presets };
}
