import { SCHEMA_VERSION } from '../../shared/types';
import type { CaptureWarning, CssLimits, RawCssCollection, RawStylesheet, RawStylesheetKind } from '../../shared/types';

function readSheet(
  sheet: CSSStyleSheet,
  kind: RawStylesheetKind,
  inShadow: boolean,
  doc: Document,
  limits: CssLimits,
): RawStylesheet {
  const mediaText = sheet.media?.mediaText.trim() ?? '';
  const base = {
    kind,
    href: sheet.href,
    baseUrl: sheet.href ?? doc.baseURI,
    media: mediaText === '' || mediaText === 'all' ? null : mediaText,
    inShadow,
  };
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch (error) {
    // Cross-origin sheets throw a SecurityError; the side panel fetches `href` instead.
    return { ...base, cssText: null, error: error instanceof Error ? error.message : 'cssRules is not readable' };
  }
  const parts: string[] = [];
  let length = 0;
  let truncated = false;
  for (let i = 0; i < rules.length; i++) {
    const text = rules[i]?.cssText ?? '';
    if (length + text.length > limits.maxSheetChars) {
      truncated = true;
      break;
    }
    parts.push(text);
    length += text.length + 1;
  }
  return { ...base, cssText: parts.join('\n'), ...(truncated ? { truncated } : {}) };
}

function sheetKind(sheet: CSSStyleSheet): RawStylesheetKind {
  const owner = sheet.ownerNode as Element | null;
  if (!owner) return 'adopted';
  return owner.localName === 'link' ? 'link' : 'style';
}

/**
 * Read every stylesheet the page has: document.styleSheets, adoptedStyleSheets, and the same for
 * open shadow roots. Same-origin sheets come back as text; unreadable (cross-origin) ones keep
 * only their href. `@import` rules stay in the text for the side panel to follow.
 */
export function collectStylesheets(doc: Document, limits: CssLimits): RawCssCollection {
  const sheets: RawStylesheet[] = [];
  const warnings: CaptureWarning[] = [];
  const seen = new Set<CSSStyleSheet>();
  let skipped = 0;

  const add = (sheet: CSSStyleSheet, kind: RawStylesheetKind, inShadow: boolean) => {
    if (seen.has(sheet)) return;
    seen.add(sheet);
    if (sheet.disabled) return;
    if (sheets.length >= limits.maxSheets) {
      skipped++;
      return;
    }
    const raw = readSheet(sheet, kind, inShadow, doc, limits);
    if (raw.cssText === null && raw.href === null) {
      warnings.push({ code: 'css-unreadable', message: `A ${kind} stylesheet could not be read: ${raw.error ?? 'unknown reason'}.` });
    }
    if (raw.truncated) {
      warnings.push({
        code: 'css-truncated',
        message: `A stylesheet (${raw.href ?? kind}) was cut at ${limits.maxSheetChars.toLocaleString()} characters.`,
      });
    }
    sheets.push(raw);
  };

  const addRoot = (root: Document | ShadowRoot, inShadow: boolean) => {
    for (const sheet of Array.from(root.styleSheets)) add(sheet, sheetKind(sheet), inShadow);
    for (const sheet of root.adoptedStyleSheets ?? []) add(sheet, 'adopted', inShadow);
  };

  addRoot(doc, false);
  const pending: (Document | ShadowRoot)[] = [doc];
  while (pending.length > 0) {
    const root = pending.pop();
    if (!root) break;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadow = el.shadowRoot;
      if (shadow) {
        addRoot(shadow, true);
        pending.push(shadow);
      }
    }
  }

  if (skipped > 0) {
    warnings.push({
      code: 'css-sheet-limit',
      message: `Only the first ${limits.maxSheets} stylesheets were read; ${skipped} more were skipped.`,
    });
  }
  return { schemaVersion: SCHEMA_VERSION, documentUrl: doc.location?.href ?? doc.URL, sheets, warnings };
}
