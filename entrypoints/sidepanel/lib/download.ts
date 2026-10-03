import { DesignLensError, toErrorMessage } from '@/src/shared/errors';
import type { CaptureResult } from '@/src/shared/types';
import { buildCaptureFileName } from '@/src/shared/url';

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
 * Save the raw capture as compact JSON. The Blob and object URL live in this side panel page;
 * chrome.downloads fetches them. Resolves with the file name.
 */
export async function downloadCaptureJson(result: CaptureResult): Promise<string> {
  const filename = buildCaptureFileName(result.meta.url);
  const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }));
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
