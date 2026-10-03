import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validResult } from '@/src/core/extract/fixtures';
import { EXTRACTION_BUDGETS, EXTRACTION_MESSAGE_GRACE_MS } from '@/src/shared/config';
import { DesignLensError } from '@/src/shared/errors';
import type { ActiveTabInfo, CaptureResult, ExtractorRequest, ProgressStep } from '@/src/shared/types';
import { captureTab } from './capture';

const TAB: ActiveTabInfo = { id: 7, title: 'Example', url: 'https://example.com/' };

interface Harness {
  calls: string[];
  progress: ProgressStep[];
  runtimeListeners: Set<(m: unknown, s: { tab?: { id: number } }) => void>;
  tabListeners: { updated: Set<(id: number, info: { status?: string }) => void>; removed: Set<(id: number) => void> };
  chrome: {
    scripting: { executeScript: ReturnType<typeof vi.fn>; insertCSS: ReturnType<typeof vi.fn>; removeCSS: ReturnType<typeof vi.fn> };
    tabs: { sendMessage: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  };
  /** Request ids seen by the fake extractor. */
  requests: ExtractorRequest[];
}

interface Behaviour {
  extract?: (request: Extract<ExtractorRequest, { type: 'designlens/extract' }>, h: Harness) => Promise<unknown>;
  ping?: () => Promise<unknown>;
  executeScript?: () => Promise<unknown>;
  removeCSS?: () => Promise<unknown>;
  tabUrlAfter?: string | null;
}

function install(behaviour: Behaviour = {}): Harness {
  const calls: string[] = [];
  const requests: ExtractorRequest[] = [];
  const runtimeListeners: Harness['runtimeListeners'] = new Set();
  const tabListeners: Harness['tabListeners'] = { updated: new Set(), removed: new Set() };
  // `chrome` is filled in just below, once the fakes that close over `h` exist.
  const h = { calls, progress: [], runtimeListeners, tabListeners, requests } as unknown as Harness;

  const emitProgress = (requestId: string, step: ProgressStep, tabId = TAB.id) => {
    for (const listener of [...runtimeListeners]) {
      listener({ type: 'designlens/progress', requestId, step }, { tab: { id: tabId } });
    }
  };

  h.chrome = {
    scripting: {
      executeScript: vi.fn(async () => {
        calls.push('executeScript');
        return behaviour.executeScript ? behaviour.executeScript() : [{}];
      }),
      insertCSS: vi.fn(async () => void calls.push('insertCSS')),
      removeCSS: vi.fn(async () => {
        calls.push('removeCSS');
        if (behaviour.removeCSS) await behaviour.removeCSS();
      }),
    },
    tabs: {
      sendMessage: vi.fn(async (_tabId: number, request: ExtractorRequest) => {
        requests.push(request);
        calls.push(`send:${request.type.replace('designlens/', '')}`);
        if (request.type === 'designlens/ping') {
          return behaviour.ping ? behaviour.ping() : { ok: true, kind: 'pong', schemaVersion: 2 };
        }
        if (request.type === 'designlens/abort') return { ok: true, kind: 'abort-ack' };
        if (request.type !== 'designlens/extract') return { ok: false, error: { code: 'EXTRACTION_FAILED', message: 'not used here' } };
        if (behaviour.extract) return behaviour.extract(request, h);
        for (const step of ['scrolling', 'stabilizing', 'capturing', 'cleaning-up'] as const) {
          emitProgress(request.requestId, step);
        }
        return { ok: true, kind: 'result', result: validResult() };
      }),
      get: vi.fn(async () =>
        behaviour.tabUrlAfter === null ? Promise.reject(new Error('No tab')) : { id: TAB.id, url: behaviour.tabUrlAfter ?? TAB.url },
      ),
    },
  };

  vi.stubGlobal('chrome', {
    ...h.chrome,
    runtime: {
      onMessage: {
        addListener: (l: never) => runtimeListeners.add(l),
        removeListener: (l: never) => runtimeListeners.delete(l),
      },
    },
    tabs: {
      ...h.chrome.tabs,
      onUpdated: { addListener: (l: never) => tabListeners.updated.add(l), removeListener: (l: never) => tabListeners.updated.delete(l) },
      onRemoved: { addListener: (l: never) => tabListeners.removed.add(l), removeListener: (l: never) => tabListeners.removed.delete(l) },
    },
  });
  return h;
}

const run = (h: Harness, tab = TAB, autoScroll = true) => captureTab(tab, { autoScroll }, (s) => h.progress.push(s));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('captureTab: success', () => {
  it('injects, pings, pauses animations, extracts, then removes the CSS, in that order', async () => {
    const h = install();
    const result = await run(h);

    expect(h.calls).toEqual(['executeScript', 'send:ping', 'insertCSS', 'send:extract', 'removeCSS']);
    expect(result.schemaVersion).toBe(validResult().schemaVersion);
  });

  it('injects the bundled script file into the ISOLATED world, top frame only', async () => {
    const h = install();
    await run(h);
    expect(h.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: TAB.id },
      files: ['extractor.js'],
      world: 'ISOLATED',
    });
    for (const call of h.chrome.tabs.sendMessage.mock.calls) expect(call[2]).toEqual({ frameId: 0 });
  });

