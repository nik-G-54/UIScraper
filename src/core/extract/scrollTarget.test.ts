import { describe, expect, it } from 'vitest';
import type { ScrollEnv } from './scroll';
import type { ScrollContainer } from './scrollContainer';
import { lazyScroll, windowCanScroll } from './scrollTarget';

const budgets = { maxScrollHeightPx: 30_000, maxScrollTimeMs: 5_000 };
const tuning = { scrollStepRatio: 0.5, scrollStepDelayMs: 100, scrollBottomSettleMs: 400, scrollMinOverflowPx: 100 };

/** Mocked scroll metrics for one scrollable thing (the window or a container). All share `clock`. */
function fakeScroller(clock: { t: number }, options: { height: number; viewport: number; scrollable?: boolean; growBy?: number; growUntil?: number }) {
  const state = { y: 0, height: options.height, positions: [] as number[] };
  const env: ScrollEnv = {
    now: () => clock.t,
    delay: async (ms) => {
      clock.t += ms;
      if (options.growBy && state.y + options.viewport >= state.height - 1 && state.height < (options.growUntil ?? Infinity)) {
        state.height += options.growBy;
      }
    },
    getScrollY: () => state.y,
    getViewportHeight: () => options.viewport,
    getDocumentHeight: () => state.height,
    scrollTo: (y) => {
      state.positions.push(y);
      if (options.scrollable !== false) state.y = Math.min(y, state.height - options.viewport);
    },
  };
  return { state, env };
}

function setup(opts: {
  window: { height: number; viewport?: number; scrollable?: boolean };
  container?: { height: number; viewport?: number; growBy?: number; growUntil?: number } | null;
}) {
  const clock = { t: 0 };
  const win = fakeScroller(clock, { viewport: 800, ...opts.window });
  const inner = opts.container ? fakeScroller(clock, { viewport: 600, ...opts.container }) : null;
  const log = { searches: 0, registered: [] as ScrollContainer[] };
  const targets = {
    window: win.env,
    findContainer: (): ScrollContainer | null => {
      log.searches++;
      return inner ? { descriptor: 'main (depth 2)', scroll: inner.env } : null;
    },
    onContainer: (c: ScrollContainer) => log.registered.push(c),
  };
  return { clock, win, inner, log, targets };
}

describe('windowCanScroll', () => {
  const env = (height: number, viewport: number) => fakeScroller({ t: 0 }, { height, viewport }).env;

  it('is true when content overflows the viewport by the minimum or more', () => {
    expect(windowCanScroll(env(2000, 800), 100)).toBe(true);
    expect(windowCanScroll(env(900, 800), 100)).toBe(true); // exactly the minimum
  });

  it('is false when the page fits or overflows only a little', () => {
    expect(windowCanScroll(env(800, 800), 100)).toBe(false);
    expect(windowCanScroll(env(850, 800), 100)).toBe(false);
    expect(windowCanScroll(env(500, 800), 100)).toBe(false);
  });
});

describe('lazyScroll: the window scrolls', () => {
  it('scrolls the window and never even looks for a container', async () => {
    const { targets, win, log } = setup({ window: { height: 3000 }, container: { height: 9000 } });
    const outcome = await lazyScroll(targets, budgets, tuning);
    expect(outcome).toMatchObject({ target: 'window', container: null, stoppedBy: 'bottom' });
    expect(outcome.steps).toBeGreaterThan(0);
    expect(win.state.y).toBe(2200);
    expect(log.searches).toBe(0);
    expect(log.registered).toEqual([]);
  });

  it('keeps the window result when it hit a budget (a container would not help)', async () => {
    const { targets, log } = setup({ window: { height: 1_000_000 }, container: { height: 5000 } });
    const outcome = await lazyScroll(targets, { ...budgets, maxScrollTimeMs: 600 }, tuning);
    expect(outcome).toMatchObject({ target: 'window', stoppedBy: 'maxScrollTimeMs' });
    expect(log.searches).toBe(0);
  });
});

