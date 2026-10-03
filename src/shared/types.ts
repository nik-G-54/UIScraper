/**
 * Single source of truth for data passed between extension contexts
 * (page script <-> side panel <-> background). See CLAUDE.md rule 3.
 */

/** Bump when the shape of any extraction result changes. */
export const SCHEMA_VERSION = 4;

// ---------------------------------------------------------------------------
// Settings and usage
// ---------------------------------------------------------------------------

export const AI_MODES = ['auto', 'always', 'off'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** Providers the UI can select. Gemini is the default; more can be added in Phase 7. */
export const AI_PROVIDERS = ['gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Widths the capture can render the page at; `window` keeps the current (side-panel-shrunk) viewport. */
export const CAPTURE_WIDTH_PRESETS = [1440, 1280, 768, 390] as const;
export type CaptureWidthSetting = (typeof CAPTURE_WIDTH_PRESETS)[number] | 'window';

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
  /** Viewport width the page is rendered at while capturing (via the debugger emulation override). */
  captureWidth: CaptureWidthSetting;
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
  /** Width (CSS px) the page was rendered at: the viewport width during the capture. */
  captureWidth: number;
  /** True when the side panel forced `captureWidth` with a device-metrics override. */
  emulated: boolean;
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
  | { type: 'designlens/collect-css'; limits: CssLimits }
  | { type: 'designlens/match-selectors'; selectors: string[]; limits: SelectorMatchLimits }
  | { type: 'designlens/collect-assets'; limits: AssetLimits }
  | { type: 'designlens/abort'; requestId: string };

export type ExtractorErrorCode = 'ABORTED' | 'BUSY' | 'EXTRACTION_FAILED';

export type ExtractorResponse =
  | { ok: true; kind: 'pong'; schemaVersion: number }
  | { ok: true; kind: 'result'; result: CaptureResult }
  | { ok: true; kind: 'css'; css: RawCssCollection }
  | { ok: true; kind: 'selector-matches'; matches: SelectorMatches }
  | { ok: true; kind: 'assets'; assets: RawAssetCollection }
  | { ok: true; kind: 'abort-ack' }
  | { ok: false; error: { code: ExtractorErrorCode; message: string } };

/** Sent by the extractor via chrome.runtime.sendMessage while a capture runs. */
export interface ExtractorProgressMessage {
  type: 'designlens/progress';
  requestId: string;
  step: ProgressStep;
}

/** Everything the side panel shows while analyzing: the capture steps, then CSS and tokens. */
export type AnalysisStep =
  | 'emulating-width'
  | Exclude<ProgressStep, 'done'>
  | 'collecting-css'
  | 'parsing-css'
  | 'generating-tokens'
  | 'analyzing-layout'
  | 'collecting-assets'
  | 'downloading-assets'
  | 'taking-screenshots'
  | 'writing-design-md'
  | 'zipping'
  | 'done';

// ---------------------------------------------------------------------------
// CSS collection (Phase 2)
// ---------------------------------------------------------------------------

/** Limits for collecting, fetching and parsing CSS (values live in src/shared/config.ts). */
export interface CssLimits {
  /** Stylesheets read from the page; the rest are skipped with a warning. */
  maxSheets: number;
  /** Longest CSS text kept per stylesheet (characters). */
  maxSheetChars: number;
  /** Largest cross-origin / @import file the side panel downloads (bytes). */
  maxFetchBytes: number;
  fetchTimeoutMs: number;
  /** How deep @import chains are followed (top-level sheets are depth 0). */
  maxImportDepth: number;
  /** Cap on recorded state (:hover etc.) rules. */
  maxStateRules: number;
  /** Cap on recorded custom properties. */
  maxVariables: number;
  maxKeyframes: number;
  maxFontFaces: number;
}

export type RawStylesheetKind = 'link' | 'style' | 'adopted';

/** One stylesheet as seen by the extractor. `cssText` is null when it could not be read. */
export interface RawStylesheet {
  kind: RawStylesheetKind;
  /** Absolute URL for <link> sheets, else null. */
  href: string | null;
  /** What relative url() / @import values in `cssText` resolve against. */
  baseUrl: string;
  /** `media` of the <link>/<style>, or null when it applies everywhere. */
  media: string | null;
  inShadow: boolean;
  cssText: string | null;
  /** Why `cssText` is null (e.g. cross-origin: fetch `href` instead). */
  error?: string;
  /** `cssText` was cut at `CssLimits.maxSheetChars`. */
  truncated?: boolean;
}

/** Reply to `designlens/collect-css`. */
export interface RawCssCollection {
  schemaVersion: typeof SCHEMA_VERSION;
  documentUrl: string;
  sheets: RawStylesheet[];
  warnings: CaptureWarning[];
}

export type CssTheme = 'default' | 'light' | 'dark' | 'other';

export interface CssVariable {
  /** Including the leading `--`. */
  name: string;
  value: string;
  /** The selector that declared it, e.g. `:root`, `.dark`. */
  selector: string;
  theme: CssTheme;
  /** Enclosing @media condition, or null. */
  media: string | null;
}

export interface CssBreakpoint {
  feature: 'min-width' | 'max-width';
  /** As written, e.g. `48rem`. */
  value: string;
  /** Pixels (em/rem = 16px); null for other units. */
  px: number | null;
  count: number;
}

export const CSS_STATES = ['hover', 'focus', 'focus-visible', 'active', 'disabled'] as const;
export type CssState = (typeof CSS_STATES)[number];

export interface CssStateRule {
  /** The selector with every state pseudo-class removed. */
  selector: string;
  /** The first state pseudo-class the selector contained. */
  state: CssState;
  declarations: Record<string, string>;
  media: string | null;
}

export interface CssKeyframes {
  name: string;
  /** Number of keyframe blocks (`0%`, `50%`...). */
  steps: number;
  /** Animated properties, sorted. */
  properties: string[];
}

export interface CssFontFaceSource {
  url: string;
  format: string | null;
}

export interface CssFontFace {
  family: string;
  weight: string;
  style: string;
  display: string | null;
  sources: CssFontFaceSource[];
}

export interface CssDarkMode {
  detected: boolean;
  /** A `prefers-color-scheme: dark` media query exists. */
  viaMediaQuery: boolean;
  /** Dark-theme selectors seen (`.dark`, `[data-theme="dark"]`...), capped. */
  selectors: string[];
  /** Rules found inside dark contexts. */
  ruleCount: number;
  /** Custom properties the dark contexts override. */
  variables: CssVariable[];
}

export interface FrameworkHint {
  name: string;
  version?: string;
  evidence: string;
}

export interface CssStats {
  sheets: number;
  fetchedSheets: number;
  unreadableSheets: number;
  rules: number;
  bytes: number;
}

/** Everything learned from the page's CSS text (output of `parseCss`). */
export interface CssData {
  /** Custom properties on :root / html / body / theme selectors, excluding dark overrides. */
  variables: CssVariable[];
  breakpoints: CssBreakpoint[];
  stateRules: CssStateRule[];
  keyframes: CssKeyframes[];
  fontFaces: CssFontFace[];
  darkMode: CssDarkMode;
  frameworks: FrameworkHint[];
  stats: CssStats;
  warnings: CaptureWarning[];
}

// ---------------------------------------------------------------------------
// Design tokens (Phase 3)
// ---------------------------------------------------------------------------

/** Bump when the shape of `DesignTokens` changes. */
export const TOKENS_SCHEMA_VERSION = 2;

export const COLOR_ROLES = [
  'background',
  'surface',
  'text-primary',
  'text-muted',
  'primary',
  'accent',
  'border',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export type ColorUse = 'text' | 'background' | 'border' | 'shadow' | 'gradient';

export interface ColorToken {
  /** `#rrggbb`, or `#rrggbbaa` when translucent. */
  hex: string;
  role: ColorRole | null;
  /** Custom property (with `--`) whose value equals this colour, if any. */
  variable: string | null;
  /** Node-uses of this colour (all kinds summed). */
  count: number;
  /** Summed node area in px². */
  area: number;
  uses: Record<ColorUse, number>;
  /** Raw colours folded into this one (1 = none). */
  merged: number;
}

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display';

export interface FontFamilyToken {
  /** First non-generic family, unquoted. */
  name: string;
  /** Cleaned stack, e.g. `Inter, system-ui, sans-serif`. */
  stack: string;
  category: FontCategory;
  count: number;
  role: 'body' | 'heading' | 'mono' | null;
}

export interface ScaleValue {
  /** Pixels. */
  px: number;
  count: number;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface TagTypography {
  tag: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: string;
  /** Ratio to font size (`1.5`), or `normal`. */
  lineHeight: string;
  letterSpacing: string;
  textTransform: string | null;
  color: string | null;
  count: number;
}

export interface TypographyTokens {
  families: FontFamilyToken[];
  /** Ascending by size. */
  sizes: ScaleValue[];
  weights: ValueCount[];
  lineHeights: ValueCount[];
  letterSpacings: ValueCount[];
  tags: TagTypography[];
}

export interface SpacingTokens {
  baseUnit: 4 | 8 | null;
  /** Share (0..1) of spacing usages that are multiples of `baseUnit` (or of 4 when there is none). */
  coverage: number;
  /** Ascending by size. */
  scale: ScaleValue[];
}

export interface RadiusToken {
  /** e.g. `8px`, `50%`, `9999px`. */
  value: string;
  px: number | null;
  count: number;
}

export interface ShadowToken {
  value: string;
  count: number;
}

export interface MotionTokens {
  durations: { ms: number; count: number }[];
  easings: ValueCount[];
}

export interface BreakpointToken {
  px: number;
  count: number;
}

export interface GradientStop {
  /** `#rrggbb`/`#rrggbbaa`, or `transparent`. */
  color: string;
  /** As written, e.g. `40%`; null when the stop has no position. */
  position: string | null;
}

export interface GradientToken {
  /** The raw CSS value of one gradient layer. */
  value: string;
  kind: 'linear' | 'radial' | 'conic';
  repeating: boolean;
  stops: GradientStop[];
  /** Nodes that use it. */
  count: number;
}

export interface DesignTokens {
  schemaVersion: typeof TOKENS_SCHEMA_VERSION;
  source: { url: string; title: string; capturedAt: string };
  /** Most important first. */
  colors: ColorToken[];
  gradients: GradientToken[];
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusToken[];
  shadows: ShadowToken[];
  motion: MotionTokens;
  breakpoints: BreakpointToken[];
  frameworks: FrameworkHint[];
  cssVariables: { default: Record<string, string>; dark: Record<string, string> };
  darkMode: boolean;
}

// ---------------------------------------------------------------------------
// Layout and components (Phase 4)
// ---------------------------------------------------------------------------

/** Limits for matching CSS selectors against the captured elements (values live in src/shared/config.ts). */
export interface SelectorMatchLimits {
  maxSelectors: number;
  /** Matched node ids kept per selector. */
  maxMatchesPerSelector: number;
}

/** Selector -> ids of the captured nodes it matches (selectors that match nothing are left out). */
export type SelectorMatches = Record<string, number[]>;

export interface LayoutSummary {
  display: string;
  flexDirection: string | null;
  /** Number of grid tracks (grid), or children side by side (flex row); 1 for stacked content. */
  columns: number;
  gap: string | null;
  /** Content width limit in px (max-width, or the centered container's width); null when full width. */
  containerMaxWidth: number | null;
  /** How the content block sits in the page. */
  alignment: 'left' | 'center' | 'right' | 'full';
  paddingY: string | null;
}

/** One run of inline text with its own look (a span with another colour or weight). */
export interface TextRun {
  text: string;
  /** Normalized hex; null when the text is painted by a gradient/clip (see `gradientText`). */
  color: string | null;
  colorToken: string | null;
  fontWeight: string;
  /** Only set when it differs from the first run. */
  fontSizePx: number | null;
  gradientText: boolean;
}

export const KEY_ELEMENT_ROLES = ['heading', 'paragraph', 'button', 'badge', 'image', 'logo'] as const;
export type KeyElementRole = (typeof KEY_ELEMENT_ROLES)[number];

export interface ColorRef {
  hex: string;
  /** Name in theme.css, or null when no token is close enough. */
  token: string | null;
}

/** A visible element worth reproducing exactly: its measured look, not a guess. */
export interface KeyElement {
  nodeId: number;
  role: KeyElementRole;
  tag: string;
  /** Trimmed text (all runs joined), or the alt text of an image. */
  text: string | null;
  rect: Rect;
  fontFamily: string | null;
  fontSizePx: number | null;
  lineHeight: string | null;
  fontWeight: string | null;
  letterSpacing: string | null;
  color: ColorRef | null;
  background: ColorRef | null;
  /** e.g. `1px solid #e5edf5`. */
  border: string | null;
  /** Exact computed border-radius (`8px`, `50%`, `8px 8px 0px 0px`), null when square. */
  radius: string | null;
  /** True only when the radius is at least half the element's height. */
  pill: boolean;
  /** CSS shorthand, null when none. */
  padding: string | null;
  tailwind: string;
  /** In order; only present when the text has 2+ runs that look different. */
  runs: TextRun[];
  /** Gradient/canvas/image behind the text, blend modes, clipped-text effects. */
  notes: string[];
  /** Image URL (the `src` attribute), when the element is an `<img>`. */
  src: string | null;
}

export interface DecorativeLine {
  orientation: 'vertical' | 'horizontal';
  /** x for vertical lines, y for horizontal ones (document px). */
  at: number;
  thicknessPx: number;
  color: string | null;
  /** Length along its axis (px). */
  length: number;
}

export interface SectionGeometry {
  /** Content box (padding removed) of the main container, document px. */
  contentLeft: number;
  contentWidth: number;
  maxWidth: number | null;
  /** Left and right edge of the visible text and images (document px); null for an empty section. */
  inkLeft: number | null;
  inkRight: number | null;
  lines: DecorativeLine[];
}

export interface PageSection {
  index: number;
  nodeId: number;
  tag: string;
  /** Unique, readable: `header`, `hero`, `section-3`, `footer`. */
  name: string;
  rect: Rect;
  background: {
    hex: string | null;
    /** Name in theme.css (`primary`, `palette-2`) when the colour is a token. */
    token: string | null;
    gradient: string | null;
  };
  layout: LayoutSummary;
  headings: string[];
  /** Tailwind classes of the section element itself. */
  tailwind: string;
  /** Most important visible elements, in reading order. */
  keyElements: KeyElement[];
  geometry: SectionGeometry;
}

export const COMPONENT_KINDS = ['button', 'link', 'nav-item', 'input', 'badge', 'card', 'list-item', 'generic'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export interface ComponentVariant {
  count: number;
  nodeId: number;
  /** Visual properties that differ from the base look. */
  diff: Record<string, string>;
  tailwind: string;
}

export interface ComponentState {
  state: CssState;
  declarations: Record<string, string>;
  tailwind: string;
  /** True when the rule styles a descendant of the component rather than the component itself. */
  onDescendant: boolean;
}

export interface ComponentGroup {
  /** Unique name, e.g. `card`, `button`, `button-2`. */
  name: string;
  kind: ComponentKind;
  count: number;
  /** The most typical member. */
  nodeId: number;
  tag: string;
  size: { width: number; height: number };
  /** Short outline of the structure, e.g. `div[img, h3, p]`. */
  structure: string;
  text: string | null;
  tailwind: string;
  /** Exact border-radius of the representative member, null when square. */
  radius: string | null;
  /** True only when that radius is at least half the element's height. */
  pill: boolean;
  variants: ComponentVariant[];
  states: ComponentState[];
  /** Section where most members live. */
  section: string | null;
  /** Member node ids (capped). */
  members: number[];
}

export interface LayoutAnalysis {
  sections: PageSection[];
  components: ComponentGroup[];
  warnings: CaptureWarning[];
}

// ---------------------------------------------------------------------------
// Assets (Phase 5)
// ---------------------------------------------------------------------------

export interface AssetLimits {
  maxImages: number;
  maxSvgs: number;
  /** Longest inline <svg> markup read from the page (characters). */
  maxSvgChars: number;
  /** Longest data: URL read from the page (characters). */
  maxDataUrlChars: number;
}

export interface RawImage {
  nodeId: number;
  /** currentSrc, else src, else data-src (absolute). */
  url: string;
  srcset: string | null;
  naturalWidth: number;
  naturalHeight: number;
  alt: string | null;
  inPicture: boolean;
}

export interface RawSvg {
  nodeId: number;
  markup: string;
  width: number;
  height: number;
  label: string | null;
}

export interface RawFavicon {
  rel: string;
  href: string;
  sizes: string | null;
}

/** Reply to `designlens/collect-assets`. */
export interface RawAssetCollection {
  schemaVersion: typeof SCHEMA_VERSION;
  images: RawImage[];
  svgs: RawSvg[];
  favicons: RawFavicon[];
  warnings: CaptureWarning[];
}

export interface ImageAsset {
  id: string;
  /** Absolute URL (or a shortened `data:` URL). */
  url: string;
  kind: 'img' | 'css-background';
  nodeIds: number[];
  /** Times it appears on the page. */
  count: number;
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** Rendered size of its first use. */
  displayWidth: number;
  displayHeight: number;
  alt: string | null;
  section: string | null;
  /** Path inside the zip once downloaded, else null. */
  path: string | null;
  bytes: number | null;
  /** Why it was not downloaded. */
  skipped: string | null;
}

export interface IconAsset {
  id: string;
  /** Hash of the sanitized markup. */
  hash: string;
  /** Sanitized, size-capped markup. */
  markup: string;
  width: number;
  height: number;
  label: string | null;
  count: number;
  sections: string[];
  path: string | null;
}

export interface FaviconAsset {
  rel: string;
  url: string;
  sizes: string | null;
  path: string | null;
}

export interface FontAsset {
  family: string;
  weights: string[];
  styles: string[];
  display: string | null;
  sources: CssFontFaceSource[];
}

export interface LogoAsset {
  kind: 'img' | 'svg';
  /** `ImageAsset.id` or `IconAsset.id`. */
  assetId: string;
  section: string | null;
}

export interface AssetIndex {
  images: ImageAsset[];
  icons: IconAsset[];
  favicons: FaviconAsset[];
  fonts: FontAsset[];
  logo: LogoAsset | null;
  warnings: CaptureWarning[];
}

/** One cropped screenshot, ready to be zipped. */
export interface ScreenshotFile {
  /** Section name, or `full-page`. */
  name: string;
  path: string;
}

export interface ScreenshotIndex {
  fullPage: ScreenshotFile | null;
  sections: ScreenshotFile[];
  warnings: CaptureWarning[];
}
