import { useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import { loadSettings } from '@/src/shared/storage';
import { generateTokens } from '@/src/core/tokens';
import type { ActiveTabInfo, AnalysisStep, CaptureResult, CssData, DesignTokens } from '@/src/shared/types';
import { getPageRestriction } from '@/src/shared/url';
import type { ActiveTabState } from '../hooks/useActiveTab';
import { captureTab } from '../lib/capture';
import { collectCssData } from '../lib/css';
import { CaptureResultView } from './CaptureResultView';
import { ProgressSteps } from './ProgressSteps';
import { TokensView } from './TokensView';
import { Card, ErrorBanner, Notice, Spinner } from './ui';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; tabId: number; step: AnalysisStep; autoScroll: boolean }
  | {
      status: 'success';
      tabId: number;
      url: string;
      result: CaptureResult;
      css: CssData;
      tokens: DesignTokens | null;
      tokensError: string | null;
    }
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
    let autoScroll: boolean;
    try {
      autoScroll = (await loadSettings()).autoScroll;
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
    setAnalysis({ status: 'loading', tabId: target.id, step: 'preparing', autoScroll });
    try {
      // The capture's own "done" is not the end any more: CSS and tokens follow.
      const result = await captureTab(target, { autoScroll }, (step) => {
        if (step !== 'done') setStep(step);
      });
      const css = await collectCssData(target, setStep);
      setStep('generating-tokens');
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the step render before the synchronous work
      let tokens: DesignTokens | null = null;
      let tokensError: string | null = null;
      try {
        tokens = generateTokens(result, css);
      } catch (error) {
        tokensError = toErrorMessage(error);
      }
      setAnalysis({ status: 'success', tabId: target.id, url: target.url, result, css, tokens, tokensError });
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
        {busy ? 'Analyzing…' : 'Analyze page'}
      </button>
      {busy && !shown && (
        <Notice tone="warning">A capture is still running on another tab. It will finish on its own.</Notice>
      )}

      {shown?.status === 'loading' && (
        <Card title="Progress">
          <ProgressSteps step={shown.step} autoScroll={shown.autoScroll} />
        </Card>
      )}
      {shown?.status === 'error' && <ErrorBanner title="Analysis failed" message={shown.message} />}
      {shown?.status === 'success' && (
        <>
          {shown.tokensError && <ErrorBanner title="Token generation failed" message={shown.tokensError} />}
          {shown.tokens && <TokensView key={shown.tokens.source.capturedAt} tokens={shown.tokens} css={shown.css} />}
          <CaptureResultView key={shown.result.meta.timestamp} result={shown.result} />
        </>
      )}
    </div>
  );
}