describe('lazyScroll: the window cannot scroll meaningfully', () => {
  it('scrolls the inner container instead, and reports it', async () => {
    const { targets, inner, win, log } = setup({ window: { height: 800 }, container: { height: 3000 } });
    const outcome = await lazyScroll(targets, budgets, tuning);

    expect(outcome).toMatchObject({ target: 'container', container: 'main (depth 2)', stoppedBy: 'bottom' });
    expect(outcome.steps).toBeGreaterThan(0);
    expect(inner?.state.y).toBe(2400); // height - viewport
    expect(win.state.positions).toEqual([]); // the window was left alone
    expect(log.registered).toHaveLength(1);
  });

  it('treats a barely-taller-than-viewport window as unscrollable', async () => {
    const { targets, log } = setup({ window: { height: 850 }, container: { height: 3000 } });
    const outcome = await lazyScroll(targets, budgets, tuning);
    expect(outcome.target).toBe('container');
    expect(log.searches).toBe(1);
  });

  it('registers the container BEFORE scrolling it (so cleanup can always restore it)', async () => {
    const clock = { t: 0 };
    const win = fakeScroller(clock, { height: 800, viewport: 800 });
    const inner = fakeScroller(clock, { height: 3000, viewport: 600 });
    let scrolledAtRegistration = -1;
    await lazyScroll(
      {
        window: win.env,
        findContainer: () => ({ descriptor: 'div (depth 1)', scroll: inner.env }),
        onContainer: () => {
          scrolledAtRegistration = inner.state.positions.length;
        },
      },
      budgets,
      tuning,
    );
    expect(scrolledAtRegistration).toBe(0);
  });

  it('follows infinite scroll inside the container until it ends', async () => {
    const { targets, inner } = setup({
      window: { height: 800 },
      container: { height: 1500, growBy: 600, growUntil: 4000 },
    });
    const outcome = await lazyScroll(targets, budgets, tuning);
    expect(outcome.stoppedBy).toBe('bottom');
    expect((inner?.state.height ?? 0)).toBeGreaterThanOrEqual(4000);
  });

  it('applies the same height budget to the container', async () => {
    const { targets, inner } = setup({ window: { height: 800 }, container: { height: 100_000 } });
    const outcome = await lazyScroll(targets, { ...budgets, maxScrollHeightPx: 2000 }, tuning);
    expect(outcome).toMatchObject({ target: 'container', stoppedBy: 'maxScrollHeightPx' });
    expect(Math.max(...(inner?.state.positions ?? [0]))).toBeLessThanOrEqual(2000);
  });

  it('applies the same time budget to the container', async () => {
    const { targets } = setup({ window: { height: 800 }, container: { height: 10_000_000 } });
    const outcome = await lazyScroll(targets, { ...budgets, maxScrollTimeMs: 1000 }, tuning);
    expect(outcome).toMatchObject({ target: 'container', stoppedBy: 'maxScrollTimeMs' });
  });

  it('falls back to the window result when there is no container', async () => {
    const { targets, log } = setup({ window: { height: 800 }, container: null });
    const outcome = await lazyScroll(targets, budgets, tuning);
    expect(outcome).toEqual({ steps: 0, stoppedBy: 'bottom', target: 'window', container: null });
    expect(log.searches).toBe(1);
  });

  it('can be aborted while scrolling the container', async () => {
    const { targets } = setup({ window: { height: 800 }, container: { height: 9000 } });
    const controller = new AbortController();
    controller.abort();
    await expect(lazyScroll(targets, budgets, tuning, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('lazyScroll: the window gets stuck', () => {
  it('switches to the container, adds up the steps, and shares the time budget', async () => {
    // Window looks scrollable (3000 tall) but scrollTo does nothing, e.g. html { overflow: hidden }.
    const { targets, inner, clock } = setup({ window: { height: 3000, scrollable: false }, container: { height: 3000 } });
    const outcome = await lazyScroll(targets, budgets, tuning);

    expect(outcome).toMatchObject({ target: 'container', container: 'main (depth 2)', stoppedBy: 'bottom' });
    expect(outcome.steps).toBeGreaterThan(1); // 1 stuck window step + container steps
    expect(inner?.state.y).toBe(2400);
    expect(clock.t).toBeLessThan(budgets.maxScrollTimeMs);
  });

  it('only gets what is left of the time budget for the container', async () => {
    const { targets, clock } = setup({ window: { height: 3000, scrollable: false }, container: { height: 10_000_000 } });
    const outcome = await lazyScroll(targets, { ...budgets, maxScrollTimeMs: 1000 }, tuning);
    expect(outcome.stoppedBy).toBe('maxScrollTimeMs');
    expect(clock.t).toBeLessThanOrEqual(1000 + tuning.scrollStepDelayMs + tuning.scrollBottomSettleMs);
  });

  it('keeps the stuck result when there is no container to fall back on', async () => {
    const { targets } = setup({ window: { height: 3000, scrollable: false }, container: null });
    const outcome = await lazyScroll(targets, budgets, tuning);
    expect(outcome).toMatchObject({ stoppedBy: 'stuck', target: 'window', container: null });
  });
});
