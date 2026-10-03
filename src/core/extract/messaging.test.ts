import { describe, expect, it, vi } from 'vitest';
import type { CaptureResult, ExtractorResponse } from '../../shared/types';
import { SCHEMA_VERSION } from '../../shared/types';
import { installListener } from './install';
import { createExtractorListener, isExtractorRequest } from './messaging';
import { FAST_OPTIONS } from './testEnv';

const ME = 'ext-id';
const fakeResult = { schemaVersion: SCHEMA_VERSION } as CaptureResult;
const extract = (requestId = 'r1') => ({ type: 'designlens/extract', requestId, options: FAST_OPTIONS });

function setup(run = vi.fn(async () => fakeResult)) {
  const sendProgress = vi.fn();
  const listener = createExtractorListener({ run, sendProgress, extensionId: ME });
  const call = (message: unknown, sender: { id?: string } = { id: ME }) => {
    const responses: ExtractorResponse[] = [];
    const asyncResponse = listener(message, sender, (r) => responses.push(r));
    return { asyncResponse, responses };
  };
  return { run, sendProgress, call };
}

describe('isExtractorRequest', () => {
  it('accepts well-formed requests only', () => {
    expect(isExtractorRequest({ type: 'designlens/ping' })).toBe(true);
    expect(isExtractorRequest({ type: 'designlens/abort', requestId: 'x' })).toBe(true);
    expect(isExtractorRequest(extract())).toBe(true);
    expect(isExtractorRequest({ type: 'designlens/abort' })).toBe(false);
    expect(isExtractorRequest({ type: 'designlens/extract', requestId: 'x' })).toBe(false);
    expect(isExtractorRequest({ type: 'other' })).toBe(false);
    expect(isExtractorRequest(null)).toBe(false);
    expect(isExtractorRequest('designlens/ping')).toBe(false);
  });
});

describe('extractor listener', () => {
  it('answers ping synchronously', () => {
    const { call } = setup();
    const { asyncResponse, responses } = call({ type: 'designlens/ping' });
    expect(asyncResponse).toBe(false);
    expect(responses).toEqual([{ ok: true, kind: 'pong', schemaVersion: SCHEMA_VERSION }]);
  });

  it('ignores unrelated messages and messages from other extensions (no response)', () => {
    const { call, run } = setup();
    expect(call({ type: 'something-else' })).toEqual({ asyncResponse: false, responses: [] });
    expect(call(extract(), { id: 'someone-else' })).toEqual({ asyncResponse: false, responses: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs an extraction asynchronously: returns true and responds later with the result', async () => {
    const { call, run } = setup();
    const { asyncResponse, responses } = call(extract());
    expect(asyncResponse).toBe(true); // keeps the message channel open
    expect(responses).toEqual([]);
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual({ ok: true, kind: 'result', result: fakeResult });
    expect(run).toHaveBeenCalledOnce();
  });

  it('forwards progress with the request id', async () => {
    const run = vi.fn(async (_options, onProgress: (s: 'capturing') => void) => {
      onProgress('capturing');
      return fakeResult;
    });
    const { call, sendProgress } = setup(run as never);
    const { responses } = call(extract('abc'));
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(sendProgress).toHaveBeenCalledWith({ type: 'designlens/progress', requestId: 'abc', step: 'capturing' });
  });

  it('turns failures into readable error responses', async () => {
    const { call } = setup(vi.fn(async () => Promise.reject(new Error('kaboom'))));
    const { responses } = call(extract());
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual({ ok: false, error: { code: 'EXTRACTION_FAILED', message: 'kaboom' } });
  });

  it('reports an aborted run as ABORTED', async () => {
    const { call } = setup(
      vi.fn(async (_o, _p, signal: AbortSignal) => {
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }) as never,
    );
    const first = call(extract('r1'));
    const abort = call({ type: 'designlens/abort', requestId: 'r1' });
    expect(abort.responses).toEqual([{ ok: true, kind: 'abort-ack' }]);
    await vi.waitFor(() => expect(first.responses).toHaveLength(1));
    expect(first.responses[0]).toMatchObject({ ok: false, error: { code: 'ABORTED' } });
  });

  it('refuses a second extraction while one is running, and accepts one afterwards', async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<CaptureResult>((resolve) => (release = () => resolve(fakeResult))));
    const { call } = setup(run);
    const first = call(extract('r1'));
    const second = call(extract('r2'));
    expect(second.responses).toEqual([
      { ok: false, error: { code: 'BUSY', message: expect.any(String) as string } },
    ]);

    release();
    await vi.waitFor(() => expect(first.responses).toHaveLength(1));
    const third = call(extract('r3'));
    expect(third.asyncResponse).toBe(true);
    release();
  });

  it('accepts a new request sent straight from the response callback (no BUSY race)', async () => {
    const run = vi.fn(async () => fakeResult);
    const listener = createExtractorListener({ run, sendProgress: vi.fn(), extensionId: ME });
    const second: ExtractorResponse[] = [];
    await new Promise<void>((resolve) => {
      listener(extract('r1'), { id: ME }, () => {
        // same tick as the first response
        listener(extract('r2'), { id: ME }, (r) => {
          second.push(r);
          resolve();
        });
      });
    });
    expect(second).toEqual([{ ok: true, kind: 'result', result: fakeResult }]);
  });

  it('survives a closed channel when responding', async () => {
    const run = vi.fn(async () => fakeResult);
    const listener = createExtractorListener({ run, sendProgress: vi.fn(), extensionId: ME });
    listener(extract(), { id: ME }, () => {
      throw new Error('channel closed');
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
  });
});

describe('installListener (double-injection guard)', () => {
  function fakeOnMessage() {
    const listeners = new Set<unknown>();
    return {
      listeners,
      source: {
        addListener: (l: unknown) => listeners.add(l),
        removeListener: (l: unknown) => listeners.delete(l),
      },
    };
  }

  it('registers once; injecting again replaces the old listener instead of adding a second', () => {
    const host: Record<symbol, unknown> = {};
    const { listeners, source } = fakeOnMessage();
    const first = () => true;
    const second = () => true;

    installListener(host, source, first);
    expect([...listeners]).toEqual([first]);

    installListener(host, source, second);
    expect([...listeners]).toEqual([second]);
  });

  it('keeps separate registrations per host (page world)', () => {
    const a = fakeOnMessage();
    const b = fakeOnMessage();
    installListener({}, a.source, () => true);
    installListener({}, b.source, () => true);
    expect(a.listeners.size).toBe(1);
    expect(b.listeners.size).toBe(1);
  });

  it('still registers when a stale copy can no longer unregister itself', () => {
    const host: Record<symbol, unknown> = {};
    const stale = {
      addListener: () => undefined,
      removeListener: () => {
        throw new Error('Extension context invalidated.');
      },
    };
    installListener(host, stale, () => true);
    const fresh = fakeOnMessage();
    expect(() => installListener(host, fresh.source, () => true)).not.toThrow();
    expect(fresh.listeners.size).toBe(1);
  });
});
