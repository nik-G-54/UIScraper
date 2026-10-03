import { useState } from 'react';
import type { FormEvent } from 'react';
import { createGeminiProvider } from '@/src/core/ai';
import { AI_LIMITS } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import { AI_MODES, AI_PROVIDERS, CAPTURE_WIDTH_PRESETS } from '@/src/shared/types';
import type { AiMode, AiProviderId, CaptureWidthSetting, Settings } from '@/src/shared/types';
import { parseDailyLimit } from '@/src/shared/usage';
import { useAiUsageToday } from '../hooks/useAiUsage';
import { useSettings } from '../hooks/useSettings';
import { Card, ErrorBanner, Notice, Spinner } from './ui';

const AI_MODE_LABELS: Record<AiMode, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'Use AI when a key is set and the daily limit allows; otherwise rule-based only.' },
  always: { label: 'AI always', hint: 'Always try AI; failures fall back to the rule-based output with a reason.' },
  off: { label: 'Off', hint: 'Never call AI.' },
};

const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: 'Gemini',
};

const parseWidth = (value: string): CaptureWidthSetting =>
  value === 'window' ? 'window' : (CAPTURE_WIDTH_PRESETS.find((preset) => String(preset) === value) ?? 1440);

const WIDTH_LABELS: Record<string, string> = {
  '1440': '1440 px (desktop, default)',
  '1280': '1280 px (small desktop)',
  '768': '768 px (tablet)',
  '390': '390 px (phone)',
  window: 'Current window',
};

interface Draft {
  aiMode: AiMode;
  aiProvider: AiProviderId;
  apiKey: string;
  model: string;
  fallbackModel: string;
  maskPersonalData: boolean;
  dailyAiLimit: string;
  autoScroll: boolean;
  captureWidth: CaptureWidthSetting;
  captureMotion: boolean;
  capturePageLoad: boolean;
}

const toDraft = (s: Settings): Draft => ({ ...s, dailyAiLimit: String(s.dailyAiLimit) });

export function SettingsView() {
  const { state, save } = useSettings();

  if (state.status === 'loading') return <Spinner label="Loading settings…" />;
  if (state.status === 'error') return <ErrorBanner title="Settings unavailable" message={state.message} />;
  return <SettingsForm initial={state.settings} save={save} />;
}

