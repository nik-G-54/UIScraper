import { describe, expect, it } from 'vitest';
import type { MotionTarget } from '../../shared/types';
import { analyzeCarouselSamples } from './carousel';
import { detectLibraries } from './libraries';
import { presetName, summarizeReveals } from './reveals';
import type { RevealSample, StyleSnap } from './reveals';
import { classifyScrollEffects } from './scrollEffects';
import type { ScrollPoint, ScrollSeries } from './scrollEffects';

const target = (index: number): MotionTarget => ({ index, nodeId: null, tag: 'div', rect: { x: 0, y: 0, width: 300, height: 200 }, label: null });

describe('detectLibraries', () => {
  it('finds libraries from script URLs, link hrefs and DOM markers, with evidence', () => {
    const found = detectLibraries({
      scripts: [
        'https://cdn.jsdelivr.net/npm/gsap@3.12/dist/gsap.min.js',
        'https://cdn.jsdelivr.net/npm/gsap@3.12/dist/ScrollTrigger.min.js',
        'https://unpkg.com/lenis@1.1/dist/lenis.min.js',
        'https://example.com/assets/app.js',
      ],
      links: ['https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css'],
      markers: ['[data-aos]', '.swiper-wrapper', 'lottie-player'],
    });
    const names = found.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['GSAP / ScrollTrigger', 'Lenis', 'Swiper', 'AOS', 'Lottie']));
    expect(found[0]?.name).toBe('GSAP / ScrollTrigger');
    expect(found.find((l) => l.name === 'Swiper')?.evidence).toEqual([expect.stringContaining('link href'), 'DOM marker .swiper-wrapper']);
  });

  it('does not mistake look-alike words for libraries', () => {
    const names = detectLibraries({ scripts: ['https://x.test/drive.js', 'https://x.test/arrive.js', 'https://x.test/breakthrough.js', 'https://x.test/loaded.js'], links: [], markers: [] }).map((l) => l.name);
    expect(names).toEqual([]);
    expect(detectLibraries({ scripts: ['https://x.test/vendor/rive.js', 'https://x.test/three.min.js'], links: [], markers: [] }).map((l) => l.name).sort()).toEqual(['Rive', 'Three.js']);
  });
});

const snap = (over: Partial<StyleSnap> = {}): StyleSnap => ({ opacity: '1', transform: 'none', filter: 'none', clipPath: 'none', ...over });

function reveal(index: number, delay: number, over: Partial<RevealSample> = {}): RevealSample {
  return {
    target: target(index),
    parentKey: 'p1',
    before: snap({ opacity: '0', transform: 'matrix(1, 0, 0, 1, 0, 40)' }),
    after: snap(),
    triggeredAt: 1000,
    changeStartedAt: 1000 + delay,
    changeEndedAt: 1000 + delay + 600,
    cssDurationMs: 600,
    cssEasing: 'cubic-bezier(0, 0, 0.58, 1)',
    ...over,
  };
}

describe('summarizeReveals', () => {
  it('names the effect, duration, easing and sibling stagger', () => {
    const { presets, records } = summarizeReveals([reveal(0, 0), reveal(1, 100), reveal(2, 200), reveal(3, 300)]);
    expect(records).toHaveLength(4);
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ description: 'fade-up 40px, 600ms, ease-out, stagger 100ms', count: 4, staggerMs: 100 });
  });

  it('ignores elements that did not change and separates different effects', () => {
    const still = reveal(5, 0, { before: snap(), after: snap() });
    const blur = reveal(6, 0, { parentKey: 'p2', before: snap({ opacity: '0', filter: 'blur(8px)' }), after: snap(), cssDurationMs: null, changeEndedAt: 1000 + 480 });
    const { presets, records } = summarizeReveals([still, blur, reveal(0, 0)]);
    expect(records).toHaveLength(2);
    expect(presets.map((p) => p.name).sort()).toEqual(['fade + blur 8px', 'fade-up 40px']);
    expect(presets.find((p) => p.name.includes('blur'))?.durationMs).toBe(500);
  });

  it('describes slides and scales', () => {
    expect(presetName([{ property: 'transform', from: 'matrix(1, 0, 0, 1, -80, 0)', to: 'none' }])).toBe('slide-right 80px');
    expect(presetName([{ property: 'opacity', from: '0', to: '1' }, { property: 'transform', from: 'matrix(0.9, 0, 0, 0.9, 0, 0)', to: 'none' }])).toBe('fade + scale 0.9→1');
  });
});

