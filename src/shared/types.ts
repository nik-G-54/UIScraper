/**
 * Single source of truth for data passed between extension contexts
 * (page script <-> side panel <-> background). See CLAUDE.md rule 3.
 */

/** Bump when the shape of any extraction result changes. */
export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// Settings and usage
// ---------------------------------------------------------------------------

export const AI_MODES = ['auto', 'always', 'off'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** Providers the UI can select. Gemini is the default; more can be added in Phase 7. */
export const AI_PROVIDERS = ['gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export interface Settings {
  aiMode: AiMode;
  aiProvider: AiProviderId;
  /** Stored only in chrome.storage.local. Never hardcode or log. */
  apiKey: string;
  /** Free text; there is deliberately no hardcoded model list. */
  model: string;
  /** User-set cap on AI requests per local day. */
  dailyAiLimit: number;
  /** Scroll the page during capture so lazy-loaded content renders. */
  autoScroll: boolean;
}

/** Persisted daily AI request counter. `date` is the local date as YYYY-MM-DD. */
export interface AiUsageRecord {
  date: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Tabs and page restrictions
// ---------------------------------------------------------------------------

export interface ActiveTabInfo {
  id: number;
  title: string;
  url: string;
}

export type RestrictionKind =
  | 'no-url'
  | 'invalid-url'
  | 'browser-page'
  | 'extension-page'
  | 'web-store'
  | 'local-file'
  | 'pdf-viewer'
  | 'unsupported-protocol';

export type PageRestriction =
  | { restricted: false }
  | { restricted: true; kind: RestrictionKind; reason: string };

// ---------------------------------------------------------------------------
// Capture configuration (limits live in src/shared/config.ts)
// ---------------------------------------------------------------------------

/** Hard limits. Hitting one stops that step gracefully and marks the result truncated. */
export interface ExtractionBudgets {
  /** Stop capturing after this many nodes. */
  maxNodes: number;
  /** Stop the DOM walk after this long (ms). */
  maxCaptureTimeMs: number;
  /** Max length of a text snippet, attribute value or pseudo-element content. */
  maxTextLength: number;
  /** Stop lazy-load scrolling once this document offset has been reached (CSS px). */
  maxScrollHeightPx: number;
  /** Stop lazy-load scrolling after this long (ms). */
  maxScrollTimeMs: number;
  /** Stop waiting for the DOM to go quiet after this long (ms). */
  maxStabilizeTimeMs: number;
}

/** Soft knobs (not budgets): pacing and heuristics. */
export interface CaptureTuning {
  /** DOM must be mutation-free this long to count as stable (ms). */
  stabilizeQuietMs: number;
  /** Pause after each scroll step so lazy content can start loading (ms). */
  scrollStepDelayMs: number;
  /** At the bottom, wait this long to see whether the page grows (ms). */
  scrollBottomSettleMs: number;
  /** Pause after scrolling back to the top before capturing (ms). */
  scrollSettleMs: number;
  /** A window/container counts as scrollable only if its content overflows by at least this much (px). */
  scrollMinOverflowPx: number;
  /** Each scroll step moves this fraction of the viewport height. */
  scrollStepRatio: number;
  /** Yield to the event loop after this much continuous work (ms). */
  chunkTimeMs: number;
  /** Fixed/sticky elements at or above this z-index may be overlays. */
  overlayMinZIndex: number;
  /** ...and cover at least this share of the viewport (0..1). */
  overlayMinViewportCoverage: number;
}

export interface CaptureOptions {
  autoScroll: boolean;
  budgets: ExtractionBudgets;
  tuning: CaptureTuning;
}

/**
 * Budgets whose exhaustion means data may be missing. (Not settling within `maxStabilizeTimeMs`
 * is only a warning: the capture is complete, it just may show a mid-animation state.)
 */
export type TruncationReason = keyof Pick<
  ExtractionBudgets,
  'maxNodes' | 'maxCaptureTimeMs' | 'maxScrollHeightPx' | 'maxScrollTimeMs'
>;

// ---------------------------------------------------------------------------
// Capture result
// ---------------------------------------------------------------------------

/** Document coordinates (viewport rect + scroll offset), in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whitelisted computed properties whose value differs from the browser default for the
 * element's tag. A property that is absent has its default value.
 */
export type StyleRecord = Record<string, string>;

export type HiddenReason = 'visibility-hidden' | 'opacity-0' | 'ancestor-opacity-0' | 'zero-size';

export type SkipReason = 'ignored-tag' | 'display-none' | 'budget-truncated';

export interface CapturedPseudo {
  /** Computed `content` value, e.g. `"→"`. */
  content: string;
  styleId: number;
}

export interface CapturedNode {
  /** Equal to the node's index in `CaptureResult.nodes`. */
  id: number;
  parentId: number | null;
  childIds: number[];
  depth: number;
  /** Lowercase local name. */
  tag: string;
  /** Subset of id, role, aria-label, href, src, srcset, alt, type, placeholder, title, data-src. */
  attrs?: Record<string, string>;
  /** Trimmed snippet of the element's own direct text. */
  text?: string;
  rect: Rect;
  /** Set when the element is not visible; hidden nodes have `styleId: null`. */
  hidden?: HiddenReason;
  /** True when the element lives inside a shadow root. */
  inShadow: boolean;
  /** Index into `CaptureResult.styleTable`, or null for hidden nodes. */
  styleId: number | null;
  pseudo?: { before?: CapturedPseudo; after?: CapturedPseudo };
  /** Inline <svg>: recorded as one node, children not walked. */
  svg?: true;
  /** iframe/canvas/video/embed/object: see `CaptureResult.placeholders`. */
  placeholder?: true;
  /** Host of an open shadow root (its children are the shadow tree). */
  shadowHost?: true;
  /** Host of a closed shadow root: contents are opaque. */
  closedShadowHost?: true;
  /** Fixed/sticky, high z-index and covering much of the viewport (cookie banner, modal...). */
  possibleOverlay?: true;
}

export interface CapturedPlaceholder {
  nodeId: number;
  tag: string;
  /** Absolute URL, or null when the element has none (e.g. canvas). */
  src: string | null;
  rect: Rect;
  /** Same origin as the page; null when there is no src to compare. */
  sameOrigin: boolean | null;
}

export interface CaptureWarning {
  code: string;
  message: string;
}

export interface CaptureMeta {
  url: string;
  title: string;
  lang: string;
  dir: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  documentWidth: number;
  documentHeight: number;
  /** Content of <meta name="color-scheme">, or null. */
  colorSchemeMeta: string | null;
  /** ISO 8601 */
  timestamp: string;
}

export type PipelineStep = 'prepare' | 'scroll' | 'stabilize' | 'capture' | 'cleanup';

export type ScrollStopReason =
  | 'disabled'
  | 'bottom'
  | 'maxScrollHeightPx'
  | 'maxScrollTimeMs'
  | 'stuck'
  | 'aborted';

export type ScrollTarget = 'window' | 'container';

export interface CaptureStats {
  nodesVisited: number;
  nodesCaptured: number;
  nodesSkipped: Record<SkipReason, number>;
  /** Captured nodes that are not visible (no styles recorded). */
  hiddenNodes: number;
  uniqueStyles: number;
  pseudoElements: number;
  placeholders: number;
  overlays: number;
  shadowRoots: number;
  closedShadowHosts: number;
  truncated: boolean;
  /** Every budget that was hit; empty unless `truncated`. */
  truncatedReasons: TruncationReason[];
  scroll: {
    steps: number;
    stoppedBy: ScrollStopReason;
    /** What was scrolled for lazy content: the window, or an inner scroll container. */
    target: ScrollTarget;
    /** Short descriptor of the container, e.g. "main (depth 3)"; null for the window. */
    container: string | null;
  };
  stabilize: { settled: boolean };
  /** Time per pipeline step, plus the wall-clock total. */
  durationsMs: Record<PipelineStep, number> & { total: number };
  /** Size of the result serialized as compact JSON (UTF-8). */
  resultBytes: number;
}

export interface CaptureResult {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: CaptureMeta;
  stats: CaptureStats;
  nodes: CapturedNode[];
  styleTable: StyleRecord[];
  placeholders: CapturedPlaceholder[];
  warnings: CaptureWarning[];
}

// ---------------------------------------------------------------------------
// Side panel <-> injected extractor messages
// ---------------------------------------------------------------------------

export type ProgressStep = 'preparing' | 'scrolling' | 'stabilizing' | 'capturing' | 'cleaning-up' | 'done';

export type ExtractorRequest =
  | { type: 'designlens/ping' }
  | { type: 'designlens/extract'; requestId: string; options: CaptureOptions }
  | { type: 'designlens/abort'; requestId: string };

export type ExtractorErrorCode = 'ABORTED' | 'BUSY' | 'EXTRACTION_FAILED';

export type ExtractorResponse =
  | { ok: true; kind: 'pong'; schemaVersion: number }
  | { ok: true; kind: 'result'; result: CaptureResult }
  | { ok: true; kind: 'abort-ack' }
  | { ok: false; error: { code: ExtractorErrorCode; message: string } };

/** Sent by the extractor via chrome.runtime.sendMessage while a capture runs. */
export interface ExtractorProgressMessage {
  type: 'designlens/progress';
  requestId: string;
  step: ProgressStep;
}
