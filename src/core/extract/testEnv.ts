// Test helpers: a fake page environment for the capture pipeline (jsdom has no layout).
import type { CaptureOptions } from '../../shared/types';
import type { DefaultStyleSource } from './defaults';
import type { RunEnv } from './run';
import type { ScrollContainer } from './scrollContainer';
import type { CaptureEnv, RectLike } from './walker';

export interface FakeDefaults extends DefaultStyleSource {
  disposed: number;
}

export function fakeDefaults(): FakeDefaults {
  const defaults: FakeDefaults = {
    disposed: 0,
    problem: null,
    forElement: () => ({}),
    forPseudo: () => ({}),
    owns: () => false,
    dispose: () => {
      defaults.disposed++;
    },
  };
  return defaults;
}

export const BOX: RectLike = { left: 0, top: 0, width: 100, height: 20 };

export function makeCaptureEnv(doc: Document, overrides: Partial<CaptureEnv> = {}): CaptureEnv {
  return {
    doc,
    now: () => 0,
    yieldNow: async () => undefined,
    getRect: () => BOX,
    getScroll: () => ({ x: 0, y: 0 }),
    getViewport: () => ({ width: 1000, height: 800 }),
    // jsdom cannot compute pseudo-element styles, so tests see "no pseudo-element" unless they override this.
    getComputedStyle: (el, pseudo) =>
      pseudo
        ? ({ content: 'none', display: 'inline', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration)
        : (doc.defaultView as Window).getComputedStyle(el),
    getShadow: (el) => (el.shadowRoot ? { kind: 'open', root: el.shadowRoot } : null),
    ...overrides,
  };
}

export function fakeContainer(partial: Partial<FakeContainer> = {}): FakeContainer {
  return { scrollTop: 0, scrollHeight: 3000, clientHeight: 700, log: [], scrollable: true, ...partial };
}

/** Options with every delay shortened so pipeline tests run in milliseconds. */
export const FAST_OPTIONS: CaptureOptions = {
  autoScroll: true,
  budgets: {
    maxNodes: 1000,
    maxCaptureTimeMs: 5000,
    maxTextLength: 50,
    maxScrollHeightPx: 30_000,
    maxScrollTimeMs: 5000,
    maxStabilizeTimeMs: 50,
  },
  tuning: {
    stabilizeQuietMs: 1,
    scrollStepDelayMs: 0,
    scrollBottomSettleMs: 0,
    scrollSettleMs: 0,
    scrollMinOverflowPx: 100,
    scrollStepRatio: 0.8,
    chunkTimeMs: 1000,
    overlayMinZIndex: 100,
    overlayMinViewportCoverage: 0.25,
  },
};

export interface FakeContainer {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** Every scrollTop the pipeline set, in order. */
  log: number[];
  /** When false, assigning scrollTop has no effect (like overflow:hidden). */
  scrollable: boolean;
}

export interface FakeRunEnv extends RunEnv {
  page: { x: number; y: number; documentHeight: number };
  /** The inner scroll container the fake page offers, if any (set `env.container = {...}`). */
  container: FakeContainer | null;
  /** How many times the pipeline went looking for a container. */
  containerSearches: number;
  defaults: FakeDefaults;
  scrollLog: number[];
}

export function makeRunEnv(doc: Document, overrides: Partial<RunEnv> = {}): FakeRunEnv {
  const page = { x: 0, y: 0, documentHeight: 2400 };
  const defaults = fakeDefaults();
  const scrollLog: number[] = [];
  const state: { container: FakeContainer | null; searches: number } = { container: null, searches: 0 };
  const base = makeCaptureEnv(doc, { getScroll: () => ({ x: page.x, y: page.y }) });
  const env: FakeRunEnv = {
    ...base,
    get container() {
      return state.container;
    },
    set container(value: FakeContainer | null) {
      state.container = value;
    },
    get containerSearches() {
      return state.searches;
    },
    win: { innerWidth: 1000, innerHeight: 800, devicePixelRatio: 2 },
    page,
    defaults,
    scrollLog,
    scroll: {
      now: () => Date.now(),
      delay: async () => undefined,
      getScrollY: () => page.y,
      getViewportHeight: () => 800,
      getDocumentHeight: () => page.documentHeight,
      scrollTo: (y) => {
        page.y = y;
        scrollLog.push(y);
      },
    },
    quiet: {
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      observe: () => () => undefined,
    },
    findScrollContainer: (): ScrollContainer | null => {
      state.searches++;
      const c = state.container;
      if (!c) return null;
      return {
        descriptor: 'main (depth 2)',
        scroll: {
          now: () => Date.now(),
          delay: async () => undefined,
          getScrollY: () => c.scrollTop,
          getViewportHeight: () => c.clientHeight,
          getDocumentHeight: () => c.scrollHeight,
          scrollTo: (y) => {
            c.log.push(y);
            if (c.scrollable) c.scrollTop = Math.min(y, c.scrollHeight - c.clientHeight);
          },
        },
      };
    },
    scrollToPosition: (x, y) => {
      page.x = x;
      page.y = y;
    },
    createDefaults: () => defaults,
    ...overrides,
  };
  return env;
}
