// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProgressStep } from '../../shared/types';
import { runCapture } from './run';
import { fakeContainer, FAST_OPTIONS, makeRunEnv } from './testEnv';
import { validateCaptureResult } from './validate';

beforeEach(() => {
  document.head.innerHTML = '<title>Run test</title><meta name="color-scheme" content="light dark">';
  document.documentElement.lang = 'en';
  document.body.innerHTML = '<main><h1>Hello</h1><p>World</p></main>';
});

describe('runCapture', () => {
  it('produces a valid, complete result and restores the original scroll position', async () => {
    const env = makeRunEnv(document);
    env.page.y = 777;
    env.page.x = 12;
    const steps: ProgressStep[] = [];

    const result = await runCapture(env, FAST_OPTIONS, (s) => steps.push(s));

    expect(validateCaptureResult(result)).toEqual({ ok: true, result });
    expect(steps).toEqual(['scrolling', 'stabilizing', 'capturing', 'cleaning-up']);
    expect(result.meta).toMatchObject({
      title: 'Run test',
      lang: 'en',
      colorSchemeMeta: 'light dark',
      viewportWidth: 1000,
      viewportHeight: 800,
      devicePixelRatio: 2,
    });
    expect(result.stats.nodesCaptured).toBe(result.nodes.length);
    expect(result.stats.scroll).toEqual({
      steps: expect.any(Number) as number,
      stoppedBy: 'bottom',
      target: 'window',
      container: null,
    });
    expect(env.containerSearches).toBe(0);
    expect(result.stats.stabilize.settled).toBe(true);
    expect(result.stats.truncated).toBe(false);
    expect(result.stats.resultBytes).toBeGreaterThan(100);
    // capture happened at the top, then the original position came back
    expect(env.page).toMatchObject({ x: 12, y: 777 });
    expect(env.defaults.disposed).toBe(1);
  });

  it('scrolls the page for lazy content only when auto-scroll is on', async () => {
    const on = makeRunEnv(document);
    await runCapture(on, FAST_OPTIONS, () => undefined);
    expect(on.scrollLog.length).toBeGreaterThan(0);

    const off = makeRunEnv(document);
    const result = await runCapture(off, { ...FAST_OPTIONS, autoScroll: false }, () => undefined);
    expect(off.scrollLog).toEqual([]);
    expect(result.stats.scroll).toEqual({ steps: 0, stoppedBy: 'disabled', target: 'window', container: null });
    expect(off.containerSearches).toBe(0); // nothing scrolls, so no container is sought either
  });

  it('marks the result truncated and names the budget when a budget is hit', async () => {
    const result = await runCapture(
      makeRunEnv(document),
      { ...FAST_OPTIONS, budgets: { ...FAST_OPTIONS.budgets, maxNodes: 3 } },
      () => undefined,
    );
    expect(result.nodes).toHaveLength(3);
    expect(result.stats.truncated).toBe(true);
    expect(result.stats.truncatedReasons).toEqual(['maxNodes']);
  });

  it('flags a scroll-budget hit as truncated too', async () => {
    const env = makeRunEnv(document);
    env.page.documentHeight = 1_000_000;
    const result = await runCapture(
      env,
      { ...FAST_OPTIONS, budgets: { ...FAST_OPTIONS.budgets, maxScrollHeightPx: 2000 } },
      () => undefined,
    );
    expect(result.stats.truncated).toBe(true);
    expect(result.stats.truncatedReasons).toContain('maxScrollHeightPx');
  });

  it('warns (but does not truncate) when the page never goes quiet', async () => {
    const env = makeRunEnv(document, {
      quiet: {
        now: () => Date.now(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        // every quiet-timer arming is re-triggered by a "mutation" on a timer
        observe: (onMutation) => {
          const interval = setInterval(onMutation, 1);
          return () => clearInterval(interval);
        },
      },
    });
    const slowQuiet = { ...FAST_OPTIONS, tuning: { ...FAST_OPTIONS.tuning, stabilizeQuietMs: 30 } };
    const result = await runCapture(env, slowQuiet, () => undefined);
    expect(result.stats.stabilize.settled).toBe(false);
    expect(result.stats.truncated).toBe(false);
    expect(result.stats.truncatedReasons).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain('page-not-stable');
  });

  describe('inner scroll container', () => {
    const windowFits = (env: ReturnType<typeof makeRunEnv>) => {
      env.page.documentHeight = 800; // nothing for the window to scroll (viewport is 800)
    };

    it('scrolls the container when the window cannot scroll, and records it in the stats', async () => {
      const env = makeRunEnv(document);
      windowFits(env);
      env.container = fakeContainer({ scrollHeight: 3000, clientHeight: 700 });

      const result = await runCapture(env, FAST_OPTIONS, () => undefined);

      expect(result.stats.scroll).toMatchObject({ target: 'container', container: 'main (depth 2)', stoppedBy: 'bottom' });
      expect(result.stats.scroll.steps).toBeGreaterThan(0);
      expect(env.scrollLog).toEqual([]); // the window was never scrolled
      expect(env.container.log.some((y) => y > 0)).toBe(true);
    });

    it('also falls back to the container when the window scroll gets stuck', async () => {
      const env = makeRunEnv(document);
      env.page.documentHeight = 5000;
      env.scroll.scrollTo = (y) => void env.scrollLog.push(y); // the window ignores scrolling
      env.container = fakeContainer();
      const result = await runCapture(env, FAST_OPTIONS, () => undefined);
      expect(result.stats.scroll.target).toBe('container');
    });

    it('puts the container at the top for capture, then restores its original scrollTop and the window position', async () => {
      const env = makeRunEnv(document);
      windowFits(env);
      env.page.x = 4;
      env.page.y = 0;
      env.container = fakeContainer({ scrollTop: 640 });
      let containerTopDuringCapture = -1;
      const original = env.getRect;
      env.getRect = (el) => {
        containerTopDuringCapture = env.container?.scrollTop ?? -1;
        return original(el);
      };

      await runCapture(env, FAST_OPTIONS, () => undefined);

      expect(containerTopDuringCapture).toBe(0);
      expect(env.container.scrollTop).toBe(640);
      expect(env.page).toMatchObject({ x: 4, y: 0 });
    });

    it('restores the container and the window when capture throws', async () => {
      const env = makeRunEnv(document, {
        getRect: () => {
          throw new Error('layout exploded');
        },
      });
      windowFits(env);
      env.page.y = 0;
      env.container = fakeContainer({ scrollTop: 321 });

      await expect(runCapture(env, FAST_OPTIONS, () => undefined)).rejects.toThrow('layout exploded');

      expect(env.container.scrollTop).toBe(321);
      expect(env.page.y).toBe(0);
      expect(env.defaults.disposed).toBe(1);
    });

    it('restores both when aborted mid-way through the container scroll', async () => {
      const controller = new AbortController();
      const env = makeRunEnv(document);
      windowFits(env);
      env.page.y = 0;
      const container = fakeContainer({ scrollTop: 90, scrollHeight: 100_000 });
      env.container = container;
      const find = env.findScrollContainer;
      env.findScrollContainer = (min) => {
        const found = find(min);
        if (!found) return null;
        const scrollTo = found.scroll.scrollTo;
        let calls = 0;
        found.scroll.scrollTo = (y) => {
          scrollTo(y);
          if (++calls === 3) controller.abort(); // abort once well into the container
        };
        return found;
      };

      await expect(runCapture(env, FAST_OPTIONS, () => undefined, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });

      expect(container.scrollTop).toBe(90);
      expect(container.log.length).toBeGreaterThanOrEqual(3);
      expect(env.page.y).toBe(0);
      expect(env.defaults.disposed).toBe(0); // aborted before capture started, so no iframe was ever made
    });

    it('restores the container even when restoring the window fails first', async () => {
      const env = makeRunEnv(document);
      windowFits(env);
      env.container = fakeContainer({ scrollTop: 250 });
      const original = env.scrollToPosition;
      let calls = 0;
      env.scrollToPosition = (x, y) => {
        if (++calls === 2) throw new Error('window restore failed'); // 1st = reset for capture, 2nd = cleanup
        original(x, y);
      };

      const result = await runCapture(env, FAST_OPTIONS, () => undefined);

      expect(env.container.scrollTop).toBe(250);
      expect(result.warnings.some((w) => w.code === 'cleanup-failed')).toBe(true);
    });

    it('records the window as the target when there is no container to be found', async () => {
      const env = makeRunEnv(document);
      windowFits(env);
      const result = await runCapture(env, FAST_OPTIONS, () => undefined);
      expect(env.containerSearches).toBe(1);
      expect(result.stats.scroll).toMatchObject({ target: 'window', container: null });
    });
  });

  describe('cleanup', () => {
    it('restores scroll and disposes the temporary iframe even when capture throws', async () => {
      const env = makeRunEnv(document, {
        getRect: () => {
          throw new Error('layout exploded');
        },
      });
      env.page.y = 321;

      await expect(runCapture(env, FAST_OPTIONS, () => undefined)).rejects.toThrow('layout exploded');

      expect(env.page.y).toBe(321);
      expect(env.defaults.disposed).toBe(1);
    });

    it('restores scroll even when aborted during the walk', async () => {
      const controller = new AbortController();
      const env = makeRunEnv(document, {
        getRect: () => {
          controller.abort();
          return { left: 0, top: 0, width: 1, height: 1 };
        },
      });
      env.page.y = 55;

      await expect(runCapture(env, FAST_OPTIONS, () => undefined, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(env.page.y).toBe(55);
      expect(env.defaults.disposed).toBe(1);
    });

    it('reports a failing cleanup step as a warning without losing the capture', async () => {
      const env = makeRunEnv(document);
      const original = env.scrollToPosition;
      let calls = 0;
      env.scrollToPosition = (x, y) => {
        // 1st call = scroll to top before capture; 2nd = restore (fails)
        if (++calls === 2) throw new Error('restore failed');
        original(x, y);
      };
      const result = await runCapture(env, FAST_OPTIONS, () => undefined);
      expect(result.warnings.some((w) => w.code === 'cleanup-failed' && w.message.includes('restore failed'))).toBe(true);
      expect(env.defaults.disposed).toBe(1);
    });

    it('leaves the DOM exactly as it found it', async () => {
      const before = document.documentElement.outerHTML;
      await runCapture(makeRunEnv(document), FAST_OPTIONS, () => undefined);
      expect(document.documentElement.outerHTML).toBe(before);
    });
  });
});
