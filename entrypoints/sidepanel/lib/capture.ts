import { validateCaptureResult } from '@/src/core/extract';
import {
  CAPTURE_TUNING,
  EXTRACTION_BUDGETS,
  EXTRACTION_MESSAGE_GRACE_MS,
  EXTRACTOR_SCRIPT_PATH,
} from '@/src/shared/config';
import { DesignLensError, toErrorMessage } from '@/src/shared/errors';
import type {
  ActiveTabInfo,
  CaptureOptions,
  CaptureResult,
  CaptureWarning,
  ExtractorProgressMessage,
  ExtractorRequest,
  ProgressStep,
  Settings,
} from '@/src/shared/types';
import { getPageRestriction } from '@/src/shared/url';

/**
 * Pauses CSS animations (frozen where they are) while capturing. Transitions are left alone on
 * purpose so their durations are recorded accurately; the stabilize step waits them out.
 * USER origin + !important beats the page's own !important rules.
 */
const PAUSE_ANIMATIONS_CSS = '*, *::before, *::after { animation-play-state: paused !important; }';

const STEP_ORDER: ProgressStep[] = ['preparing', 'scrolling', 'stabilizing', 'capturing', 'cleaning-up', 'done'];

function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProgressMessage(message: unknown): message is ExtractorProgressMessage {
  return (
    isObject(message) &&
    message.type === 'designlens/progress' &&
    typeof message.requestId === 'string' &&
    typeof message.step === 'string' &&
    STEP_ORDER.includes(message.step as ProgressStep)
  );
}

/** Rejects as soon as the tab starts loading a new page or is closed. */
function watchNavigation(tabId: number): { navigated: Promise<never>; dispose(): void } {
  let onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0];
  let onRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0];
  const navigated = new Promise<never>((_, reject) => {
    onUpdated = (id, info) => {
      if (id === tabId && info.status === 'loading') {
        reject(new DesignLensError('NAVIGATED', 'The page navigated or reloaded during capture. Try again once it has finished loading.'));
      }
    };
    onRemoved = (id) => {
      if (id === tabId) reject(new DesignLensError('NAVIGATED', 'The tab was closed during capture.'));
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
  navigated.catch(() => undefined); // never an unhandled rejection if nobody is racing it
  return {
    navigated,
    dispose: () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    },
  };
}

function send(tabId: number, request: ExtractorRequest): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, request, { frameId: 0 }) as Promise<unknown>;
}

