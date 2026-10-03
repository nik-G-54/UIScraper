import { SCHEMA_VERSION } from '../../shared/types';
import type { CaptureWarning, CssLimits, RawCssCollection } from '../../shared/types';
import { findImports } from './parse';
import type { CssSource } from './parse';

/** Downloads a stylesheet. Rejects with a readable message on any failure. */
export type FetchText = (url: string) => Promise<string>;

export interface ResolvedCssSources {
  sources: CssSource[];
  /** Files downloaded successfully (cross-origin sheets and @imports). */
  fetched: number;
  /** Sheets whose text could not be obtained. */
  unreadable: number;
  warnings: CaptureWarning[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check the extractor's reply before trusting it. Returns a reason when it is malformed. */
export function validateRawCss(raw: unknown): { ok: true; css: RawCssCollection } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'the stylesheet data is not an object' };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion ${String(raw.schemaVersion)} (expected ${SCHEMA_VERSION})` };
  }
  if (typeof raw.documentUrl !== 'string' || !Array.isArray(raw.sheets) || !Array.isArray(raw.warnings)) {
    return { ok: false, reason: 'the stylesheet data is malformed' };
  }
  for (const [i, sheet] of raw.sheets.entries()) {
    const s: unknown = sheet;
    if (
      !isObj(s) ||
      typeof s.baseUrl !== 'string' ||
      (s.href !== null && typeof s.href !== 'string') ||
      (s.media !== null && typeof s.media !== 'string') ||
      (s.cssText !== null && typeof s.cssText !== 'string') ||
      typeof s.inShadow !== 'boolean'
    ) {
      return { ok: false, reason: `sheets[${i}] is malformed` };
    }
  }
  return { ok: true, css: raw as unknown as RawCssCollection };
}

interface Pending {
  url: string;
  media: string | null;
  depth: number;
}

/**
 * Turn what the extractor read into parseable sources: readable sheets are used as they are,
 * cross-origin sheets are downloaded, and `@import` chains are followed up to
 * `limits.maxImportDepth`. A download that fails is a warning, never an error.
 */
export async function resolveCssSources(
  raw: RawCssCollection,
  fetchText: FetchText,
  limits: CssLimits,
  concurrency: number,
): Promise<ResolvedCssSources> {
  const sources: CssSource[] = [];
  const warnings: CaptureWarning[] = [...raw.warnings];
  const seen = new Set<string>();
  const queue: Pending[] = [];
  let fetched = 0;
  let unreadable = 0;
  let depthLimited = 0;

  const enqueueImports = (text: string, baseUrl: string, depth: number, parentMedia: string | null) => {
    for (const found of findImports(text, baseUrl)) {
      if (seen.has(found.url)) continue;
      if (depth > limits.maxImportDepth) {
        depthLimited++;
        continue;
      }
      seen.add(found.url);
      queue.push({ url: found.url, media: found.media ?? parentMedia, depth });
    }
  };

  let inlineCount = 0;
  for (const sheet of raw.sheets) {
    if (sheet.href) seen.add(sheet.href);
    if (sheet.cssText !== null) {
      inlineCount += sheet.href ? 0 : 1;
      const label = sheet.href ?? `${sheet.kind === 'adopted' ? 'adopted' : 'inline <style>'} stylesheet #${inlineCount}`;
      sources.push({ text: sheet.cssText, baseUrl: sheet.baseUrl, media: sheet.media, label });
      enqueueImports(sheet.cssText, sheet.baseUrl, 1, sheet.media);
    } else if (sheet.href) {
      queue.push({ url: sheet.href, media: sheet.media, depth: 0 });
    } else {
      unreadable++;
    }
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, Math.max(1, concurrency));
    const results = await Promise.allSettled(
      batch.map((item) =>
        /^https?:\/\//i.test(item.url)
          ? fetchText(item.url)
          : Promise.reject(new Error('only http(s) URLs can be downloaded')),
      ),
    );
    results.forEach((result, index) => {
      const item = batch[index];
      if (!item) return;
      if (result.status === 'rejected') {
        unreadable++;
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        warnings.push({ code: 'css-fetch-failed', message: `Could not download ${item.url}: ${reason}.` });
        return;
      }
      fetched++;
      sources.push({ text: result.value, baseUrl: item.url, media: item.media, label: item.url });
      enqueueImports(result.value, item.url, item.depth + 1, item.media);
    });
  }

  if (depthLimited > 0) {
    warnings.push({
      code: 'css-import-depth',
      message: `${depthLimited} @import(s) nested deeper than ${limits.maxImportDepth} levels were not followed.`,
    });
  }
  return { sources, fetched, unreadable, warnings };
}