  it('inserts and removes the very same user-origin CSS', async () => {
    const h = install();
    await run(h);
    const inserted = h.chrome.scripting.insertCSS.mock.calls[0]?.[0] as { css: string; origin: string; target: unknown };
    const removed = h.chrome.scripting.removeCSS.mock.calls[0]?.[0] as typeof inserted;
    expect(inserted.css).toContain('animation-play-state: paused');
    expect(inserted.origin).toBe('USER');
    expect(removed).toEqual(inserted);
  });

  it('sends the budgets, tuning and the auto-scroll setting with the extract request', async () => {
    const h = install();
    await run(h, TAB, false);
    const request = h.requests.find((r) => r.type === 'designlens/extract');
    expect(request).toMatchObject({ options: { autoScroll: false, budgets: EXTRACTION_BUDGETS } });
  });

  it('reports progress in order, ending with done', async () => {
    const h = install();
    await run(h);
    expect(h.progress).toEqual(['preparing', 'scrolling', 'stabilizing', 'capturing', 'cleaning-up', 'done']);
  });

  it('only follows progress for its own request and tab, and never goes backwards', async () => {
    const h = install({
      extract: async (request, harness) => {
        const send = (id: string, step: ProgressStep, tab: number) =>
          harness.runtimeListeners.forEach((l) => l({ type: 'designlens/progress', requestId: id, step }, { tab: { id: tab } }));
        send('someone-else', 'capturing', TAB.id);
        send(request.requestId, 'capturing', 999);
        send(request.requestId, 'stabilizing', TAB.id);
        send(request.requestId, 'scrolling', TAB.id); // late/out of order
        return { ok: true, kind: 'result', result: validResult() };
      },
    });
    await run(h);
    expect(h.progress).toEqual(['preparing', 'stabilizing', 'cleaning-up', 'done']);
  });

  it('merges the side panel’s own prepare/cleanup time and the wall-clock total into the stats', async () => {
    const h = install();
    const base = validResult().stats.durationsMs;
    const result = await run(h);
    expect(result.stats.durationsMs.prepare).toBeGreaterThanOrEqual(base.prepare);
    expect(result.stats.durationsMs.cleanup).toBeGreaterThanOrEqual(base.cleanup);
    expect(result.stats.durationsMs.total).toBeGreaterThanOrEqual(0);
  });

  it('keeps the result and adds a warning when removing the temporary CSS fails', async () => {
    const h = install({ removeCSS: async () => Promise.reject(new Error('frame gone')) });
    const result = await run(h);
    expect(result.warnings.some((w) => w.code === 'css-removal-failed' && w.message.includes('frame gone'))).toBe(true);
  });

  it('unregisters every listener it added', async () => {
    const h = install();
    await run(h);
    expect(h.runtimeListeners.size).toBe(0);
    expect(h.tabListeners.updated.size).toBe(0);
    expect(h.tabListeners.removed.size).toBe(0);
  });
});