const VIEW = { width: 1440, height: 900 };

function series(fn: (scrollY: number) => Partial<ScrollPoint>, over: Partial<ScrollSeries> = {}): ScrollSeries {
  const points: ScrollPoint[] = [];
  for (let y = 0; y <= 4000; y += 400) {
    points.push({ scrollY: y, top: 1200 - y, tx: 0, ty: 0, scale: 1, opacity: 1, clip: null, ...fn(y) });
  }
  return { target: target(0), width: 600, height: 400, points, ...over };
}

describe('classifyScrollEffects', () => {
  it('detects parallax with its ratio', () => {
    // Moves at 0.8x of the scroll speed: top drops 0.8px per px scrolled.
    const [effect] = classifyScrollEffects([series((y) => ({ top: 1800 - 0.8 * y, ty: 0.2 * y }))], VIEW);
    expect(effect).toMatchObject({ kind: 'parallax', ratio: 0.2 });
  });

  it('detects a pinned range and ignores a sticky header', () => {
    const pin = series((y) => ({ top: y < 800 ? 1200 - y : y > 2800 ? 1200 - y + 2000 : 400 }));
    const [effect] = classifyScrollEffects([pin], VIEW);
    expect(effect).toMatchObject({ kind: 'pinned', startPx: 800, endPx: 2800 });
    const header = series(() => ({ top: 0 }), { width: 1440, height: 72 });
    expect(classifyScrollEffects([header], VIEW)).toEqual([]);
  });

  it('detects progress-linked opacity and horizontal travel, and ignores plain elements', () => {
    const fade = series((y) => ({ opacity: Math.min(1, Math.max(0, (y - 800) / 2000)) }));
    const [progress] = classifyScrollEffects([fade], VIEW);
    expect(progress).toMatchObject({ kind: 'progress', properties: ['opacity'], startPx: 800, endPx: 2800 });
    const track = series((y) => ({ top: 100, tx: -0.5 * y }), { width: 4000 });
    // top is constant for the whole range, so pinned wins; give it a moving top to test the horizontal branch.
    const moving = series((y) => ({ tx: -0.5 * y }), { width: 4000 });
    expect(classifyScrollEffects([moving], VIEW)[0]).toMatchObject({ kind: 'horizontal', ratio: 0.5 });
    expect(classifyScrollEffects([track], VIEW)[0]?.kind).toBe('pinned');
    expect(classifyScrollEffects([series(() => ({}))], VIEW)).toEqual([]);
  });
});

describe('analyzeCarouselSamples', () => {
  const run = (moveAt: number[], slide = 400, dur = 500, total = 12_000, dir = 1) => {
    const samples = [];
    let pos = 0;
    for (let t = 0; t <= total; t += 50) {
      for (const start of moveAt) {
        if (t > start && t <= start + dur) pos += (slide / dur) * 50 * dir;
      }
      samples.push({ t, pos: Math.round(pos * 100) / 100 });
    }
    return samples;
  };

  it('finds the autoplay interval, transition duration and direction', () => {
    const result = analyzeCarouselSamples(run([1000, 5000, 9000]), 400);
    expect(result).toMatchObject({ moves: 3, autoplayIntervalMs: 4000, transitionMs: 500, direction: 'forward' });
  });

  it('reports a carousel that never moves, and a backwards one', () => {
    expect(analyzeCarouselSamples(run([]), 400)).toMatchObject({ moves: 0, autoplayIntervalMs: null, direction: null });
    expect(analyzeCarouselSamples(run([1000, 4000], 400, 500, 8000, -1), 400).direction).toBe('backward');
  });
});
