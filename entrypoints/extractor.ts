import { collectAssets } from '@/src/core/assets/collect';
import { collectStylesheets } from '@/src/core/css/collect';
import { createBrowserEnv, createExtractorListener, installListener, runCapture } from '@/src/core/extract';
import { matchSelectors } from '@/src/core/extract/match';

/**
 * Unlisted script: bundled with its imports and injected on demand by the side panel with
 * chrome.scripting.executeScript({ files }) into the ISOLATED world of the top frame.
 * It only registers a message listener; nothing runs until the side panel sends "extract".
 */
export default defineUnlistedScript(() => {
  // Node id -> element of the most recent capture, used to answer selector and asset questions.
  let lastElements = new Map<number, Element>();

  const listener = createExtractorListener({
    extensionId: chrome.runtime.id,
    run: (options, onProgress, signal) =>
      runCapture(createBrowserEnv(window), options, onProgress, signal, (elements) => {
        lastElements = elements;
      }),
    collectCss: (limits) => collectStylesheets(document, limits),
    matchSelectors: (selectors, limits) => matchSelectors(document, lastElements, selectors, limits),
    collectAssets: (limits) => collectAssets(document, lastElements, limits),
    sendProgress: (message) => {
      // Fire and forget: if the side panel is closed there is nobody to receive it.
      chrome.runtime.sendMessage(message).catch(() => undefined);
    },
  });
  installListener(globalThis as unknown as Record<symbol, unknown>, chrome.runtime.onMessage, listener);
});
