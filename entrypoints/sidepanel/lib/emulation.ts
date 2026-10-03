import { SCREENSHOT } from '@/src/shared/config';
import { DesignLensError, toErrorMessage } from '@/src/shared/errors';

const PROTOCOL_VERSION = '1.3';

export interface TabViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The tab's current viewport, read through a tiny injected function (isolated world, no page changes). */
export async function readViewport(tabId: number): Promise<TabViewport> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }),
  });
  const result = first?.result;
  if (!result || typeof result.width !== 'number') throw new Error('the page did not report its viewport size');
  return result;
}

/** Polls until the page reports `width` as its viewport width; resolves false on timeout. */
async function waitForWidth(tabId: number, width: number): Promise<boolean> {
  const deadline = Date.now() + SCREENSHOT.emulationTimeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await readViewport(tabId)).width === width) return true;
    } catch {
      // the page may be busy re-laying out; try again
    }
    await delay(100);
  }
  return false;
}

/**
 * A chrome.debugger session on one tab. It is used for two things: forcing the viewport width
 * (Emulation.setDeviceMetricsOverride) and taking screenshots. `release()` ALWAYS clears the
 * override and detaches; it is idempotent and never throws, so it is safe in `finally` blocks.
 */
export class DebuggerSession {
  private attached = true;
  private overridden = false;
  private detachReason: string | null = null;
  private readonly onDetach: (source: chrome.debugger.Debuggee, reason: string) => void;

  private constructor(private readonly tabId: number) {
    this.onDetach = (source, reason) => {
      if (source.tabId === tabId) {
        this.attached = false;
        this.detachReason = reason;
      }
    };
    chrome.debugger.onDetach.addListener(this.onDetach);
  }

  /** Throws a DesignLensError with a readable reason (e.g. DevTools or another extension holds the tab). */
  static async attach(tabId: number): Promise<DebuggerSession> {
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    } catch (error) {
      throw new DesignLensError('INJECTION_FAILED', `Could not attach the debugger: ${toErrorMessage(error)}`, { cause: error });
    }
    return new DebuggerSession(tabId);
  }

  get isAttached(): boolean {
    return this.attached;
  }

  async send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.attached) throw new Error(`the debugger was detached (${this.detachReason ?? 'unknown reason'})`);
    return (await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params)) as T;
  }

  /** Render the page at `width` CSS px wide (height and pixel ratio as given), then wait for layout to settle. */
  async emulateWidth(width: number, height: number, deviceScaleFactor: number): Promise<{ settled: boolean }> {
    this.overridden = true; // set first: a half-applied override must still be cleared
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    const settled = await waitForWidth(this.tabId, width);
    await delay(SCREENSHOT.emulationSettleMs);
    return { settled };
  }

  /** Clear the override and detach. Safe to call any number of times. */
  async release(): Promise<void> {
    chrome.debugger.onDetach.removeListener(this.onDetach);
    if (this.attached) {
      if (this.overridden) {
        await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => undefined);
        this.overridden = false;
      }
      this.attached = false;
      await chrome.debugger.detach({ tabId: this.tabId }).catch(() => undefined);
    }
  }
}
