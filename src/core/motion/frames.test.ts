import { describe, expect, it } from 'vitest';
import { FRAME_LIMITS } from '../../shared/config';
import type { MotionData, MotionTarget } from '../../shared/types';
import { detectLoader, planEffectFrames, planHeroFrames, planLoadFrameTimes } from './frames';

const target = (index: number, y: number, tag = 'div', label: string | null = null): MotionTarget => ({ index, nodeId: null, tag, rect: { x: 100, y, width: 600, height: 300 }, label });

function motion(over: Partial<MotionData> = {}): MotionData {
  return {
    schemaVersion: 1,
    libraries: [],
    animations: [],
    reveals: [{ target: target(0, 1500, 'h2', 'Pricing'), changes: [], durationMs: 600, delayMs: 100, easing: 'ease-out', preset: 'fade-up 40px' }],
    revealPresets: [{ description: 'fade-up 40px, 600ms, ease-out', name: 'fade-up 40px', count: 5, durationMs: 600, easing: 'ease-out', staggerMs: null, targets: [0] }],
    scrollEffects: [
      { kind: 'parallax', target: target(2, 800), startPx: 400, endPx: 1800, ratio: 0.2, properties: [], description: 'parallax 0.2' },
      { kind: 'pinned', target: target(3, 2000), startPx: 2000, endPx: 3200, ratio: null, properties: [], description: 'pinned' },
    ],
    carousels: [
      { target: target(4, 3600, 'div', 'Logos'), slideCount: 6, direction: 'horizontal', autoplayIntervalMs: 3000, transitionMs: 500, controls: { arrows: false, dots: true }, moves: 3 },
      { target: target(5, 4200), slideCount: 4, direction: 'horizontal', autoplayIntervalMs: null, transitionMs: null, controls: { arrows: true, dots: false }, moves: 0 },
    ],
    videos: [],
    warnings: [],
    stats: { durationMs: 1, truncated: false, scrollSamples: 10 },
    ...over,
  };
}

const VIEW = { width: 1440, height: 900 };

describe('planHeroFrames', () => {
  it('plans six numbered frames over about 3s, scrolling to the top only for the first', () => {
    const frames = planHeroFrames(FRAME_LIMITS);
    expect(frames.map((f) => f.path)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `assets/motion/hero-0${n}.jpg`));
    expect(frames[0]).toMatchObject({ scrollY: 0, clip: null });
    expect(frames.slice(1).every((f) => f.scrollY === null && f.waitMs === 600)).toBe(true);
  });
});

describe('planEffectFrames', () => {
  it('plans reveal before/after, carousel frames (moving ones only) and scroll start/middle/end', () => {
    const frames = planEffectFrames(motion(), VIEW, FRAME_LIMITS);
    expect(frames.map((f) => f.path)).toEqual([
      'assets/motion/reveal-01-before.jpg',
      'assets/motion/reveal-01-after.jpg',
      'assets/motion/carousel-01-1.jpg',
      'assets/motion/carousel-01-2.jpg',
      'assets/motion/carousel-01-3.jpg',
      'assets/motion/scroll-01-start.jpg',
      'assets/motion/scroll-01-middle.jpg',
      'assets/motion/scroll-01-end.jpg',
      'assets/motion/scroll-02-start.jpg',
      'assets/motion/scroll-02-middle.jpg',
      'assets/motion/scroll-02-end.jpg',
    ]);
    const [before, after, c1, c2] = frames;
    expect(before).toMatchObject({ scrollY: 500, clip: { x: 100, y: 1500, width: 600, height: 300 } });
    expect(after?.scrollY).toBe(1200);
    expect(after?.waitMs).toBe(100 + 600 + 400);
    expect(c1?.scrollY).toBe(3300);
    expect(c2).toMatchObject({ scrollY: null, waitMs: 3000 });
    // Pinned effects come before parallax; scroll frames use the viewport.
    expect(frames[5]?.description).toContain('pinned');
    expect(frames[5]?.clip).toBeNull();
  });

  it('respects the frame cap (including frames already reserved) and per-kind caps', () => {
    expect(planEffectFrames(motion(), VIEW, { ...FRAME_LIMITS, maxFrames: 10 }, 6)).toHaveLength(4);
    expect(planEffectFrames(motion(), VIEW, { ...FRAME_LIMITS, maxFrames: 3 }, 6)).toEqual([]);
    const capped = planEffectFrames(motion(), VIEW, { ...FRAME_LIMITS, maxRevealPresets: 0, maxCarousels: 0, maxScrollEffects: 1 });
    expect(capped).toHaveLength(3);
  });

  it('returns nothing for a page without motion', () => {
    expect(planEffectFrames(motion({ reveals: [], revealPresets: [], scrollEffects: [], carousels: [] }), VIEW, FRAME_LIMITS)).toEqual([]);
  });
});

describe('page-load frames and loader detection', () => {
  it('samples every 400ms for about 3s, capped', () => {
    expect(planLoadFrameTimes(FRAME_LIMITS)).toEqual([0, 400, 800, 1200, 1600, 2000, 2400, 2800]);
    expect(planLoadFrameTimes({ ...FRAME_LIMITS, maxLoadFrames: 3 })).toEqual([0, 400, 800]);
  });

  const overlay = { tag: 'div', position: 'fixed', zIndex: 9999, coverage: 1, background: 'rgb(0, 0, 0)', hasText: false, hasGraphic: true };

  it('detects an overlay that is there early and gone later', () => {
    const info = detectLoader([
      { t: 0, overlay },
      { t: 800, overlay },
      { t: 1200, overlay },
      { t: 2000, overlay: null },
      { t: 2800, overlay: null },
    ]);
    expect(info).toMatchObject({ detected: true, visibleForMs: 1200 });
    expect(info.description).toContain('fixed <div>');
  });

  it('does not call a persistent overlay or a missing overlay a loader, and skips failed probes', () => {
    expect(detectLoader([{ t: 0, overlay }, { t: 2400, overlay }]).detected).toBe(false);
    expect(detectLoader([{ t: 0, overlay: null }, { t: 2400, overlay: null }]).detected).toBe(false);
    expect(detectLoader([{ t: 0, overlay }, { t: 400, overlay: undefined }, { t: 2400, overlay: null }]).detected).toBe(true);
    expect(detectLoader([{ t: 0, overlay }, { t: 400, overlay: undefined }]).detected).toBe(false);
  });
});
