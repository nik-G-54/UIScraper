import { describe, expect, it } from 'vitest';
import { autoScroll } from './scroll';
import type { ScrollEnv } from './scroll';

const budgets = { maxScrollHeightPx: 10_000, maxScrollTimeMs: 5_000 };
const tuning = { scrollStepRatio: 0.5, scrollStepDelayMs: 100, scrollBottomSettleMs: 400 };

/** A fake page whose clock only advances through `delay`. */
function fakePage(options: { height: number; viewport?: number; growBy?: number; growUntil?: number; scrollable?: boolean }) {
  const state = {
    y: 0,
    clock: 0,
    height: options.height,
    positions: [] as number[],
  };
  const viewport = options.viewport ?? 800;
  const env: ScrollEnv = {
    now: () => state.clock,
    delay: async (ms) => {
      state.clock += ms;
      // Infinite scroll: the page grows when we are at the bottom.
      if (options.growBy && state.y + viewport >= state.height - 1 && state.height < (options.growUntil ?? Infinity)) {
        state.height += options.growBy;
      }
    },
    getScrollY: () => state.y,
    getViewportHeight: () => viewport,
    getDocumentHeight: () => state.height,
    scrollTo: (y) => {
      if (options.scrollable === false) return;
      state.y = y;
      state.positions.push(y);
    },
  };
  return { state, env };
}

describe('autoScroll', () => {
  it('scrolls to the bottom of a finite page in viewport-sized steps', async () => {
    const { env, state } = fakePage({ height: 2000 });
    const outcome = await autoScroll(env, budgets, tuning);
    expect(outcome.stoppedBy).toBe('bottom');
    expect(state.y).toBe(1200); // height - viewport
    expect(state.positions).toEqual([400, 800, 1200]);
    expect(outcome.steps).toBe(3);
  });

  it('does not scroll a page that already fits the viewport', async () => {
    const { env, state } = fakePage({ height: 600 });
    const outcome = await autoScroll(env, budgets, tuning);
    expect(outcome).toEqual({ steps: 0, stoppedBy: 'bottom' });
    expect(state.positions).toEqual([]);
  });

  it('keeps going while the page grows (infinite scroll), then stops at the bottom', async () => {
    const { env, state } = fakePage({ height: 1600, growBy: 800, growUntil: 4000 });
    const outcome = await autoScroll(env, budgets, tuning);
    expect(outcome.stoppedBy).toBe('bottom');
    expect(state.height).toBeGreaterThanOrEqual(4000);
    expect(state.y + 800).toBeGreaterThanOrEqual(state.height - 1);
  });

  it('stops at the scroll height budget on an endless page', async () => {
    const { env } = fakePage({ height: 2000, growBy: 2000 });
    const outcome = await autoScroll(env, { ...budgets, maxScrollHeightPx: 5000 }, tuning);
    expect(outcome.stoppedBy).toBe('maxScrollHeightPx');
  });

  it('never scrolls beyond the height budget', async () => {
    const { env, state } = fakePage({ height: 50_000 });
    await autoScroll(env, { ...budgets, maxScrollHeightPx: 3000 }, tuning);
    expect(Math.max(...state.positions)).toBeLessThanOrEqual(3000);
  });

  it('stops at the scroll time budget', async () => {
    const { env } = fakePage({ height: 1_000_000 });
    const outcome = await autoScroll(env, { maxScrollHeightPx: 10_000_000, maxScrollTimeMs: 1000 }, tuning);
    expect(outcome.stoppedBy).toBe('maxScrollTimeMs');
  });

  it('gives up when the window cannot scroll', async () => {
    const { env } = fakePage({ height: 5000, scrollable: false });
    const outcome = await autoScroll(env, budgets, tuning);
    expect(outcome.stoppedBy).toBe('stuck');
    expect(outcome.steps).toBe(1);
  });

  it('gives up immediately when the viewport has no height', async () => {
    const { env, state } = fakePage({ height: 5000, viewport: 0 });
    expect(await autoScroll(env, budgets, tuning)).toEqual({ steps: 0, stoppedBy: 'stuck' });
    expect(state.positions).toEqual([]);
  });

  it('can be aborted', async () => {
    const { env } = fakePage({ height: 5000 });
    const controller = new AbortController();
    controller.abort();
    await expect(autoScroll(env, budgets, tuning, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
