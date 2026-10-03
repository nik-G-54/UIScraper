import { IframeDefaultStyles } from './defaults';
import { containerDescriptor, pickScrollContainer } from './scrollContainer';
import type { ScrollCandidate, ScrollContainer } from './scrollContainer';
import type { RunEnv } from './run';
import type { ShadowInfo } from './walker';

function getShadow(el: Element): ShadowInfo {
  if (el.shadowRoot) return { kind: 'open', root: el.shadowRoot };
  // Content scripts can tell that a *closed* root exists (but cannot read it).
  const dom = typeof chrome === 'undefined' ? undefined : chrome.dom;
  if (dom?.openOrClosedShadowRoot?.(el as HTMLElement)) return { kind: 'closed' };
  return null;
}

function depthOf(el: Element): number {
  let depth = 0;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) depth++;
  return depth;
}

/** The real page: window, document, timers, MutationObserver. */
export function createBrowserEnv(win: Window & typeof globalThis): RunEnv {
  const doc = win.document;
  const root = doc.documentElement;
  const documentHeight = () =>
    Math.max(root.scrollHeight, root.offsetHeight, doc.body ? doc.body.scrollHeight : 0);
  const delay = (ms: number) => new Promise<void>((resolve) => win.setTimeout(resolve, ms));

  return {
    doc,
    win,
    now: () => win.performance.now(),
    yieldNow: () => delay(0),
    getRect: (el) => el.getBoundingClientRect(),
    getScroll: () => ({ x: win.scrollX, y: win.scrollY }),
    getViewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
    getComputedStyle: (el, pseudo) => win.getComputedStyle(el, pseudo),
    getShadow,
    scroll: {
      now: () => win.performance.now(),
      delay,
      getScrollY: () => win.scrollY,
      getViewportHeight: () => win.innerHeight,
      getDocumentHeight: documentHeight,
      scrollTo: (y) => win.scrollTo({ top: y, behavior: 'instant' }),
    },
    findScrollContainer: (minOverflowPx): ScrollContainer | null => {
      const candidates: ScrollCandidate<Element>[] = [];
      // documentElement is the window's own scroller; body is allowed (an `overflow:auto` body is common).
      for (const el of doc.body ? [doc.body, ...doc.body.querySelectorAll('*')] : []) {
        // Cheap geometry test first; computed style only for elements that actually overflow.
        if (el.clientHeight <= 0 || el.scrollHeight - el.clientHeight < minOverflowPx) continue;
        const style = win.getComputedStyle(el);
        const box = el.getBoundingClientRect();
        candidates.push({
          handle: el,
          tag: el.localName,
          overflowY: style.overflowY,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          rect: box,
          rendered: style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0,
        });
      }
      const picked = pickScrollContainer(candidates, { width: win.innerWidth, height: win.innerHeight }, minOverflowPx);
      if (!picked) return null;
      const el = picked.handle;
      return {
        descriptor: containerDescriptor(picked.tag, depthOf(el)),
        scroll: {
          now: () => win.performance.now(),
          delay,
          getScrollY: () => el.scrollTop,
          getViewportHeight: () => el.clientHeight,
          getDocumentHeight: () => el.scrollHeight,
          scrollTo: (y) => el.scrollTo({ top: y, behavior: 'instant' }),
        },
      };
    },
    quiet: {
      now: () => win.performance.now(),
      setTimeout: (callback, ms) => win.setTimeout(callback, ms),
      clearTimeout: (handle) => win.clearTimeout(handle as number | undefined),
      observe: (onMutation) => {
        const observer = new win.MutationObserver(onMutation);
        observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
        return () => observer.disconnect();
      },
    },
    scrollToPosition: (x, y) => win.scrollTo({ left: x, top: y, behavior: 'instant' }),
    createDefaults: (props) => new IframeDefaultStyles(doc, props),
  };
}
