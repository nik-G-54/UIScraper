/**
 * Single source of truth for data passed between extension contexts
 * (page script <-> side panel <-> background). See CLAUDE.md rule 3.
 */

/** Bump when the shape of any extraction result changes. */
export const SCHEMA_VERSION = 1;

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
}

/** Persisted daily AI request counter. `date` is the local date as YYYY-MM-DD. */
export interface AiUsageRecord {
  date: string;
  count: number;
}

/** What the on-demand page function returns. Must stay JSON-serializable. */
export interface PageProbeData {
  title: string;
  url: string;
  nodeCount: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  documentHeight: number;
  /** ISO 8601 */
  timestamp: string;
}

/** Result of "Analyze page" as used by the side panel. */
export interface PageProbeResult extends PageProbeData {
  schemaVersion: typeof SCHEMA_VERSION;
}

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
