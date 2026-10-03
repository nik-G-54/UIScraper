import type { FrameLimits, LoaderInfo, MotionData, MotionFrameKind, RevealRecord, ScrollEffect } from '../../shared/types';

export interface FrameClip {
  /** Document coordinates, CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One frame to take: where to scroll, how long to wait, what to crop. */
export interface PlannedFrame {
  /** `assets/motion/<name>.jpg`. */
  path: string;
  kind: MotionFrameKind;
  description: string;
  /** Scroll here first (instantly); null keeps the current position. */
  scrollY: number | null;
  /** Wait this long after scrolling (or after the previous frame) before capturing. */
  waitMs: number;
  /** Crop to this document rectangle; null captures the viewport. */
  clip: FrameClip | null;
}

const MOTION_DIR = 'assets/motion';
const pad = (n: number): string => String(n).padStart(2, '0');
const pathOf = (name: string): string => `${MOTION_DIR}/${name}.jpg`;

/** `count` viewport frames spread over `heroSpanMs`, the first after scrolling to the top. */
export function planHeroFrames(limits: Pick<FrameLimits, 'heroFrames' | 'heroSpanMs'>): PlannedFrame[] {
  const n = Math.max(0, limits.heroFrames);
  const gap = n > 1 ? Math.round(limits.heroSpanMs / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => ({
    path: pathOf(`hero-${pad(i + 1)}`),
    kind: 'hero' as const,
    description: `Top of the page, frame ${i + 1} of ${n} at about ${i * gap}ms`,
    scrollY: i === 0 ? 0 : null,
    waitMs: i === 0 ? 150 : gap,
    clip: null,
  }));
}

/** Capture times (ms after the reload started) for page-load frames: 0, interval, 2 x interval ... within the span. */
export function planLoadFrameTimes(limits: Pick<FrameLimits, 'loadIntervalMs' | 'loadSpanMs' | 'maxLoadFrames'>): number[] {
  const times: number[] = [];
  for (let t = 0; t <= limits.loadSpanMs && times.length < limits.maxLoadFrames; t += Math.max(50, limits.loadIntervalMs)) times.push(t);
  return times;
}

export const loadFramePath = (index: number): string => pathOf(`load-${pad(index + 1)}`);

const clipOf = (rect: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): FrameClip => ({
  x: Math.max(0, Math.round(rect.x)),
  y: Math.max(0, Math.round(rect.y)),
  width: Math.max(32, Math.min(Math.round(rect.width), viewport.width)),
  height: Math.max(32, Math.min(Math.round(rect.height), Math.round(viewport.height * 1.5))),
});

const labelOf = (tag: string, label: string | null): string => `<${tag}>${label ? ` “${label}”` : ''}`;

function revealFrames(motion: MotionData, viewport: { width: number; height: number }, max: number, start: number): PlannedFrame[] {
  const out: PlannedFrame[] = [];
  let n = 0;
  for (const preset of motion.revealPresets.slice(0, max)) {
    const record: RevealRecord | undefined = motion.reveals.find((r) => r.target.index === preset.targets[0]);
    if (!record) continue;
    const { rect } = record.target;
    const clip = clipOf(rect, viewport);
    n++;
    const name = `reveal-${pad(start + n)}`;
    const what = `${preset.description} on ${labelOf(record.target.tag, record.target.label)}`;
    out.push(
      {
        path: pathOf(`${name}-before`),
        kind: 'reveal',
        description: `Before: ${what}; the element just below the fold, before it scrolls into view`,
        scrollY: Math.max(0, Math.round(rect.y - viewport.height - 100)),
        waitMs: 200,
        clip,
      },
      {
        path: pathOf(`${name}-after`),
        kind: 'reveal',
        description: `After: ${what}; once the reveal has finished`,
        scrollY: Math.max(0, Math.round(rect.y - Math.max(0, viewport.height - rect.height) / 2)),
        waitMs: (record.delayMs ?? 0) + (record.durationMs ?? 600) + 400,
        clip,
      },
    );
  }
  return out;
}

function carouselFrames(motion: MotionData, viewport: { width: number; height: number }, max: number, start: number): PlannedFrame[] {
  const out: PlannedFrame[] = [];
  let n = 0;
  for (const c of motion.carousels.filter((x) => x.moves > 0).slice(0, max)) {
    n++;
    const { rect } = c.target;
    const clip = clipOf(rect, viewport);
    const scrollY = Math.max(0, Math.round(rect.y - Math.max(0, viewport.height - rect.height) / 2));
    const step = Math.min(Math.max(c.autoplayIntervalMs ?? 2000, 800), 4000);
    ['start', 'next', 'next-after'].forEach((stage, i) => {
      out.push({
        path: pathOf(`carousel-${pad(start + n)}-${i + 1}`),
        kind: 'carousel',
        description: `Carousel ${labelOf(c.target.tag, c.target.label)} (${c.slideCount} slides, every ${c.autoplayIntervalMs ?? '?'}ms): ${stage === 'start' ? 'first frame' : i === 1 ? 'one interval later' : 'two intervals later'}`,
        scrollY: i === 0 ? scrollY : null,
        waitMs: i === 0 ? 500 : step,
        clip,
      });
    });
  }
  return out;
}

const KIND_ORDER: Record<ScrollEffect['kind'], number> = { pinned: 0, parallax: 1, progress: 2, horizontal: 3 };

function scrollFrames(motion: MotionData, max: number, start: number): PlannedFrame[] {
  const out: PlannedFrame[] = [];
  const picked = [...motion.scrollEffects]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.endPx - b.startPx - (a.endPx - a.startPx))
    .slice(0, max);
  picked.forEach((effect, k) => {
    const mid = Math.round((effect.startPx + effect.endPx) / 2);
    ([['start', effect.startPx], ['middle', mid], ['end', effect.endPx]] as const).forEach(([stage, y]) => {
      out.push({
        path: pathOf(`scroll-${pad(start + k + 1)}-${stage}`),
        kind: 'scroll',
        description: `${effect.kind} on ${labelOf(effect.target.tag, effect.target.label)} at ${stage} (scroll y=${y}): ${effect.description}`,
        scrollY: Math.max(0, y),
        waitMs: 500,
        clip: null,
      });
    });
  });
  return out;
}

