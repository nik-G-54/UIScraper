import { useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import { formatBytes } from '@/src/shared/format';
import type { PackResult } from '../lib/pack';
import { downloadBlob } from '../lib/download';
import { Card, ErrorBanner, Notice } from './ui';

const PREVIEW_CHARS = 6_000;

/** What a finished "Generate design pack" run produced: the zip, the warnings and a design.md preview. */
export function PackResultView({ pack }: { pack: PackResult }) {
  const [expanded, setExpanded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(pack.saveError);
  const [saved, setSaved] = useState(pack.zip !== null && pack.saveError === null);
  const preview = expanded ? pack.designMd : pack.designMd.slice(0, PREVIEW_CHARS);

  const save = async () => {
    if (!pack.zip) return;
    try {
      await downloadBlob(pack.zip.blob, pack.zip.name);
      setSaveError(null);
      setSaved(true);
    } catch (error) {
      setSaveError(toErrorMessage(error));
    }
  };

  return (
    <>
      {pack.zip ? (
        <Card title="Design pack">
          <p className="font-medium break-all">{pack.zip.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {pack.zip.fileCount} files, {formatBytes(pack.zip.blob.size)}
          </p>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-slate-600">
            <li>
              {pack.layout.sections.length} sections, {pack.layout.components.length} components
            </li>
            <li>
              {pack.assets.images.filter((i) => i.path).length}/{pack.assets.images.length} images,{' '}
              {pack.assets.icons.length} icons, {pack.screens.sections.length} section screenshots
            </li>
            <li>
              Captured at {pack.capture.meta.captureWidth}px{pack.capture.meta.emulated ? ' (width forced)' : ''}
            </li>
          </ul>
          {saved && !saveError && <p className="mt-2 text-xs text-green-700">Saved to your Downloads folder.</p>}
          <button
            type="button"
            onClick={() => void save()}
            className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-100"
          >
            {saved ? 'Save the zip again' : 'Save the zip'}
          </button>
        </Card>
      ) : (
        <ErrorBanner title="No zip was produced" message="Building the zip failed; see the warnings below. design.md is still shown." />
      )}
      {saveError && <ErrorBanner title="The zip could not be saved" message={saveError} />}
      {pack.tokensFailed && <Notice tone="warning">Token generation failed, so design.md has no token tables.</Notice>}

      {pack.warnings.length > 0 && (
        <Card title={`Warnings (${pack.warnings.length})`}>
          <ul className="flex flex-col gap-1.5 text-xs text-amber-900">
            {pack.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="break-words">
                {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="design.md preview">
        <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-2 text-xs break-words whitespace-pre-wrap">{preview}</pre>
        {pack.designMd.length > PREVIEW_CHARS && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-xs font-medium text-slate-700 underline">
            {expanded ? 'Show less' : `Show all (${formatBytes(pack.designMd.length)})`}
          </button>
        )}
      </Card>
    </>
  );
}
