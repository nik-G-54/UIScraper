import type { CaptureTuning, CssLimits, ExtractionBudgets, Settings } from './types';

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

export const DEFAULT_DAILY_AI_LIMIT = 20;

export const DEFAULT_SETTINGS: Settings = {
  aiMode: 'auto',
  aiProvider: 'gemini',
  apiKey: '',
  model: '',
  dailyAiLimit: DEFAULT_DAILY_AI_LIMIT,
  autoScroll: true,
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
  maxBreakpoints: 6,
  maxCssVariablesInTokens: 300,
  /** Share of spacing values that must be multiples of a unit for it to be the base unit. */
  baseUnitCoverage: 0.75,
  /** Spacing at or below this is noise for base-unit detection (px). */
  baseUnitMinPx: 2,
};
