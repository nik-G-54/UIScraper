import { useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import { loadSettings } from '@/src/shared/storage';
import type { ActiveTabInfo, AnalysisStep, CaptureWidthSetting } from '@/src/shared/types';
import { getPageRestriction } from '@/src/shared/url';
import type { ActiveTabState } from '../hooks/useActiveTab';
import { generatePack } from '../lib/pack';
import type { PackResult } from '../lib/pack';
import { CaptureResultView } from './CaptureResultView';
import { PackResultView } from './PackResultView';
import { ProgressSteps } from './ProgressSteps';
import { TokensView } from './TokensView';
import { Card, ErrorBanner, Notice, Spinner } from './ui';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; tabId: number; step: AnalysisStep; autoScroll: boolean; captureWidth: CaptureWidthSetting; captureMotion: boolean; capturePageLoad: boolean; aiModel: string | null }
  | { status: 'success'; tabId: number; url: string; pack: PackResult }
  | { status: 'error'; tabId: number; url: string; message: string };

/** The URL the tab has right now (after a mid-capture navigation it differs from the start URL). */
async function currentUrl(tab: ActiveTabInfo): Promise<string> {
  try {
    return (await chrome.tabs.get(tab.id)).url ?? tab.url;
  } catch {
    return tab.url;
  }
}

export function AnalyzeView({ activeTab }: { activeTab: ActiveTabState }) {
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' });

  if (activeTab.status === 'loading') {
    return <Spinner label="Reading the active tab…" />;
  }
  if (activeTab.status === 'error') {
    return <ErrorBanner title="Can't read the active tab" message={activeTab.message} />;
  }
  if (!activeTab.tab) {
    return <Notice tone="warning">No active tab was found in this window.</Notice>;
  }

  const tab = activeTab.tab;
  const restriction = getPageRestriction(tab.url);
  const busy = analysis.status === 'loading';
  // Progress follows the tab being captured; finished results/errors only show for the page
  // they belong to, so a stale result never lingers after navigating away.
  const shown =
    analysis.status === 'loading'
      ? analysis.tabId === tab.id
        ? analysis
        : null
      : analysis.status !== 'idle' && analysis.tabId === tab.id && analysis.url === tab.url
        ? analysis
        : null;

  const analyze = async (target: ActiveTabInfo) => {
    let settings: Awaited<ReturnType<typeof loadSettings>>;
    try {
      settings = await loadSettings();
    } catch (error) {
      setAnalysis({
        status: 'error',
        tabId: target.id,
        url: target.url,
        message: `Could not load settings: ${toErrorMessage(error)}`,
      });
      return;
    }
    const setStep = (step: AnalysisStep) =>
      setAnalysis((previous) => (previous.status === 'loading' ? { ...previous, step } : previous));
    setAnalysis({
      status: 'loading',
      tabId: target.id,
      step: settings.captureWidth === 'window' ? 'preparing' : 'emulating-width',
      autoScroll: settings.autoScroll,
      captureWidth: settings.captureWidth,
      captureMotion: settings.captureMotion,
      capturePageLoad: settings.capturePageLoad,
      aiModel: settings.aiMode !== 'off' && settings.apiKey.trim() !== '' ? settings.model : null,
    });
    try {
      const pack = await generatePack(target, settings, setStep);
      setAnalysis({ status: 'success', tabId: target.id, url: target.url, pack });
    } catch (error) {
      setAnalysis({
        status: 'error',
        tabId: target.id,
        url: await currentUrl(target),
        message: toErrorMessage(error),
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="Active tab">
        <p className="font-medium break-words">{tab.title || '(untitled)'}</p>
        <p className="mt-1 text-xs break-all text-slate-500">{tab.url || '(no URL)'}</p>
      </Card>

      {restriction.restricted && (
        <Notice tone="warning">
          <p className="font-semibold">This page can’t be analyzed</p>
          <p className="mt-1">{restriction.reason}</p>
        </Notice>
      )}

      <button
        type="button"
        onClick={() => void analyze(tab)}
        disabled={restriction.restricted || busy}
        className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy ? 'Generating…' : 'Generate design pack'}
      </button>
      {busy && !shown && (
        <Notice tone="warning">A capture is still running on another tab. It will finish on its own.</Notice>
      )}

      {shown?.status === 'loading' && (
        <Card title="Progress">
          <ProgressSteps step={shown.step} autoScroll={shown.autoScroll} emulate={shown.captureWidth !== 'window'} motion={shown.captureMotion} pageLoad={shown.capturePageLoad} aiModel={shown.aiModel} />
        </Card>
      )}
      {shown?.status === 'error' && <ErrorBanner title="Design pack failed" message={shown.message} />}
      {shown?.status === 'success' && (
        <>
          <PackResultView key={shown.pack.capture.meta.timestamp} pack={shown.pack} />
          {!shown.pack.tokensFailed && (
            <TokensView key={`tokens-${shown.pack.tokens.source.capturedAt}`} tokens={shown.pack.tokens} css={shown.pack.css} />
          )}
          <CaptureResultView key={shown.pack.capture.meta.timestamp} result={shown.pack.capture} />
        </>
      )}
    </div>
  );
}
