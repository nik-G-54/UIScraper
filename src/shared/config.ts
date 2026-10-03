import type { AiLimits, AssetLimits, CaptureTuning, CssLimits, ExtractionBudgets, FrameLimits, MotionLimits, SelectorMatchLimits, Settings } from './types';

/**
 * Extraction budgets. Every extraction phase must read its limits from here
 * (CLAUDE.md rule 6) so they can be tuned in one place.
 */
export const EXTRACTION_BUDGETS: ExtractionBudgets = {
  maxNodes: 50_000,
  maxCaptureTimeMs: 20_000,
  maxTextLength: 200,
  maxScrollHeightPx: 30_000,
  maxScrollTimeMs: 10_000,
  maxStabilizeTimeMs: 3_000,
};

/** Pacing and heuristics for the capture pipeline. Not budgets: hitting these never truncates. */
export const CAPTURE_TUNING: CaptureTuning = {
  stabilizeQuietMs: 500,
  scrollStepDelayMs: 120,
  scrollBottomSettleMs: 400,
  scrollSettleMs: 150,
  scrollMinOverflowPx: 100,
  scrollStepRatio: 0.8,
  chunkTimeMs: 12,
  overlayMinZIndex: 100,
  overlayMinViewportCoverage: 0.25,
};

/** Path of the bundled on-demand extractor script inside the built extension. */
export const EXTRACTOR_SCRIPT_PATH = 'extractor.js';

/** Extra time the side panel allows, beyond the budgets, before declaring the page unresponsive. */
export const EXTRACTION_MESSAGE_GRACE_MS = 15_000;

export const DEFAULT_DAILY_AI_LIMIT = 15;

export const DEFAULT_MAIN_MODEL = 'gemini-3.8-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export const DEFAULT_SETTINGS: Settings = {
  aiMode: 'auto',
  aiProvider: 'gemini',
  apiKey: '',
  model: DEFAULT_MAIN_MODEL,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  maskPersonalData: true,
  dailyAiLimit: DEFAULT_DAILY_AI_LIMIT,
  autoScroll: true,
  captureWidth: 1440,
  captureMotion: true,
  capturePageLoad: false,
};

/** Limits for CSS collection and parsing (CLAUDE.md rule 6). Hitting one adds a warning. */
export const CSS_LIMITS: CssLimits = {
  maxSheets: 300,
  maxSheetChars: 4_000_000,
  maxFetchBytes: 3_000_000,
  fetchTimeoutMs: 8_000,
  maxImportDepth: 2,
  maxStateRules: 600,
  maxVariables: 2_000,
  maxKeyframes: 100,
  maxFontFaces: 100,
};

/** How many cross-origin stylesheets the side panel downloads at once. */
export const CSS_FETCH_CONCURRENCY = 6;

/** How long the side panel waits for the page to hand over its stylesheets. */
export const CSS_COLLECT_TIMEOUT_MS = 20_000;

/** Heuristics for design-token generation. */
export const TOKEN_TUNING = {
  /** CIEDE2000 distance (about one just-noticeable difference) at or below which two colours count as the same. */
  colorDeltaE: 1,
  /** Opacity at or below this is treated as transparent and ignored. */
  minColorAlpha: 0.02,
  /** Node area (px²) that weighs as much as one node when ranking colours. */
  areaUnitPx2: 10_000,
  /** OKLCH chroma at or above this counts as a saturated (brand-like) colour. */
  saturatedChroma: 0.08,
  /** Minimum hue distance (degrees) for a second brand colour to become `accent`. */
  accentMinHueDistance: 40,
  maxColors: 40,
  maxFontSizes: 12,
  maxSpacingValues: 16,
  /** Margins/paddings/gaps larger than this are layout offsets, not spacing tokens (px). */
  maxSpacingPx: 256,
  maxFamilies: 6,
  maxRadii: 6,
  maxShadows: 6,
  maxGradients: 12,
  maxBreakpoints: 6,
  maxCssVariablesInTokens: 300,
  /** Share of spacing values that must be multiples of a unit for it to be the base unit. */
  baseUnitCoverage: 0.75,
  /** Spacing at or below this is noise for base-unit detection (px). */
  baseUnitMinPx: 2,
};

/** Matching state-rule selectors against the captured elements. */
export const SELECTOR_MATCH_LIMITS: SelectorMatchLimits = {
  maxSelectors: 800,
  maxMatchesPerSelector: 300,
};

/** Page-side asset collection (what the extractor reads and sends back). */
export const ASSET_LIMITS: AssetLimits = {
  maxImages: 400,
  maxSvgs: 400,
  maxSvgChars: 30_000,
  maxDataUrlChars: 400_000,
};