async function injectExtractor(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [EXTRACTOR_SCRIPT_PATH], world: 'ISOLATED' });
  } catch (error) {
    throw new DesignLensError('INJECTION_FAILED', `Could not inject into this page: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }
  let reply: unknown;
  try {
    reply = await withTimeout(send(tabId, { type: 'designlens/ping' }), 5_000, () => new Error('no reply within 5 seconds'));
  } catch (error) {
    throw new DesignLensError(
      'INJECTION_FAILED',
      `The page script was injected but did not respond (${toErrorMessage(error)}).`,
      { cause: error },
    );
  }
  if (!isObject(reply) || reply.ok !== true || reply.kind !== 'pong') {
    throw new DesignLensError('INJECTION_FAILED', 'The page script responded unexpectedly to the startup check.');
  }
}

/** Why a failed message round-trip really failed: navigation, a closed tab, or something else. */
async function explainFailure(error: unknown, tab: ActiveTabInfo): Promise<DesignLensError> {
  if (error instanceof DesignLensError) return error;
  const current = await chrome.tabs.get(tab.id).catch(() => null);
  if (!current) return new DesignLensError('NAVIGATED', 'The tab was closed during capture.', { cause: error });
  if (current.url !== tab.url) {
    return new DesignLensError('NAVIGATED', 'The page navigated during capture. Try again once it has finished loading.', {
      cause: error,
    });
  }
  const message = toErrorMessage(error);
  const hint = /length exceeded|too large/i.test(message)
    ? ' The captured result is too large to send; lower the node budget in src/shared/config.ts.'
    : '';
  return new DesignLensError('EXTRACTION_FAILED', `Capture failed: ${message}${hint}`, { cause: error });
}

/**
 * Orchestrate one capture of `tab`: inject the extractor, pause animations, ask it to run,
 * validate the answer, then always undo our changes. Throws a DesignLensError with a readable
 * message on any failure.
 */
export async function captureTab(
  tab: ActiveTabInfo,
  settings: Pick<Settings, 'autoScroll'>,
  onProgress: (step: ProgressStep) => void,
): Promise<CaptureResult> {
  const restriction = getPageRestriction(tab.url);
  if (restriction.restricted) throw new DesignLensError('RESTRICTED_PAGE', restriction.reason);

  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const options: CaptureOptions = {
    autoScroll: settings.autoScroll,
    budgets: EXTRACTION_BUDGETS,
    tuning: CAPTURE_TUNING,
  };
  const budgetMs =
    EXTRACTION_BUDGETS.maxScrollTimeMs + EXTRACTION_BUDGETS.maxStabilizeTimeMs + EXTRACTION_BUDGETS.maxCaptureTimeMs;
  const timeoutMs = budgetMs + EXTRACTION_MESSAGE_GRACE_MS;

  let current: ProgressStep = 'preparing';
  const report = (step: ProgressStep) => {
    if (STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(current)) {
      current = step;
      onProgress(step);
    }
  };
  const onRuntimeMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (isProgressMessage(message) && message.requestId === requestId && sender.tab?.id === tab.id) {
      report(message.step);
    }
  };

  onProgress('preparing');
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  const watch = watchNavigation(tab.id);
  const warnings: CaptureWarning[] = [];
  let cssInserted = false;
  let prepareMs = 0;
  let failure: unknown;
  let result: CaptureResult | undefined;

  try {
    await Promise.race([injectExtractor(tab.id), watch.navigated]);
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css: PAUSE_ANIMATIONS_CSS, origin: 'USER' });
    cssInserted = true;
    prepareMs = Math.round(performance.now() - startedAt);

    const reply = await Promise.race([
      withTimeout(
        send(tab.id, { type: 'designlens/extract', requestId, options }),
        timeoutMs,
        () =>
          new DesignLensError(
            'TIMEOUT',
            `The page did not answer within ${Math.round(timeoutMs / 1000)} seconds, so the capture was abandoned.`,
          ),
      ),
      watch.navigated,
    ]);

    if (!isObject(reply) || typeof reply.ok !== 'boolean') {
      throw new DesignLensError('EXTRACTION_FAILED', 'The page script returned an unexpected reply.');
    }
    if (reply.ok === false) {
      const error = isObject(reply.error) ? reply.error : {};
      const message = typeof error.message === 'string' ? error.message : 'unknown error';
      throw new DesignLensError(
        error.code === 'BUSY' ? 'BUSY' : 'EXTRACTION_FAILED',
        `Capture failed: ${message}`,
      );
    }
    if (reply.kind !== 'result') throw new DesignLensError('EXTRACTION_FAILED', 'The page script returned no result.');

    const validation = validateCaptureResult(reply.result);
    if (!validation.ok) {
      throw new DesignLensError('INVALID_RESULT', `The captured data was rejected as invalid: ${validation.reason}.`);
    }
    result = validation.result;
  } catch (error) {
    failure = error;
    // Best effort: tell a still-running extractor to stop so it restores the page promptly.
    await send(tab.id, { type: 'designlens/abort', requestId }).catch(() => undefined);
  } finally {
    report('cleaning-up');
    watch.dispose();
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }

  const cleanupStartedAt = performance.now();
  if (cssInserted) {
    try {
      await chrome.scripting.removeCSS({ target: { tabId: tab.id }, css: PAUSE_ANIMATIONS_CSS, origin: 'USER' });
    } catch (error) {
      // After a navigation the injected CSS is already gone, so only report other failures.
      if (!failure) {
        warnings.push({
          code: 'css-removal-failed',
          message: `Could not remove the temporary animation-pause CSS: ${toErrorMessage(error)}`,
        });
      }
    }
  }
  const cleanupMs = Math.round(performance.now() - cleanupStartedAt);

  if (failure !== undefined || !result) throw await explainFailure(failure, tab);

  const { durationsMs } = result.stats;
  durationsMs.prepare += prepareMs;
  durationsMs.cleanup += cleanupMs;
  durationsMs.total = Math.round(performance.now() - startedAt);
  result.warnings.push(...warnings);
  report('done');
  return result;
}
