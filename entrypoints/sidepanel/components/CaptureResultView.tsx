import { useState } from 'react';
import { EXTRACTION_BUDGETS } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import { formatBytes, formatDuration } from '@/src/shared/format';
import type { CaptureResult, TruncationReason } from '@/src/shared/types';
import { downloadCaptureJson } from '../lib/download';
import { Card, ErrorBanner, Notice } from './ui';

const TRUNCATION_LABELS: Record<TruncationReason, string> = {
  maxNodes: `node limit (${EXTRACTION_BUDGETS.maxNodes.toLocaleString()} nodes)`,
  maxCaptureTimeMs: `capture time limit (${EXTRACTION_BUDGETS.maxCaptureTimeMs / 1000} s)`,
  maxScrollHeightPx: `scroll height limit (${EXTRACTION_BUDGETS.maxScrollHeightPx.toLocaleString()} px)`,
  maxScrollTimeMs: `scroll time limit (${EXTRACTION_BUDGETS.maxScrollTimeMs / 1000} s)`,
};

const SCROLL_LABELS = {
  disabled: 'off',
  bottom: 'reached the bottom',
  maxScrollHeightPx: 'height limit',
  maxScrollTimeMs: 'time limit',
  stuck: 'window does not scroll',
  aborted: 'aborted',
} as const;

type DownloadState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; filename: string }
  | { status: 'error'; message: string };

export function CaptureResultView({ result }: { result: CaptureResult }) {
  const { stats, meta } = result;
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' });

  const save = async () => {
    setDownload({ status: 'saving' });
    try {
      setDownload({ status: 'saved', filename: await downloadCaptureJson(result) });
    } catch (error) {
      setDownload({ status: 'error', message: toErrorMessage(error) });
    }
  };

  const skipped = Object.entries(stats.nodesSkipped).filter(([, count]) => count > 0);
  const rows: [string, string][] = [
    ['Captured nodes', `${stats.nodesCaptured.toLocaleString()} of ${stats.nodesVisited.toLocaleString()} visited`],
    ['Hidden (no styles)', stats.hiddenNodes.toLocaleString()],
    ['Skipped', skipped.length ? skipped.map(([reason, count]) => `${count.toLocaleString()} ${reason}`).join(', ') : 'none'],
    ['Unique styles', stats.uniqueStyles.toLocaleString()],
    ['Pseudo-elements', stats.pseudoElements.toLocaleString()],
    ['Placeholders', stats.placeholders.toLocaleString()],
    ['Possible overlays', stats.overlays.toLocaleString()],
    ['Shadow roots', `${stats.shadowRoots} open, ${stats.closedShadowHosts} closed`],
    ['Document', `${meta.documentWidth.toLocaleString()} × ${meta.documentHeight.toLocaleString()} px`],
    ['Viewport', `${meta.viewportWidth} × ${meta.viewportHeight} px @${Number(meta.devicePixelRatio.toFixed(2))}x`],
    ['Lazy-load scroll', `${stats.scroll.steps} steps, ${SCROLL_LABELS[stats.scroll.stoppedBy]}`],
    ['Scrolled', stats.scroll.target === 'container' ? `inner container: ${stats.scroll.container ?? 'unknown'}` : 'the window'],
    ['Page stability', stats.stabilize.settled ? 'settled' : 'kept changing (see warnings)'],
    ['Result size', formatBytes(stats.resultBytes)],
  ];
  const durations = (['prepare', 'scroll', 'stabilize', 'capture', 'cleanup'] as const).map(
    (step) => [step, stats.durationsMs[step]] as const,
  );

  return (
    <div className="flex flex-col gap-3">
      {stats.truncated && (
        <Notice tone="warning">
          <p className="font-semibold">Capture was cut short</p>
          <p className="mt-1">
            Hit the {stats.truncatedReasons.map((reason) => TRUNCATION_LABELS[reason]).join(' and the ')}. The snapshot
            may be incomplete.
          </p>
        </Notice>
      )}
      {stats.overlays > 0 && (
        <Notice tone="warning">
          <p className="font-semibold">Possible overlay detected</p>
          <p className="mt-1">
            {stats.overlays} fixed/sticky element(s) cover much of the viewport (e.g. a cookie banner or modal). They
            are flagged in the data, not removed.
          </p>
        </Notice>
      )}

      <Card title="Capture stats">
        <p className="mb-2 text-xs break-all text-slate-500">{meta.title || meta.url}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-3 mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Durations</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {durations.map(([step, ms]) => (
            <div key={step} className="contents">
              <dt className="text-slate-500 capitalize">{step}</dt>
              <dd className="font-medium">{formatDuration(ms)}</dd>
            </div>
          ))}
          <dt className="text-slate-500">Total</dt>
          <dd className="font-semibold">{formatDuration(stats.durationsMs.total)}</dd>
        </dl>
      </Card>

      {result.warnings.length > 0 && (
        <Notice tone="warning">
          <p className="font-semibold">Warnings ({result.warnings.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="break-words">
                {warning.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={download.status === 'saving'}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {download.status === 'saving' ? 'Saving…' : 'Download raw JSON'}
      </button>
      {download.status === 'saved' && <Notice tone="success">Saved {download.filename} to your Downloads folder.</Notice>}
      {download.status === 'error' && <ErrorBanner title="Download failed" message={download.message} />}
    </div>
  );
}
