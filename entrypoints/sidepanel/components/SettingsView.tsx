import { useState } from 'react';
import type { FormEvent } from 'react';
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
  dailyAiLimit: string;
  autoScroll: boolean;
  captureWidth: CaptureWidthSetting;
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
  const usage = useAiUsageToday();

  const parsedLimit = parseDailyLimit(draft.dailyAiLimit);
  const limitError = parsedLimit === null ? 'Enter a whole number, 0 or greater.' : null;
  const dirty =
    draft.aiMode !== saved.aiMode ||
    draft.aiProvider !== saved.aiProvider ||
    draft.apiKey !== saved.apiKey ||
    draft.model !== saved.model ||
    draft.dailyAiLimit !== String(saved.dailyAiLimit) ||
    draft.autoScroll !== saved.autoScroll ||
    draft.captureWidth !== saved.captureWidth;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setJustSaved(false);
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
        dailyAiLimit: parsedLimit,
        autoScroll: draft.autoScroll,
        captureWidth: draft.captureWidth,
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
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium">Model name</span>
            <input
              type="text"
              value={draft.model}
              onChange={(e) => update('model', e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Model ID from your provider"
              className={inputClass}
            />
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
