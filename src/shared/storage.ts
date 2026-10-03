import { DEFAULT_SETTINGS } from './config';
import { DesignLensError } from './errors';
import { AI_MODES, AI_PROVIDERS } from './types';
import type { AiUsageRecord, Settings } from './types';

/**
 * Typed wrapper around chrome.storage.local. Every key has a parser, so reads always
 * return a well-formed value even if storage holds something stale or corrupted.
 * API keys live here and nowhere else (CLAUDE.md rule 7).
 */
export interface StorageSchema {
  settings: Settings;
  aiUsage: AiUsageRecord;
}
export type StorageKey = keyof StorageSchema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

export function parseSettings(raw: unknown): Settings {
  const source = isRecord(raw) ? raw : {};
  const limit = source.dailyAiLimit;
  return {
    aiMode: oneOf(AI_MODES, source.aiMode, DEFAULT_SETTINGS.aiMode),
    aiProvider: oneOf(AI_PROVIDERS, source.aiProvider, DEFAULT_SETTINGS.aiProvider),
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : DEFAULT_SETTINGS.apiKey,
    model: typeof source.model === 'string' ? source.model : DEFAULT_SETTINGS.model,
    dailyAiLimit:
      typeof limit === 'number' && Number.isInteger(limit) && limit >= 0
        ? limit
        : DEFAULT_SETTINGS.dailyAiLimit,
    autoScroll: typeof source.autoScroll === 'boolean' ? source.autoScroll : DEFAULT_SETTINGS.autoScroll,
  };
}

export function parseAiUsage(raw: unknown): AiUsageRecord {
  if (
    isRecord(raw) &&
    typeof raw.date === 'string' &&
    typeof raw.count === 'number' &&
    Number.isInteger(raw.count) &&
    raw.count >= 0
  ) {
    return { date: raw.date, count: raw.count };
  }
  return { date: '', count: 0 };
}

const PARSERS: { [K in StorageKey]: (raw: unknown) => StorageSchema[K] } = {
  settings: parseSettings,
  aiUsage: parseAiUsage,
};

function storageError(action: string, key: StorageKey, cause: unknown): DesignLensError {
  const detail = cause instanceof Error ? ` (${cause.message})` : '';
  return new DesignLensError('STORAGE_FAILED', `Could not ${action} "${key}" in extension storage${detail}.`, {
    cause,
  });
}

export const storage = {
  async get<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
    let items: Record<string, unknown>;
    try {
      items = await chrome.storage.local.get(key);
    } catch (error) {
      throw storageError('read', key, error);
    }
    return PARSERS[key](items[key]);
  },

  async set<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      throw storageError('write', key, error);
    }
  },

  async remove(key: StorageKey): Promise<void> {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      throw storageError('remove', key, error);
    }
  },

  /** Subscribe to changes of one key. Returns an unsubscribe function. */
  subscribe<K extends StorageKey>(key: K, listener: (value: StorageSchema[K]) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      const change = changes[key];
      if (areaName === 'local' && change) listener(PARSERS[key](change.newValue));
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

export function loadSettings(): Promise<Settings> {
  return storage.get('settings');
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const clean = parseSettings(settings);
  await storage.set('settings', clean);
  return clean;
}
