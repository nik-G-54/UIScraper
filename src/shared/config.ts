import type { Settings } from './types';

/**
 * Extraction budgets. Every extraction phase must read its limits from here
 * (CLAUDE.md rule 6) so they can be tuned in one place.
 */
export const EXTRACTION_BUDGETS = {
  /** Stop walking the DOM after this many elements. */
  maxNodes: 50_000,
  /** Abort extraction after this many milliseconds. */
  maxTimeMs: 20_000,
  /** Do not scroll (or measure) beyond this document height, in CSS pixels. */
  maxScrollHeightPx: 30_000,
} as const;

/** How long the side panel waits for the lightweight page probe before giving up. */
export const PROBE_TIMEOUT_MS = 10_000;

export const DEFAULT_DAILY_AI_LIMIT = 20;

export const DEFAULT_SETTINGS: Settings = {
  aiMode: 'auto',
  aiProvider: 'gemini',
  apiKey: '',
  model: '',
  dailyAiLimit: DEFAULT_DAILY_AI_LIMIT,
};
