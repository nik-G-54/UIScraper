import { describe, expect, it } from 'vitest';
import type { ProgressStep } from '../../shared/types';
import { runPipeline } from './pipeline';
import type { PipelineSteps } from './pipeline';

function harness(overrides: Partial<PipelineSteps<string>> = {}) {
  const log: string[] = [];
  const steps: PipelineSteps<string> = {
    prepare: () => void log.push('prepare'),
    scroll: async () => (log.push('scroll'), { steps: 3, stoppedBy: 'bottom', target: 'window', container: null }),
    stabilize: async () => (log.push('stabilize'), { settled: true, waitedMs: 5 }),
    capture: async () => (log.push('capture'), 'captured'),
    cleanups: [() => void log.push('cleanup-1'), () => void log.push('cleanup-2')],
    ...overrides,
  };
  const progress: ProgressStep[] = [];
  const run = (autoScroll = true, signal?: AbortSignal) =>
    runPipeline(steps, { autoScroll, onProgress: (s) => progress.push(s), now: () => 0, signal });
  return { log, progress, run };
}

describe('runPipeline', () => {
  it('runs the steps in order, then cleanup, reporting progress', async () => {
    const { log, progress, run } = harness();
    const outcome = await run();
    expect(log).toEqual(['prepare', 'scroll', 'stabilize', 'capture', 'cleanup-1', 'cleanup-2']);
    expect(progress).toEqual(['scrolling', 'stabilizing', 'capturing', 'cleaning-up']);
    expect(outcome.capture).toBe('captured');
    expect(outcome.scroll).toEqual({ steps: 3, stoppedBy: 'bottom', target: 'window', container: null });
    expect(outcome.cleanupErrors).toEqual([]);
  });

  it('skips scrolling when auto-scroll is off', async () => {
    const { log, progress, run } = harness();
    const outcome = await run(false);
    expect(log).not.toContain('scroll');
    expect(progress).not.toContain('scrolling');
    expect(outcome.scroll).toEqual({ steps: 0, stoppedBy: 'disabled', target: 'window', container: null });
  });

  it('measures every step', async () => {
    let clock = 0;
    const outcome = await runPipeline(
      {
        prepare: () => void (clock += 1),
        scroll: async () => ((clock += 20), { steps: 1, stoppedBy: 'bottom', target: 'window', container: null }),
        stabilize: async () => ((clock += 30), { settled: true, waitedMs: 30 }),
        capture: async () => ((clock += 400), 'x'),
        cleanups: [() => void (clock += 5)],
      },
      { autoScroll: true, onProgress: () => undefined, now: () => clock },
    );
    expect(outcome.durationsMs).toEqual({ prepare: 1, scroll: 20, stabilize: 30, capture: 400, cleanup: 5 });
  });

  describe('cleanup always runs', () => {
    it('when capture throws, and the capture error is what propagates', async () => {
      const { log, run } = harness({
        capture: async () => {
          throw new Error('capture exploded');
        },
      });
      await expect(run()).rejects.toThrow('capture exploded');
      expect(log).toEqual(['prepare', 'scroll', 'stabilize', 'cleanup-1', 'cleanup-2']);
    });

    it('when prepare, scroll or stabilize throws', async () => {
      for (const failing of ['prepare', 'scroll', 'stabilize'] as const) {
        const { log, run } = harness({
          [failing]: async () => {
            throw new Error(`${failing} failed`);
          },
        });
        await expect(run()).rejects.toThrow(`${failing} failed`);
        expect(log).toContain('cleanup-1');
        expect(log).toContain('cleanup-2');
        expect(log).not.toContain('capture');
      }
    });

    it('even if an earlier cleanup throws: the rest still run and the error is reported', async () => {
      const { log, run } = harness({
        cleanups: [
          () => {
            throw new Error('scroll restore failed');
          },
          () => void log.push('cleanup-2'),
        ],
      });
      const outcome = await run();
      expect(log).toContain('cleanup-2');
      expect(outcome.cleanupErrors).toEqual(['scroll restore failed']);
    });

    it('does not let a cleanup error mask the capture error', async () => {
      const { run } = harness({
        capture: async () => {
          throw new Error('real problem');
        },
        cleanups: [
          () => {
            throw new Error('cleanup problem');
          },
        ],
      });
      await expect(run()).rejects.toThrow('real problem');
    });

    it('when aborted between steps', async () => {
      const controller = new AbortController();
      const { log, run } = harness({
        scroll: async () => {
          controller.abort();
          return { steps: 1, stoppedBy: 'aborted', target: 'window', container: null };
        },
      });
      await expect(run(true, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(log).toEqual(['prepare', 'cleanup-1', 'cleanup-2']);
    });

    it('reports the cleaning-up step even on failure', async () => {
      const { progress, run } = harness({
        capture: async () => {
          throw new Error('x');
        },
      });
      await expect(run()).rejects.toThrow();
      expect(progress.at(-1)).toBe('cleaning-up');
    });
  });
});
