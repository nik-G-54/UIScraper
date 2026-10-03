import type { PageRestriction, RestrictionKind } from './types';

const BROWSER_PROTOCOLS = new Set([
  'chrome:',
  'chrome-untrusted:',
  'chrome-error:',
  'chrome-search:',
  'edge:',
  'about:',
  'view-source:',
  'devtools:',
]);

const WEB_STORE_HOST = 'chromewebstore.google.com';
const LEGACY_WEB_STORE_HOST = 'chrome.google.com';

function restricted(kind: RestrictionKind, reason: string): PageRestriction {
  return { restricted: true, kind, reason };
}

/**
 * Decide whether DesignLens can inject into a tab with this URL.
 *
 * This is URL-only (the side panel has no cheap way to read a page's content type),
 * so a PDF is recognised by its `.pdf` path or by the PDF viewer's extension origin.
 * A PDF served from an extension-less URL will fail at injection time instead, and
 * that failure is surfaced as a readable error.
 */
export function getPageRestriction(url: string | undefined | null): PageRestriction {
  if (!url) {
    return restricted('no-url', 'This tab has no readable URL, so it cannot be analyzed.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return restricted('invalid-url', 'This tab’s URL could not be parsed, so it cannot be analyzed.');
  }

  const { protocol, hostname, pathname } = parsed;

  if (BROWSER_PROTOCOLS.has(protocol)) {
    return restricted(
      'browser-page',
      `Chrome does not allow extensions to run on ${protocol}// pages. Open a regular website to analyze it.`,
    );
  }

  if (protocol === 'chrome-extension:') {
    return restricted(
      'extension-page',
      'Extension pages (including Chrome’s built-in PDF viewer) cannot be analyzed.',
    );
  }

  if (protocol === 'file:') {
    return restricted('local-file', 'Local file:// pages are not supported. Serve the page over http(s) to analyze it.');
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    return restricted('unsupported-protocol', `Pages using ${protocol}// URLs are not supported.`);
  }

  const host = hostname.toLowerCase();
  const isLegacyStore =
    host === LEGACY_WEB_STORE_HOST && (pathname === '/webstore' || pathname.startsWith('/webstore/'));
  if (host === WEB_STORE_HOST || isLegacyStore) {
    return restricted('web-store', 'Chrome blocks extensions from running on the Chrome Web Store.');
  }

  if (pathname.toLowerCase().endsWith('.pdf')) {
    return restricted('pdf-viewer', 'PDFs open in Chrome’s built-in viewer, which extensions cannot analyze.');
  }

  return { restricted: false };
}

/**
 * `designlens-[<kind>-]<hostname>-<YYYYMMDD-HHmmss>.<ext>`, safe for any filesystem.
 * With no `kind` and `ext` "json" this is the raw capture's file name.
 */
export function buildFileName(url: string, ext: string, kind?: string, now: Date = new Date()): string {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // fall through to the generic name
  }
  const safeHost =
    host
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'page';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `designlens-${kind ? `${kind}-` : ''}${safeHost}-${stamp}.${ext}`;
}

/** `designlens-<hostname>-<YYYYMMDD-HHmmss>.json`, safe for any filesystem. */
export function buildCaptureFileName(url: string, now: Date = new Date()): string {
  return buildFileName(url, 'json', undefined, now);
}
