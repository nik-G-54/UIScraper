import { assetPath, imageExtension, sanitizeSvg, slugFromUrl } from '@/src/core/assets';
import { ASSET_DOWNLOAD } from '@/src/shared/config';
import { toErrorMessage } from '@/src/shared/errors';
import { formatBytes } from '@/src/shared/format';
import type { AssetIndex, CaptureWarning, IconAsset, ImageAsset } from '@/src/shared/types';
import type { PackFile } from './zip';

interface Fetched {
  bytes: Uint8Array;
  mime: string | null;
}

const tooLarge = () => new Error(`larger than the ${formatBytes(ASSET_DOWNLOAD.maxImageBytes)} per-file limit`);

function decodeDataUrl(url: string): Fetched {
  const comma = url.indexOf(',');
  if (comma === -1) throw new Error('malformed data: URL');
  const head = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const mime = head.split(';')[0] || null;
  let bytes: Uint8Array;
  if (/;base64/i.test(head)) {
    const binary = atob(body);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(body));
  }
  if (bytes.byteLength > ASSET_DOWNLOAD.maxImageBytes) throw tooLarge();
  return { bytes, mime };
}

/** Download one file with a timeout and a size cap. Rejects with a readable reason. */
async function fetchBytes(url: string): Promise<Fetched> {
  if (url.startsWith('data:')) return decodeDataUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_DOWNLOAD.fetchTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > ASSET_DOWNLOAD.maxImageBytes) throw tooLarge();
    const mime = response.headers.get('content-type');
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > ASSET_DOWNLOAD.maxImageBytes) throw tooLarge();
      return { bytes, mime };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > ASSET_DOWNLOAD.maxImageBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, mime };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${ASSET_DOWNLOAD.fetchTimeoutMs / 1000} seconds`, { cause: error });
    }
    throw new Error(toErrorMessage(error), { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** Run `task` over `items` with at most `concurrency` in flight. */
async function pool<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

const label = (url: string) => (url.startsWith('data:') ? 'an inline image' : url.length > 70 ? `${url.slice(0, 69)}…` : url);

/**
 * Download the page's images and favicons (with count, per-file and total size caps) and write the
 * SVG icons. Returns an updated index with zip paths and the files to pack. Never throws: every
 * failure is a warning and that asset simply has no path.
 */
export async function downloadAssets(
  index: AssetIndex,
): Promise<{ index: AssetIndex; files: PackFile[]; warnings: CaptureWarning[] }> {
  const files: PackFile[] = [];
  const warnings: CaptureWarning[] = [];

  // Largest first (the index is already sorted), the logo before everything.
  const logoId = index.logo?.kind === 'img' ? index.logo.assetId : null;
  const images: ImageAsset[] = index.images.map((image) => ({ ...image }));
  const order = images
    .map((image, i) => ({ image, i }))
    .sort((a, b) => Number(b.image.id === logoId) - Number(a.image.id === logoId) || a.i - b.i);

  const queue: { image: ImageAsset; i: number }[] = [];
  let oversubscribed = 0;
  for (const entry of order) {
    const { image } = entry;
    if (image.displayWidth < ASSET_DOWNLOAD.minDisplayPx && image.displayHeight < ASSET_DOWNLOAD.minDisplayPx) {
      image.skipped = 'tracking pixel';
    } else if (queue.length >= ASSET_DOWNLOAD.maxImages) {
      image.skipped = `over the ${ASSET_DOWNLOAD.maxImages}-image limit`;
      oversubscribed++;
    } else queue.push(entry);
  }

  let totalBytes = 0;
  const failures: string[] = [];
  let overTotal = 0;
  await pool(queue, ASSET_DOWNLOAD.concurrency, async ({ image, i }) => {
    try {
      const fetched = await fetchBytes(image.url);
      let { bytes } = fetched;
      const ext = imageExtension(fetched.mime, image.url);
      if (ext === 'svg') {
        const clean = sanitizeSvg(new TextDecoder().decode(bytes), ASSET_DOWNLOAD.maxImageBytes);
        if (clean === null) {
          image.skipped = 'not a valid SVG';
          return;
        }
        bytes = new TextEncoder().encode(clean);
      }
      if (totalBytes + bytes.byteLength > ASSET_DOWNLOAD.maxTotalBytes) {
        image.skipped = `total size limit of ${formatBytes(ASSET_DOWNLOAD.maxTotalBytes)} reached`;
        overTotal++;
        return;
      }
      totalBytes += bytes.byteLength;
      image.path = assetPath('images', i + 1, slugFromUrl(image.url, 'image'), ext);
      image.bytes = bytes.byteLength;
      files.push({ path: image.path, data: bytes });
    } catch (error) {
      image.skipped = toErrorMessage(error);
      failures.push(`Could not download ${label(image.url)}: ${toErrorMessage(error)}.`);
    }
  });
  if (oversubscribed > 0) {
    warnings.push({ code: 'image-limit', message: `${oversubscribed} image(s) were not downloaded (limit ${ASSET_DOWNLOAD.maxImages}); they are still listed in design.md.` });
  }
  if (overTotal > 0) {
    warnings.push({ code: 'image-total-limit', message: `${overTotal} image(s) were skipped because the ${formatBytes(ASSET_DOWNLOAD.maxTotalBytes)} total limit was reached.` });
  }
  for (const message of failures.slice(0, 3)) warnings.push({ code: 'image-download-failed', message });
  if (failures.length > 3) warnings.push({ code: 'image-download-failed', message: `${failures.length - 3} more image download(s) failed.` });

  const icons: IconAsset[] = index.icons.map((icon, i) => {
    const slug = (icon.label ?? 'icon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'icon';
    const path = assetPath('icons', i + 1, slug, 'svg');
    files.push({ path, data: icon.markup });
    return { ...icon, path };
  });

  const favicons = index.favicons.map((favicon) => ({ ...favicon }));
  await pool(favicons.map((favicon, i) => ({ favicon, i })), ASSET_DOWNLOAD.concurrency, async ({ favicon, i }) => {
    try {
      const fetched = await fetchBytes(favicon.url);
      const ext = imageExtension(fetched.mime, favicon.url);
      const path = `assets/icons/favicon-${i + 1}.${ext}`;
      favicon.path = path;
      files.push({ path, data: fetched.bytes });
    } catch (error) {
      warnings.push({ code: 'favicon-download-failed', message: `Could not download the favicon ${label(favicon.url)}: ${toErrorMessage(error)}.` });
    }
  });

  return { index: { ...index, images, icons, favicons }, files, warnings };
}
