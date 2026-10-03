import { parseCss, resolveCssSources, validateRawCss } from '@/src/core/css';
import type { FetchText } from '@/src/core/css';
import { CSS_COLLECT_TIMEOUT_MS, CSS_FETCH_CONCURRENCY, CSS_LIMITS } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import { formatBytes } from '@/src/shared/format';
import type { ActiveTabInfo, CaptureWarning, CssData, CssLimits, RawCssCollection } from '@/src/shared/types';

/**
 * Download one stylesheet from the side panel (host permissions let it read cross-origin CSS).
 * Rejects with a readable reason on HTTP errors, timeouts and files over the size cap.
 */
export function createCssFetcher(limits: CssLimits = CSS_LIMITS): FetchText {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
    const tooLarge = () => new Error(`the file is larger than the ${formatBytes(limits.maxFetchBytes)} limit`);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > limits.maxFetchBytes) throw tooLarge();
      if (!response.body) return await response.text();

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limits.maxFetchBytes) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge();
        }
        chunks.push(value);
      }
      const joined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder('utf-8').decode(joined);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`timed out after ${limits.fetchTimeoutMs / 1000} seconds`, { cause: error });
      }
      throw new Error(toErrorMessage(error), { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Ask the (still injected) extractor for the page's stylesheets. Rejects with a readable reason. */
async function requestStylesheets(tab: ActiveTabInfo, limits: CssLimits): Promise<RawCssCollection> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the page did not hand over its stylesheets in time')), CSS_COLLECT_TIMEOUT_MS);
  });
  try {
    const reply: unknown = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'designlens/collect-css', limits }, { frameId: 0 }),
      timeout,
    ]);
    if (typeof reply !== 'object' || reply === null || !('ok' in reply)) throw new Error('unexpected reply from the page');
    if (reply.ok !== true) {
      const error = 'error' in reply && typeof reply.error === 'object' && reply.error !== null ? reply.error : {};
      throw new Error('message' in error && typeof error.message === 'string' ? error.message : 'the page reported an error');
    }
    const css = 'css' in reply ? reply.css : undefined;
    const checked = validateRawCss(css);
    if (!checked.ok) throw new Error(checked.reason);
    return checked.css;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collect, download and parse the page's CSS. Never throws: any failure becomes a warning on the
 * returned data (which is then empty or partial), so token generation can still go on.
 */
export async function collectCssData(
  tab: ActiveTabInfo,
  onStep: (step: 'collecting-css' | 'parsing-css') => void,
  limits: CssLimits = CSS_LIMITS,
  fetchText: FetchText = createCssFetcher(limits),
): Promise<CssData> {
  const warnings: CaptureWarning[] = [];
  try {
    onStep('collecting-css');
    let raw: RawCssCollection;
    try {
      raw = await requestStylesheets(tab, limits);
    } catch (error) {
      warnings.push({ code: 'css-collect-failed', message: `Could not read the page's stylesheets: ${toErrorMessage(error)}.` });
      return parseCss([], limits, { warnings });
    }
    const resolved = await resolveCssSources(raw, fetchText, limits, CSS_FETCH_CONCURRENCY);
    onStep('parsing-css');
    return parseCss(resolved.sources, limits, {
      fetchedSheets: resolved.fetched,
      unreadableSheets: resolved.unreadable,
      warnings: resolved.warnings,
    });
  } catch (error) {
    warnings.push({ code: 'css-failed', message: `CSS analysis failed: ${toErrorMessage(error)}.` });
    return parseCss([], limits, { warnings });
  }
}
