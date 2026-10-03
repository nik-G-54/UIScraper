import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForQuiet } from './stabilize';
import type { QuietEnv } from './stabilize';

const budgets = { maxStabilizeTimeMs: 3000 };
const tuning = { stabilizeQuietMs: 500 };

let mutate: () => void;
let observers: number;
const env: QuietEnv = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  observe: (onMutation) => {
    observers++;
    mutate = onMutation;
    return () => void observers--;
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  observers = 0;
});
afterEach(() => vi.useRealTimers());

describe('waitForQuiet', () => {
  it('settles after the quiet window when nothing changes', async () => {
    const promise = waitForQuiet(env, budgets, tuning);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toMatchObject({ settled: true, waitedMs: 500 });
    expect(observers).toBe(0); // observer disconnected
  });

  it('restarts the quiet window on every mutation', async () => {
    const promise = waitForQuiet(env, budgets, tuning);
    await vi.advanceTimersByTimeAsync(400);
    mutate();
    await vi.advanceTimersByTimeAsync(400);
    mutate();
    await vi.advanceTimersByTimeAsync(499);
    let done = false;
    void promise.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toMatchObject({ settled: true, waitedMs: 1300 });
  });

  it('gives up at the stabilize budget when the page never goes quiet', async () => {
    const promise = waitForQuiet(env, budgets, tuning);
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(300);
      mutate?.();
    }
    const outcome = await promise;
    expect(outcome.settled).toBe(false);
    expect(outcome.waitedMs).toBe(3000);
    expect(observers).toBe(0);
  });

  it('resolves early (not settled) when aborted', async () => {
    const controller = new AbortController();
    const promise = waitForQuiet(env, budgets, tuning, controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(await promise).toMatchObject({ settled: false });
    expect(observers).toBe(0);
  });
});