describe('captureTab: failures (each must clean up and say why)', () => {
  const fails = async (h: Harness, code: string, message: RegExp) => {
    const promise = run(h);
    await expect(promise).rejects.toBeInstanceOf(DesignLensError);
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.toThrow(message);
  };

  it('refuses restricted pages without touching the tab', async () => {
    const h = install();
    const promise = run(h, { id: 1, title: 'Settings', url: 'chrome://settings' });
    await expect(promise).rejects.toMatchObject({ code: 'RESTRICTED_PAGE' });
    expect(h.calls).toEqual([]);
  });

  it('injection failure: readable error, nothing to clean up', async () => {
    const h = install({ executeScript: async () => Promise.reject(new Error('Cannot access contents of the page')) });
    await fails(h, 'INJECTION_FAILED', /Cannot access contents of the page/);
    expect(h.calls).not.toContain('insertCSS');
    expect(h.calls).not.toContain('removeCSS');
    expect(h.runtimeListeners.size).toBe(0);
  });

  it('injected script that never answers the startup ping', async () => {
    const h = install({ ping: async () => Promise.reject(new Error('Receiving end does not exist')) });
    await fails(h, 'INJECTION_FAILED', /did not respond/);
    expect(h.calls).not.toContain('insertCSS');
  });

  it('extractor error reply: reports the reason, tells the page to abort, removes the CSS', async () => {
    const h = install({
      extract: async () => ({ ok: false, error: { code: 'EXTRACTION_FAILED', message: 'layout exploded' } }),
    });
    await fails(h, 'EXTRACTION_FAILED', /layout exploded/);
    expect(h.calls).toEqual(['executeScript', 'send:ping', 'insertCSS', 'send:extract', 'send:abort', 'removeCSS']);
  });

  it('maps BUSY from the page', async () => {
    const h = install({ extract: async () => ({ ok: false, error: { code: 'BUSY', message: 'already running' } }) });
    await fails(h, 'BUSY', /already running/);
  });

  it('rejects an invalid result and still removes the CSS', async () => {
    const h = install({
      extract: async () => ({ ok: true, kind: 'result', result: { ...validResult(), nodes: 'nope' } }),
    });
    await fails(h, 'INVALID_RESULT', /rejected as invalid/);
    expect(h.calls).toContain('removeCSS');
  });

  it('rejects a result with the wrong schema version', async () => {
    const h = install({
      extract: async () => ({ ok: true, kind: 'result', result: { ...validResult(), schemaVersion: 1 } }),
    });
    await fails(h, 'INVALID_RESULT', /schemaVersion/);
  });

  it('rejects garbage replies', async () => {
    const h = install({ extract: async () => 'hello' });
    await fails(h, 'EXTRACTION_FAILED', /unexpected reply/);
  });

  it('navigation during capture (tab starts loading): NAVIGATED, CSS removal errors are not reported', async () => {
    const h = install({
      extract: (_request, harness) =>
        new Promise((resolve) => {
          harness.tabListeners.updated.forEach((l) => l(TAB.id, { status: 'loading' }));
          setTimeout(() => resolve({ ok: true, kind: 'result', result: validResult() }), 20);
        }),
      removeCSS: async () => Promise.reject(new Error('No tab with id')),
    });
    await fails(h, 'NAVIGATED', /navigated or reloaded/);
    expect(h.calls).toContain('removeCSS');
  });

  it('ignores loading events from other tabs', async () => {
    const h = install({
      extract: async (_request, harness) => {
        harness.tabListeners.updated.forEach((l) => l(TAB.id + 1, { status: 'loading' }));
        return { ok: true, kind: 'result', result: validResult() };
      },
    });
    await expect(run(h)).resolves.toBeDefined();
  });

  it('tab closed during capture', async () => {
    const h = install({
      extract: (_request, harness) =>
        new Promise((_, reject) => {
          harness.tabListeners.removed.forEach((l) => l(TAB.id));
          setTimeout(() => reject(new Error('port closed')), 10);
        }),
    });
    await fails(h, 'NAVIGATED', /tab was closed/);
  });

  it('message channel dies and the tab URL changed: NAVIGATED', async () => {
    const h = install({
      extract: async () => Promise.reject(new Error('The message port closed before a response was received.')),
      tabUrlAfter: 'https://example.com/other',
    });
    await fails(h, 'NAVIGATED', /navigated during capture/);
  });

  it('message channel dies and the tab is gone: NAVIGATED', async () => {
    const h = install({ extract: async () => Promise.reject(new Error('x')), tabUrlAfter: null });
    await fails(h, 'NAVIGATED', /closed/);
  });

  it('message channel dies on the same page: EXTRACTION_FAILED with the browser’s reason', async () => {
    const h = install({ extract: async () => Promise.reject(new Error('The message port closed')) });
    await fails(h, 'EXTRACTION_FAILED', /message port closed/);
  });

  it('suggests lowering the node budget when the result is too big to send', async () => {
    const h = install({ extract: async () => Promise.reject(new Error('Message length exceeded maximum allowed length.')) });
    await fails(h, 'EXTRACTION_FAILED', /node budget/);
  });

  it('times out when the page never answers, then aborts and cleans up', async () => {
    vi.useFakeTimers();
    const h = install({ extract: () => new Promise(() => undefined) });
    const promise = run(h);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    const budgetMs = EXTRACTION_BUDGETS.maxScrollTimeMs + EXTRACTION_BUDGETS.maxStabilizeTimeMs + EXTRACTION_BUDGETS.maxCaptureTimeMs;
    await vi.advanceTimersByTimeAsync(budgetMs + EXTRACTION_MESSAGE_GRACE_MS + 1);
    await assertion;
    expect(h.calls).toContain('send:abort');
    expect(h.calls.at(-1)).toBe('removeCSS');
    expect(h.runtimeListeners.size).toBe(0);
  });
});

describe('result type', () => {
  it('returns a fully typed CaptureResult', async () => {
    const h = install();
    const result: CaptureResult = await run(h);
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});
