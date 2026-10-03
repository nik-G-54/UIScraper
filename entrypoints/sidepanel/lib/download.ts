import { DesignLensError, toErrorMessage } from '@/src/shared/errors';
import type { CaptureResult, DesignTokens } from '@/src/shared/types';
import { buildCaptureFileName, buildFileName } from '@/src/shared/url';

const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Resolves when Chrome reports the download complete; rejects if it is interrupted or stalls. */
function waitForDownload(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted') {
        const reason = delta.error?.current ?? 'UNKNOWN';
        finish(new Error(reason === 'USER_CANCELED' ? 'the download was cancelled' : `Chrome interrupted it (${reason})`));
      }
    };
    const timer = setTimeout(() => finish(new Error('Chrome did not finish the download in time')), DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    // The download may already be finished by the time we listen.
    chrome.downloads.search({ id }).then(
      ([item]) => {
        if (item?.state === 'complete') finish();
        else if (item?.state === 'interrupted') finish(new Error(`Chrome interrupted it (${item.error ?? 'UNKNOWN'})`));
      },
      () => undefined,
    );
  });
}

/**
 * Save a Blob as a file. The object URL lives in this side panel page; chrome.downloads fetches
 * it. Resolves with the file name.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    await waitForDownload(id);
    return filename;
  } catch (error) {
    throw new DesignLensError('DOWNLOAD_FAILED', `Could not save ${filename}: ${toErrorMessage(error)}`, { cause: error });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save text as a file. Resolves with the file name. */
function downloadText(content: string, filename: string, mime: string): Promise<string> {
  return downloadBlob(new Blob([content], { type: mime }), filename);
}

/** Save the raw capture as compact JSON. */
export function downloadCaptureJson(result: CaptureResult): Promise<string> {
  return downloadText(JSON.stringify(result), buildCaptureFileName(result.meta.url), 'application/json');
}

/** Save tokens.json (pretty-printed: it is meant to be read). */
export function downloadTokensJson(tokens: DesignTokens): Promise<string> {
  const json = `${JSON.stringify(tokens, null, 2)}\n`;
  return downloadText(json, buildFileName(tokens.source.url, 'json', 'tokens'), 'application/json');
}

/** Save theme.css (the Tailwind v4 @theme block). */
export function downloadThemeCss(css: string, sourceUrl: string): Promise<string> {
  return downloadText(css, buildFileName(sourceUrl, 'css', 'theme'), 'text/css');
}
