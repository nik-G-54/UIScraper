import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './config';
import { DesignLensError } from './errors';
import { loadSettings, parseSettings, saveSettings, storage } from './storage';
import { installChromeStorageMock } from './test-utils/mockChromeStorage';
import type { ChromeStorageMock } from './test-utils/mockChromeStorage';

let mock: ChromeStorageMock;

beforeEach(() => {
  vi.unstubAllGlobals();
  mock = installChromeStorageMock();
});

describe('storage wrapper', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await storage.get('aiUsage')).toEqual({ date: '', count: 0 });
  });

  it('round-trips settings through chrome.storage.local', async () => {
    const settings = {
      aiMode: 'always',
      aiProvider: 'gemini',
      apiKey: 'secret',
      model: 'my-model',
      dailyAiLimit: 5,
    } as const;
    await saveSettings(settings);
    expect(mock.data.settings).toEqual(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it('writes through chrome.storage.local', async () => {
    await storage.set('aiUsage', { date: '2026-01-01', count: 3 });
    expect(mock.local.set).toHaveBeenCalledWith({ aiUsage: { date: '2026-01-01', count: 3 } });
  });

  it('removes keys', async () => {
    await storage.set('aiUsage', { date: '2026-01-01', count: 3 });
    await storage.remove('aiUsage');
    expect(mock.data.aiUsage).toBeUndefined();
  });

  it('falls back per-field when stored settings are partial or corrupted', async () => {
    mock.data.settings = { aiMode: 'bogus', apiKey: 42, model: 'm', dailyAiLimit: -1, aiProvider: 'nope' };
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, model: 'm' });
  });

  it('treats non-object settings as empty', () => {
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects non-integer daily limits', () => {
    expect(parseSettings({ dailyAiLimit: 2.5 }).dailyAiLimit).toBe(DEFAULT_SETTINGS.dailyAiLimit);
    expect(parseSettings({ dailyAiLimit: 0 }).dailyAiLimit).toBe(0);
  });

  it('notifies subscribers of changes to their key only, until unsubscribed', async () => {
    const listener = vi.fn();
    const unsubscribe = storage.subscribe('aiUsage', listener);

    await storage.set('settings', DEFAULT_SETTINGS);
    expect(listener).not.toHaveBeenCalled();

    await storage.set('aiUsage', { date: '2026-01-01', count: 1 });
    expect(listener).toHaveBeenCalledWith({ date: '2026-01-01', count: 1 });

    unsubscribe();
    await storage.set('aiUsage', { date: '2026-01-01', count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mock.listeners.size).toBe(0);
  });

  it('wraps storage failures in a readable DesignLensError', async () => {
    mock.local.get.mockRejectedValueOnce(new Error('quota'));
    const failure = loadSettings();
    await expect(failure).rejects.toBeInstanceOf(DesignLensError);
    await expect(failure).rejects.toMatchObject({ code: 'STORAGE_FAILED' });

    mock.local.set.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSettings(DEFAULT_SETTINGS)).rejects.toThrow(/disk full/);
  });
});