/** What the side panel downloads for the zip. Hitting a cap skips the rest with a warning. */
export const ASSET_DOWNLOAD = {
  /** Images downloaded (largest on the page first). */
  maxImages: 60,
  maxImageBytes: 4_000_000,
  maxTotalBytes: 30_000_000,
  fetchTimeoutMs: 10_000,
  concurrency: 6,
  /** Images smaller than this on both axes (rendered, px) are tracking pixels and skipped. */
  minDisplayPx: 4,
  /** Inline SVG icons written into the zip. */
  maxIcons: 120,
  maxFavicons: 4,
  /** Sanitized SVG markup longer than this is dropped (characters). */
  maxSvgChars: 20_000,
};

/** Debugger-based viewport emulation and screenshots. */
export const SCREENSHOT = {
  /** A single Page.captureScreenshot clip is at most this tall (CSS px); taller pages are stitched. */
  maxClipHeightPx: 12_000,
  /** The document is captured down to this height only. */
  maxDocHeightPx: 30_000,
  /** Section crops are at most this tall (CSS px). */
  maxCropHeightPx: 4_000,
  maxSectionShots: 24,
  jpegQuality: 85,
  /** The emulated viewport is at least this tall (CSS px) so tall hero sections are not cut. */
  minEmulatedHeightPx: 900,
  /** Wait for layout after the viewport override changes (ms). */
  emulationSettleMs: 400,
  emulationTimeoutMs: 4_000,
};

/** Layout and component heuristics (Phase 4). */
export const LAYOUT_TUNING = {
  maxSections: 24,
  /** Wrapper chains (one big child) are followed at most this deep to find the page sections. */
  maxWrapperDepth: 8,
  /** Sections thinner than this (px) are ignored unless they are header/nav/footer. */
  minSectionHeightPx: 40,
  /** A non-semantic block is only split into its children when taller than this many viewport heights. */
  expandBlockViewportRatio: 1.5,
  /** Structural hash depth (levels below the root that count). */
  hashDepth: 4,
  minComponentCount: 2,
  maxComponents: 30,
  maxComponentSubtree: 200,
  maxVariants: 4,
  maxMembersKept: 200,
  /** Members whose area differs from the group median by more than this factor are not the same component. */
  areaRatio: 4,
  maxStateDeclarations: 12,
};

/** AI layer (M4): timeouts, retries and how much is sent. */
export const AI_LIMITS: AiLimits = {
  timeoutMs: 90_000,
  maxRetries: 2,
  backoffMs: [1_500, 4_000],
  inputTokenBudget: 150_000,
  maxOutputTokens: 12_000,
  sectionImageWidth: 1024,
  fullPageImageWidth: 512,
  maxSectionImages: 12,
  maxHeroFrames: 3,
  maxImageBytes: 4_000_000,
  jpegQuality: 70,
};

/** Motion scan (M1). MAX_MOTION_TIME is `maxMotionTimeMs`. */
export const MOTION_LIMITS: MotionLimits = {
  maxMotionTimeMs: 25_000,
  maxAnimations: 60,
  maxKeyframesPerAnimation: 12,
  maxScanElements: 6_000,
  maxRevealTargets: 150,
  maxScrollCandidates: 40,
  maxScrollSamples: 40,
  maxCarousels: 6,
  carouselWatchMs: 4_000,
  maxVideos: 20,
  revealWindowMs: 800,
  scrollStepDelayMs: 160,
};

/** Motion frames and page-load capture (M2). */
export const FRAME_LIMITS: FrameLimits = {
  heroFrames: 6,
  heroSpanMs: 3_000,
  maxFrameWidth: 1024,
  jpegQuality: 70,
  maxRevealPresets: 4,
  maxCarousels: 3,
  maxScrollEffects: 4,
  maxFrames: 40,
  maxTotalBytes: 8_000_000,
  loadIntervalMs: 400,
  loadSpanMs: 3_000,
  maxLoadFrames: 10,
  loadTimeoutMs: 15_000,
};

/** Per-section key elements and geometry (design.md fidelity). */
export const KEY_ELEMENTS = {
  /** Key elements kept per section (the generator may list fewer in later sections to fit the size cap). */
  maxPerSection: 10,
  /** Sections at the top of the page whose key elements are never dropped to save space. */
  protectedSections: 3,
  /** Text at or above this size counts as a heading even when it is not an h1-h3 (px). */
  largeTextPx: 28,
  /** A text block shorter than this is not listed as a paragraph (characters). */
  minParagraphChars: 24,
  maxTextChars: 100,
  maxRuns: 8,
  /** Decorative lines: border-only boxes must be at least this long (px). */
  minLinePx: 24,
  /** Thin boxes count as lines when they span this share of the section. */
  lineSpanRatio: 0.6,
  maxLinesPerSection: 12,
};

/** Size caps for the generated pack. */
export const OUTPUT_LIMITS = {
  /** Upper bound for design.md (characters); the generator drops detail until it fits. */
  maxDesignMdChars: 60_000,
  /** capture.json is left out of the zip beyond this size (bytes). */
  maxCaptureJsonBytes: 30_000_000,
};