/**
 * Which effect frames to take, in capture order: before/after for the biggest reveal presets,
 * three frames for each moving carousel, start/middle/end for scroll-linked effects. Total frames
 * (including `reserved` ones already planned, like the hero frames) never exceed `limits.maxFrames`.
 */
export function planEffectFrames(
  motion: MotionData,
  viewport: { width: number; height: number },
  limits: Pick<FrameLimits, 'maxRevealPresets' | 'maxCarousels' | 'maxScrollEffects' | 'maxFrames'>,
  reserved = 0,
): PlannedFrame[] {
  const all = [
    ...revealFrames(motion, viewport, limits.maxRevealPresets, 0),
    ...carouselFrames(motion, viewport, limits.maxCarousels, 0),
    ...scrollFrames(motion, limits.maxScrollEffects, 0),
  ];
  return all.slice(0, Math.max(0, limits.maxFrames - reserved));
}

/** What a probe saw at one moment of the page load: a full-viewport overlay, none, or nothing known. */
export interface OverlayObservation {
  /** ms after the reload started. */
  t: number;
  overlay: { tag: string; position: string; zIndex: number; coverage: number; background: string; hasText: boolean; hasGraphic: boolean } | null | undefined;
}

/**
 * A loader is a full-viewport overlay that is present early and gone later. An overlay that is
 * still there at the end is a modal or cookie banner, not a loader. `undefined` observations
 * (the probe failed while the document was being replaced) are ignored.
 */
export function detectLoader(observations: readonly OverlayObservation[], earlyMs = 1_500, lateMs = 1_800): LoaderInfo {
  const known = observations.filter((o) => o.overlay !== undefined);
  const early = known.filter((o) => o.t <= earlyMs && o.overlay);
  const late = known.filter((o) => o.t >= lateMs);
  if (early.length === 0) return { detected: false, visibleForMs: null, description: 'No full-viewport overlay was seen while the page loaded.' };
  if (late.length === 0 || late.some((o) => o.overlay)) {
    return { detected: false, visibleForMs: null, description: 'A full-viewport overlay was present at the end of the load, so it is probably a modal or banner rather than a loader.' };
  }
  const last = [...known].reverse().find((o) => o.overlay);
  const seen = early[0]?.overlay;
  const how = seen ? `${seen.position} <${seen.tag}> (z-index ${seen.zIndex}, background ${seen.background}${seen.hasText ? ', contains text' : ''}${seen.hasGraphic ? ', contains an image/SVG/canvas' : ''})` : 'overlay';
  return {
    detected: true,
    visibleForMs: last ? Math.round(last.t) : null,
    description: `Loader: a full-viewport ${how}, visible until about ${Math.round(last?.t ?? 0)}ms after the reload, then removed.`,
  };
}
