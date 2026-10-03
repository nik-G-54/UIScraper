import type {
  CaptureWarning,
  CarouselInfo,
  MotionData,
  MotionLimits,
  MotionTarget,
  RunningAnimation,
  VideoInfo,
} from '../../shared/types';
import { MOTION_SCHEMA_VERSION } from '../../shared/types';
import { abortError } from '../extract/abort';
import { analyzeCarouselSamples } from './carousel';
import type { PositionSample } from './carousel';
import { detectLibraries, gatherLibrarySignals } from './libraries';
import { parseTransform, summarizeReveals } from './reveals';
import type { RevealSample, StyleSnap } from './reveals';
import { classifyScrollEffects } from './scrollEffects';
import type { ScrollSeries } from './scrollEffects';

/** The scan's result plus the elements the records point at (kept page-side to resolve node ids later). */
export interface MotionScan {
  data: MotionData;
  targets: Element[];
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR']);
const POLL_MS = 30;
const WATCH_SAMPLE_MS = 50;

const sleep = (win: Window, ms: number) => new Promise<void>((resolve) => win.setTimeout(resolve, ms));
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function cssTimeMs(list: string): number {
  const times = list.split(',').map((part) => {
    const m = /^\s*(-?\d*\.?\d+)(ms|s)\s*$/.exec(part);
    return m ? parseFloat(m[1] as string) * (m[2] === 's' ? 1000 : 1) : 0;
  });
  return Math.max(0, ...times);
}

/**
 * Sample the page's motion: libraries, running animations, scroll reveals, scroll-linked effects,
 * carousels and videos. Run it BEFORE the animation-pause CSS is applied. It scrolls the window and
 * puts it back in `finally`. Every part is wrapped: a failure becomes a warning, never an exception
 * (except an abort).
 */
export async function collectMotion(win: Window & typeof globalThis, limits: MotionLimits, signal?: AbortSignal): Promise<MotionScan> {
  const doc = win.document;
  const startedAt = win.performance.now();
  const deadline = startedAt + limits.maxMotionTimeMs;
  const warnings: CaptureWarning[] = [];
  const targets: Element[] = [];
  const targetIds = new Map<Element, number>();
  let truncated = false;

  const timeLeft = () => deadline - win.performance.now();
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };
  const guard = async <T>(code: string, what: string, fallback: T, work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push({ code, message: `${what}: ${error instanceof Error ? error.message : String(error)}.` });
      return fallback;
    }
  };

  const labelOf = (el: Element): string | null => {
    const raw = el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? (el.textContent ?? '');
    const text = raw.replace(/\s+/g, ' ').trim();
    return text ? (text.length > 40 ? `${text.slice(0, 39)}…` : text) : null;
  };
  const targetOf = (el: Element): MotionTarget => {
    let index = targetIds.get(el);
    if (index === undefined) {
      index = targets.length;
      targets.push(el);
      targetIds.set(el, index);
    }
    const r = el.getBoundingClientRect();
    return {
      index,
      nodeId: null,
      tag: el.localName,
      rect: { x: Math.round(r.x + win.scrollX), y: Math.round(r.y + win.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      label: labelOf(el),
    };
  };

  const snap = (el: Element): StyleSnap => {
    const cs = win.getComputedStyle(el);
    return { opacity: cs.opacity, transform: cs.transform, filter: cs.filter, clipPath: cs.clipPath };
  };

  // 1. Libraries.
  const libraries = await guard('motion-libraries-failed', 'Animation libraries could not be detected', [], () => detectLibraries(gatherLibrarySignals(doc)));

  // 2. Animations (read now and again after the scroll pass).
  const animations = new Map<string, RunningAnimation>();
  const readAnimations = () => {
    if (animations.size >= limits.maxAnimations || typeof doc.documentElement.getAnimations !== 'function') return;
    for (const animation of doc.documentElement.getAnimations({ subtree: true })) {
      if (animations.size >= limits.maxAnimations) {
        truncated = true;
        break;
      }
      const effect = animation.effect as KeyframeEffect | null;
      const el = effect?.target;
      if (!effect || !el || animation.playState === 'idle') continue;
      const timing = effect.getComputedTiming();
      const isAnimation = typeof win.CSSAnimation !== 'undefined' && animation instanceof win.CSSAnimation;
      const isTransition = typeof win.CSSTransition !== 'undefined' && animation instanceof win.CSSTransition;
      const name = isAnimation ? (animation as CSSAnimation).animationName : null;
      const property = isTransition ? (animation as CSSTransition).transitionProperty : null;
      const target = targetOf(el);
      const key = `${target.index}|${name ?? property ?? 'web'}|${effect.pseudoElement ?? ''}`;
      if (animations.has(key)) continue;
      const keyframes = effect.getKeyframes().slice(0, limits.maxKeyframesPerAnimation).map((frame) => {
        const out: Record<string, string | number | null> = { offset: frame.offset ?? null };
        for (const [prop, value] of Object.entries(frame)) {
          if (['offset', 'computedOffset', 'composite'].includes(prop)) continue;
          out[prop] = typeof value === 'string' || typeof value === 'number' ? value : null;
        }
        return out;
      });
      animations.set(key, {
        target,
        type: isAnimation ? 'css-animation' : isTransition ? 'css-transition' : 'web-animation',
        animationName: name,
        transitionProperty: property,
        pseudoElement: effect.pseudoElement ?? null,
        keyframes,
        durationMs: typeof timing.duration === 'number' ? Math.round(timing.duration) : null,
        delayMs: Math.round(timing.delay ?? 0),
        easing: timing.easing ?? 'linear',
        iterations: Number.isFinite(timing.iterations) ? (timing.iterations as number) : null,
        direction: timing.direction ?? 'normal',
        fill: timing.fill ?? 'auto',
      });
    }
  };
  await guard('motion-animations-failed', 'Running animations could not be read', undefined, readAnimations);

  // 3. Videos.
  const videos = await guard<VideoInfo[]>('motion-videos-failed', 'Videos could not be read', [], () =>
    [...doc.querySelectorAll('video')].slice(0, limits.maxVideos).map((video) => {
      const r = video.getBoundingClientRect();
      return {
        target: targetOf(video),
        src: video.currentSrc || video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || null,
        poster: video.getAttribute('poster') ? new URL(video.getAttribute('poster') as string, doc.baseURI).href : null,
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted,
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }),
  );

  // 4. Scroll pass: reveals, scroll-linked samples, carousels.
  const revealSamples: RevealSample[] = [];
  const series: ScrollSeries[] = [];
  const carousels: CarouselInfo[] = [];
  let scrollSamples = 0;

  const scrollPass = async () => {
    const original = { x: win.scrollX, y: win.scrollY };
    const vh = win.innerHeight;
    const vw = win.innerWidth;
    const pendingWatches: Promise<void>[] = [];
    const intervals: number[] = [];
    let observer: IntersectionObserver | null = null;

    try {
      // Pre-scan: candidates of each kind.
      const revealEls: Element[] = [];
      const revealSet = new Set<Element>();
      const scrollEls: Array<{ el: Element; area: number }> = [];
      const carouselEls: Array<{ el: Element; track: Element; vertical: boolean }> = [];
      win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const all = [...(doc.body?.querySelectorAll('*') ?? [])];
      if (all.length > limits.maxScanElements) truncated = true;
      for (const el of all.slice(0, limits.maxScanElements)) {
        if (SKIP_TAGS.has(el.tagName) || (el instanceof win.SVGElement && el.localName !== 'svg')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none') continue;
        const below = r.top >= vh * 0.9;
        const hiddenState = Number(cs.opacity) < 0.99 || cs.transform !== 'none' || cs.filter !== 'none' || cs.clipPath !== 'none';
        if (below && hiddenState && revealEls.length < limits.maxRevealTargets) {
          let covered = false;
          for (let p = el.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) if (revealSet.has(p)) covered = true;
          if (!covered) {
            revealEls.push(el);
            revealSet.add(el);
          }
        }
        const area = r.width * r.height;
        const linked =
          cs.position === 'sticky' ||
          (cs.transform !== 'none' && r.width >= 120 && r.height >= 80) ||
          (area >= vw * vh * 0.4 && cs.willChange.includes('transform')) ||
          r.width > vw * 1.3;
        if (linked) scrollEls.push({ el, area });

        for (const vertical of [false, true]) {
          const overflow = vertical ? cs.overflowY : cs.overflowX;
          if (!['hidden', 'auto', 'scroll', 'clip'].includes(overflow)) continue;
          const kids = [...el.children].filter((c) => !SKIP_TAGS.has(c.tagName));
          const track = kids.length === 1 && kids[0] && kids[0].children.length >= 3 ? kids[0] : el;
          const slides = [...track.children].filter((c) => !SKIP_TAGS.has(c.tagName));
          if (slides.length < 3) continue;
          const sizes = slides.map((s) => (vertical ? s.getBoundingClientRect().height : s.getBoundingClientRect().width));
          const mid = median(sizes);
          const similar = mid > 0 && sizes.every((s) => Math.abs(s - mid) <= mid * 0.2);
          const total = sizes.reduce((a, b) => a + b, 0);
          const box = vertical ? r.height : r.width;
          if (similar && total > box * 1.1 && !carouselEls.some((c) => c.el.contains(el) || el.contains(c.el))) {
            carouselEls.push({ el, track, vertical });
          }
          break;
        }
      }
      const scrollCandidates = scrollEls.sort((a, b) => b.area - a.area).slice(0, limits.maxScrollCandidates).map((c) => c.el);
      const carouselList = carouselEls.slice(0, limits.maxCarousels);
      series.push(...scrollCandidates.map((el) => ({ target: targetOf(el), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, points: [] })));

      // Reveal tracking: snapshot before, follow for the reveal window after the element intersects.
      const lastBefore = new Map<Element, StyleSnap>(revealEls.map((el) => [el, snap(el)]));
      const triggered = new Set<Element>();
      const active = new Map<Element, { before: StyleSnap; last: string; triggeredAt: number; start: number | null; end: number | null; dur: number | null; ease: string | null }>();
      const parents = new Map<Element | null, number>();
      const finishReveal = (el: Element) => {
        const a = active.get(el);
        if (!a) return;
        active.delete(el);
        const parent = el.parentElement;
        const parentKey = String(parents.get(parent) ?? parents.set(parent, parents.size).get(parent));
        revealSamples.push({
          target: targetOf(el),
          parentKey,
          before: a.before,
          after: snap(el),
          triggeredAt: a.triggeredAt,
          changeStartedAt: a.start,
          changeEndedAt: a.end,
          cssDurationMs: a.dur,
          cssEasing: a.ease,
        });
      };
      if (revealEls.length > 0 && typeof win.IntersectionObserver === 'function') {
        const io = new win.IntersectionObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target;
            if (!entry.isIntersecting || triggered.has(el)) continue;
            triggered.add(el);
            const now = win.performance.now();
            const cs = win.getComputedStyle(el);
            const animated = cs.animationName !== 'none';
            const before = lastBefore.get(el) ?? snap(el);
            active.set(el, {
              before,
              last: JSON.stringify(snap(el)),
              triggeredAt: now,
              start: null,
              end: null,
              dur: cssTimeMs(animated ? cs.animationDuration : cs.transitionDuration) || null,
              ease: (animated ? cs.animationTimingFunction : cs.transitionTimingFunction) || null,
            });
            win.setTimeout(() => finishReveal(el), limits.revealWindowMs);
          }
        });
        observer = io;
        for (const el of revealEls) io.observe(el);
        intervals.push(
          win.setInterval(() => {
            const now = win.performance.now();
            for (const [el, a] of active) {
              const current = JSON.stringify(snap(el));
              if (current !== a.last) {
                a.last = current;
                a.start ??= now;
                a.end = now;
              }
            }
          }, POLL_MS),
        );
      }

      // Carousel watching starts when a carousel first shows in the viewport.
      const watched = new Set<Element>();
      const watch = (c: { el: Element; track: Element; vertical: boolean }): Promise<void> => {
        const slides = [...c.track.children].filter((s) => !SKIP_TAGS.has(s.tagName));
        const step = median(slides.map((s) => (c.vertical ? s.getBoundingClientRect().height : s.getBoundingClientRect().width)));
        const scrollPos: PositionSample[] = [];
        const fadePos: PositionSample[] = [];
        const begin = win.performance.now();
        const duration = Math.max(500, Math.min(limits.carouselWatchMs, timeLeft() - 300));
        return new Promise<void>((resolve) => {
          const timer = win.setInterval(() => {
            const t = win.performance.now() - begin;
            const tr = parseTransform(win.getComputedStyle(c.track).transform);
            const el = c.el as HTMLElement;
            const own = c.vertical ? el.scrollTop : el.scrollLeft;
            scrollPos.push({ t, pos: own - (c.vertical ? tr.ty : tr.tx) });
            const lead = slides.findIndex((s) => Number(win.getComputedStyle(s).opacity) > 0.5);
            fadePos.push({ t, pos: Math.max(0, lead) * step });
            if (t >= duration) {
              win.clearInterval(timer);
              const a = analyzeCarouselSamples(scrollPos, step);
              const b = analyzeCarouselSamples(fadePos, step);
              const best = b.moves > a.moves ? b : a;
              const scope = c.el.parentElement?.parentElement ?? c.el.parentElement ?? c.el;
              const small = [...scope.querySelectorAll('button,[role=tab],li,span')].filter((d) => {
                const dr = d.getBoundingClientRect();
                return dr.width > 0 && dr.width <= 24 && dr.height <= 24 && !c.el.contains(d);
              });
              const arrow = [...scope.querySelectorAll('button,[role=button],a')].some((d) =>
                /prev|next|arrow|forward|back|‹|›|←|→|<|>/i.test(`${d.getAttribute('aria-label') ?? ''} ${d.getAttribute('title') ?? ''} ${d.textContent ?? ''}`.slice(0, 80)),
              );
              carousels.push({
                target: targetOf(c.el),
                slideCount: slides.length,
                direction: c.vertical ? 'vertical' : 'horizontal',
                autoplayIntervalMs: best.autoplayIntervalMs,
                transitionMs: best.transitionMs,
                controls: { arrows: arrow, dots: small.length >= 3 },
                moves: best.moves,
              });
              resolve();
            }
          }, WATCH_SAMPLE_MS);
          intervals.push(timer);
        });
      };
      const startVisibleCarousels = () => {
        for (const c of carouselList) {
          if (watched.has(c.el)) continue;
          const r = c.el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < vh) {
            watched.add(c.el);
            pendingWatches.push(watch(c));
          }
        }
      };

      // Walk the page.
      const docHeight = () => Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
      const maxY = Math.max(0, docHeight() - vh);
      const stepPx = Math.max(vh * 0.6, maxY / Math.max(1, limits.maxScrollSamples));
      const positions: number[] = [0];
      for (let y = stepPx; y < maxY; y += stepPx) positions.push(Math.round(y));
      if (maxY > 0) positions.push(maxY);
      if (maxY < 50) warnings.push({ code: 'motion-no-scroll', message: 'The page does not scroll with the window, so scroll reveals and scroll-linked effects were not sampled.' });

      for (const y of positions) {
        checkAbort();
        if (timeLeft() < limits.revealWindowMs + 500) {
          truncated = true;
          warnings.push({ code: 'motion-time-budget', message: `The motion scan hit its ${Math.round(limits.maxMotionTimeMs / 1000)}s budget before the end of the page.` });
          break;
        }
        for (const el of revealEls) if (!triggered.has(el)) lastBefore.set(el, snap(el));
        win.scrollTo({ top: y, left: 0, behavior: 'instant' });
        await sleep(win, limits.scrollStepDelayMs);
        scrollSamples++;
        const scrollY = win.scrollY;
        for (const s of series) {
          const el = targets[s.target.index] as Element;
          const cs = win.getComputedStyle(el);
          const tr = parseTransform(cs.transform);
          const clip = cs.clipPath === 'none' ? null : parseFloat(/-?\d*\.?\d+/.exec(cs.clipPath)?.[0] ?? '');
          s.points.push({
            scrollY,
            top: el.getBoundingClientRect().top,
            tx: tr.tx,
            ty: tr.ty,
            scale: tr.scale,
            opacity: Number(cs.opacity),
            clip: clip !== null && Number.isFinite(clip) ? clip : null,
          });
        }
        startVisibleCarousels();
      }
      // Let the last reveals finish and the carousels be watched.
      await sleep(win, Math.min(limits.revealWindowMs + 100, Math.max(0, timeLeft())));
      for (const el of [...active.keys()]) finishReveal(el);
      await Promise.race([Promise.all(pendingWatches), sleep(win, Math.max(0, timeLeft()))]);
    } finally {
      observer?.disconnect();
      for (const id of intervals) win.clearInterval(id);
      win.scrollTo({ left: original.x, top: original.y, behavior: 'instant' });
    }
  };
  await guard('motion-scroll-failed', 'Scroll reveals, scroll-linked effects and carousels could not be sampled', undefined, scrollPass);

  await guard('motion-animations-failed', 'Running animations could not be read', undefined, readAnimations);
  const { records, presets } = summarizeReveals(revealSamples);
  const scrollEffects = classifyScrollEffects(series, { width: win.innerWidth, height: win.innerHeight });

  return {
    targets,
    data: {
      schemaVersion: MOTION_SCHEMA_VERSION,
      libraries,
      animations: [...animations.values()],
      reveals: records,
      revealPresets: presets,
      scrollEffects,
      carousels,
      videos,
      warnings,
      stats: { durationMs: Math.round(win.performance.now() - startedAt), truncated, scrollSamples },
    },
  };
}

/** Node ids (of the last capture) for the scan's targets; null where the element was not captured. */
export function resolveMotionTargets(targets: readonly Element[], elements: ReadonlyMap<number, Element>): Array<number | null> {
  const ids = new Map<Element, number>();
  for (const [id, el] of elements) ids.set(el, id);
  return targets.map((el) => {
    for (let current: Element | null = el; current; current = current.parentElement) {
      const id = ids.get(current);
      if (id !== undefined) return id;
    }
    return null;
  });
}

/** Fill `nodeId` on every target in `data`. */
export function applyNodeIds(data: MotionData, ids: ReadonlyArray<number | null>): MotionData {
  const fix = (t: MotionTarget): MotionTarget => ({ ...t, nodeId: ids[t.index] ?? null });
  return {
    ...data,
    animations: data.animations.map((a) => ({ ...a, target: fix(a.target) })),
    reveals: data.reveals.map((r) => ({ ...r, target: fix(r.target) })),
    scrollEffects: data.scrollEffects.map((e) => ({ ...e, target: fix(e.target) })),
    carousels: data.carousels.map((c) => ({ ...c, target: fix(c.target) })),
    videos: data.videos.map((v) => ({ ...v, target: fix(v.target) })),
  };
}
