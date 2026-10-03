/** One observation of a carousel's position (scroll offset minus track translation, along its axis). */
export interface PositionSample {
  t: number;
  pos: number;
}

export interface CarouselAnalysis {
  /** Distinct slide changes seen while watching. */
  moves: number;
  /** Typical time between the starts of consecutive changes; null with fewer than two. */
  autoplayIntervalMs: number | null;
  /** Typical duration of one change. */
  transitionMs: number | null;
  /** `forward` = position increasing (slides move left / up). */
  direction: 'forward' | 'backward' | null;
}

interface Segment {
  start: number;
  end: number;
  delta: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const round = (n: number, step: number): number => Math.round(n / step) * step;

/**
 * Work out autoplay from position samples. Movement is split into segments (gaps shorter than
 * `mergeGapMs` belong to one change); segments that moved less than 20% of a slide are jitter. A
 * long jump back (a loop rewinding over several slides) counts as a move but not as a direction.
 */
export function analyzeCarouselSamples(samples: readonly PositionSample[], slideStep: number, mergeGapMs = 150): CarouselAnalysis {
  const segments: Segment[] = [];
  let current: (Segment & { startPos: number; lastMoveT: number }) | null = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1] as PositionSample;
    const now = samples[i] as PositionSample;
    if (Math.abs(now.pos - prev.pos) > 0.5) {
      if (current && now.t - current.lastMoveT <= mergeGapMs) {
        current.end = now.t;
        current.lastMoveT = now.t;
        current.delta = now.pos - current.startPos;
      } else {
        if (current) segments.push(current);
        current = { start: prev.t, end: now.t, lastMoveT: now.t, startPos: prev.pos, delta: now.pos - prev.pos };
      }
    }
  }
  if (current) segments.push(current);

  const minMove = slideStep > 0 ? slideStep * 0.2 : 1;
  const real = segments.filter((s) => Math.abs(s.delta) >= minMove);
  const steps = real.filter((s) => slideStep <= 0 || Math.abs(s.delta) <= slideStep * 1.6);
  const forward = steps.filter((s) => s.delta > 0).length;
  const backward = steps.filter((s) => s.delta < 0).length;

  const gaps: number[] = [];
  for (let i = 1; i < real.length; i++) gaps.push((real[i] as Segment).start - (real[i - 1] as Segment).start);
  return {
    moves: real.length,
    autoplayIntervalMs: gaps.length > 0 ? round(median(gaps), 100) : null,
    transitionMs: real.length > 0 ? round(median(real.map((s) => s.end - s.start)), 10) : null,
    direction: forward === backward ? null : forward > backward ? 'forward' : 'backward',
  };
}
