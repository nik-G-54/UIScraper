import { SCHEMA_VERSION } from '@/src/shared/types';
import type { AssetLimits, ExtractorRequest, RawAssetCollection, SelectorMatches, SelectorMatchLimits } from '@/src/shared/types';

const PAGE_REPLY_TIMEOUT_MS = 20_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Send a request to the injected extractor and return its (still unchecked) successful reply. */
async function askPage(tabId: number, request: ExtractorRequest): Promise<Record<string, unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the page did not answer in time')), PAGE_REPLY_TIMEOUT_MS);
  });
  try {
    const reply: unknown = await Promise.race([chrome.tabs.sendMessage(tabId, request, { frameId: 0 }), timeout]);
    if (!isObject(reply) || typeof reply.ok !== 'boolean') throw new Error('unexpected reply from the page');
    if (reply.ok !== true) {
      const error = isObject(reply.error) ? reply.error : {};
      throw new Error(typeof error.message === 'string' ? error.message : 'the page reported an error');
    }
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

/** Which nodes of the last capture does each selector match? Rejects with a readable reason. */
export async function requestSelectorMatches(
  tabId: number,
  selectors: string[],
  limits: SelectorMatchLimits,
): Promise<SelectorMatches> {
  const reply = await askPage(tabId, { type: 'designlens/match-selectors', selectors, limits });
  if (reply.kind !== 'selector-matches' || !isObject(reply.matches)) throw new Error('unexpected reply from the page');
  const matches: SelectorMatches = {};
  for (const [selector, ids] of Object.entries(reply.matches)) {
    if (Array.isArray(ids) && ids.every((id) => Number.isInteger(id))) matches[selector] = ids as number[];
  }
  return matches;
}

/** Images, inline SVGs and favicons of the last capture. Rejects with a readable reason. */
export async function requestAssets(tabId: number, limits: AssetLimits): Promise<RawAssetCollection> {
  const reply = await askPage(tabId, { type: 'designlens/collect-assets', limits });
  const assets = reply.kind === 'assets' ? reply.assets : undefined;
  if (
    !isObject(assets) ||
    assets.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(assets.images) ||
    !Array.isArray(assets.svgs) ||
    !Array.isArray(assets.favicons) ||
    !Array.isArray(assets.warnings)
  ) {
    throw new Error('the page returned malformed asset data');
  }
  return assets as unknown as RawAssetCollection;
}
