import type { CaptureTuning, ExtractionBudgets, Settings } from './types';

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
