import { useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import type { ActiveTabInfo, PageProbeResult } from '@/src/shared/types';
import { getPageRestriction } from '@/src/shared/url';
import type { ActiveTabState } from '../hooks/useActiveTab';
import { analyzeTab } from '../lib/analyze';
import { Card, ErrorBanner, Notice, Spinner } from './ui';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; tabId: number; url: string }
  | { status: 'success'; tabId: number; url: string; result: PageProbeResult }
  | { status: 'error'; tabId: number; url: string; message: string };

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
  // Only show state that belongs to the page currently in view.
  const current = analysis.status !== 'idle' && analysis.tabId === tab.id && analysis.url === tab.url ? analysis : null;
  const isLoading = current?.status === 'loading';

  const analyze = async (target: ActiveTabInfo) => {
    setAnalysis({ status: 'loading', tabId: target.id, url: target.url });
    try {
      const result = await analyzeTab(target);
      setAnalysis({ status: 'success', tabId: target.id, url: target.url, result });
    } catch (error) {
      setAnalysis({ status: 'error', tabId: target.id, url: target.url, message: toErrorMessage(error) });
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
        disabled={restriction.restricted || isLoading}
        className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isLoading ? 'Analyzing…' : 'Analyze page'}
      </button>

      {current?.status === 'loading' && <Spinner label="Reading the page…" />}
      {current?.status === 'error' && <ErrorBanner title="Analysis failed" message={current.message} />}
      {current?.status === 'success' && <ResultCard result={current.result} />}
    </div>
  );
}

function ResultCard({ result }: { result: PageProbeResult }) {
  const rows: [string, string][] = [
    ['Title', result.title || '(untitled)'],
    ['URL', result.url],
    ['Nodes', result.nodeCount.toLocaleString()],
    ['Viewport', `${result.viewportWidth} × ${result.viewportHeight}px`],
    ['Device pixel ratio', String(result.devicePixelRatio)],
    ['Document height', `${result.documentHeight.toLocaleString()}px`],
    ['Captured', new Date(result.timestamp).toLocaleString()],
    ['Schema version', String(result.schemaVersion)],
  ];

  return (
    <Card title="Page analysis">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-slate-600 select-none">Raw JSON</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </Card>
  );
}
