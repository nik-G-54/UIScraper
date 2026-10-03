import type { PageProbeData } from '../../shared/types';

/**
 * Injected on demand with chrome.scripting.executeScript (ISOLATED world).
 *
 * It is serialized and run inside the page, so it MUST be fully self-contained:
 * no imports used at runtime, no references to outer variables. It is read-only
 * and leaves the page untouched.
 */
export function probePage(): PageProbeData {
  const doc = document;
  const root = doc.documentElement;
  const body = doc.body;
  return {
    title: doc.title,
    url: location.href,
    nodeCount: doc.getElementsByTagName('*').length,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    documentHeight: Math.max(root.scrollHeight, root.offsetHeight, body ? body.scrollHeight : 0),
    timestamp: new Date().toISOString(),
  };
}