function SettingsForm({ initial, save }: { initial: Settings; save: (next: Settings) => Promise<Settings> }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [saved, setSaved] = useState<Settings>(initial);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [keyTest, setKeyTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'invalid' | 'network' | 'other'; message: string }>({ status: 'idle', message: '' });
  const usage = useAiUsageToday();

  const parsedLimit = parseDailyLimit(draft.dailyAiLimit);
  const limitError = parsedLimit === null ? 'Enter a whole number, 0 or greater.' : null;
  const dirty =
    draft.aiMode !== saved.aiMode ||
    draft.aiProvider !== saved.aiProvider ||
    draft.apiKey !== saved.apiKey ||
    draft.model !== saved.model ||
    draft.fallbackModel !== saved.fallbackModel ||
    draft.maskPersonalData !== saved.maskPersonalData ||
    draft.dailyAiLimit !== String(saved.dailyAiLimit) ||
    draft.autoScroll !== saved.autoScroll ||
    draft.captureWidth !== saved.captureWidth ||
    draft.captureMotion !== saved.captureMotion ||
    draft.capturePageLoad !== saved.capturePageLoad;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setJustSaved(false);
  };

  const testKey = async () => {
    setKeyTest({ status: 'testing', message: '' });
    const result = await createGeminiProvider({ apiKey: draft.apiKey.trim(), timeoutMs: Math.min(AI_LIMITS.timeoutMs, 15_000) }).testKey();
    if (result.ok) setKeyTest({ status: 'ok', message: 'The key works.' });
    else setKeyTest({ status: result.kind === 'invalid-key' ? 'invalid' : result.kind === 'network' ? 'network' : 'other', message: result.message });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (parsedLimit === null) return;
    setSaving(true);
    setError(null);
    try {
      const next = await save({
        aiMode: draft.aiMode,
        aiProvider: draft.aiProvider,
        apiKey: draft.apiKey,
        model: draft.model.trim(),
        fallbackModel: draft.fallbackModel.trim(),
        maskPersonalData: draft.maskPersonalData,
        dailyAiLimit: parsedLimit,
        autoScroll: draft.autoScroll,
        captureWidth: draft.captureWidth,
        captureMotion: draft.captureMotion,
        capturePageLoad: draft.capturePageLoad,
      });
      setSaved(next);
      setDraft(toDraft(next));
      setJustSaved(true);
    } catch (e) {
      setError(`Could not save settings: ${toErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 focus:border-slate-500 focus:outline-none';

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
      <Card title="Capture">
        <label className="mb-3 flex flex-col gap-1">
          <span className="font-medium">Capture width</span>
          <select
            value={String(draft.captureWidth)}
            onChange={(e) => update('captureWidth', parseWidth(e.target.value))}
            className={inputClass}
          >
            {[...CAPTURE_WIDTH_PRESETS.map(String), 'window'].map((value) => (
              <option key={value} value={value}>
                {WIDTH_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            The side panel narrows the page, so sites would show their mobile layout. DesignLens renders the page at
            this width while capturing (using Chrome’s debugger, which shows a “debugging this browser” bar) and always
            restores it. If DevTools already holds the tab it falls back to the window width with a warning.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={draft.autoScroll}
            onChange={(e) => update('autoScroll', e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Auto-scroll for lazy content</span>
            <span className="block text-xs text-slate-500">
              Scrolls the page top to bottom before capturing so lazy-loaded images and infinite scroll render.
              The scroll position is restored afterwards.
            </span>
          </span>
        </label>
        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={draft.captureMotion} onChange={(e) => update('captureMotion', e.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">Capture motion</span>
            <span className="block text-xs text-slate-500">
              Detects animation libraries and samples running animations, scroll reveals, scroll-linked effects, carousels and
              videos before the capture (adds up to about 25 seconds). Also records hero and effect frames.
            </span>
          </span>
        </label>
        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={draft.capturePageLoad} onChange={(e) => update('capturePageLoad', e.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">Capture page load (loaders/intro)</span>
            <span className="block text-xs text-slate-500">
              Reloads the page with the debugger attached and films the first seconds, then detects a loader. Off by
              default: the reload discards any unsaved state on the page.
            </span>
          </span>
        </label>
      </Card>

      <Card title="AI mode">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">AI mode</legend>
          {AI_MODES.map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="aiMode"
                value={mode}
                checked={draft.aiMode === mode}
                onChange={() => update('aiMode', mode)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{AI_MODE_LABELS[mode].label}</span>
                <span className="block text-xs text-slate-500">{AI_MODE_LABELS[mode].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card title="AI provider">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Provider</span>
            <select
              value={draft.aiProvider}
              onChange={(e) => update('aiProvider', e.target.value as AiProviderId)}
              className={inputClass}
            >
              {AI_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {AI_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium">API key</span>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your key"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-pressed={showKey}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-2 hover:bg-slate-100"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="text-xs text-slate-500">Stored only in this browser’s extension storage.</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void testKey()}
                disabled={draft.apiKey.trim() === '' || keyTest.status === 'testing'}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {keyTest.status === 'testing' ? 'Testing…' : 'Test key'}
              </button>
              {keyTest.status === 'ok' && <span className="text-xs text-green-700">OK: {keyTest.message}</span>}
              {keyTest.status === 'invalid' && <span className="text-xs text-red-700">Invalid key.</span>}
              {keyTest.status === 'network' && <span className="text-xs text-red-700">Network error: {keyTest.message}</span>}
              {keyTest.status === 'other' && <span className="text-xs text-red-700">{keyTest.message}</span>}
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium">Main model</span>
            <input
              type="text"
              value={draft.model}
              onChange={(e) => update('model', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="gemini-3.8-flash"
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium">Fallback model</span>
            <input
              type="text"
              value={draft.fallbackModel}
              onChange={(e) => update('fallbackModel', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="gemini-3.5-flash-lite"
              className={inputClass}
            />
            <span className="text-xs text-slate-500">Tried once when the main model is rate-limited, down, or returns an unusable answer.</span>
          </label>

          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={draft.maskPersonalData} onChange={(e) => update('maskPersonalData', e.target.checked)} className="mt-1" />
            <span>
              <span className="font-medium">Mask emails and phone numbers before sending</span>
              <span className="block text-xs text-slate-500">Replaces them in the text sent to the AI. Screenshots are sent as they are.</span>
            </span>
          </label>
        </div>
      </Card>

      <Card title="Usage">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Daily AI request limit</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.dailyAiLimit}
              onChange={(e) => update('dailyAiLimit', e.target.value)}
              aria-invalid={limitError !== null}
              className={inputClass}
            />
            {limitError && <span className="text-xs text-red-700">{limitError}</span>}
          </label>

          <div>
            <span className="font-medium">AI requests used today</span>
            <p className="text-lg font-semibold" data-testid="ai-usage-today">
              {usage.status === 'ready' ? usage.used : usage.status === 'loading' ? '…' : '—'}
            </p>
            {usage.status === 'error' && <p className="text-xs text-red-700">{usage.message}</p>}
            <p className="text-xs text-slate-500">Resets automatically at local midnight.</p>
          </div>
        </div>
      </Card>

      {error && <ErrorBanner title="Save failed" message={error} />}
      {justSaved && <Notice tone="success">Settings saved.</Notice>}

      <button
        type="submit"
        disabled={saving || !dirty || limitError !== null}
        className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}
