import { TOKEN_TUNING } from '../../shared/config';
import type {
  CaptureResult,
  FontCategory,
  FontFamilyToken,
  ScaleValue,
  TagTypography,
  TypographyTokens,
  ValueCount,
} from '../../shared/types';
import { DEFAULT_LINK_COLOR, DEFAULT_TEXT_COLOR, normalizeColor } from './color';
import { Tally, parsePx, round2, splitTopLevel } from './util';

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);
const SANS_HINT = new Set(['sans-serif', 'system-ui', 'ui-sans-serif', '-apple-system', 'blinkmacsystemfont', 'ui-rounded']);
const ICON_FONT = /\b(?:font ?awesome|icons?|glyphicons?|fontello|material symbols|ionicons|feather|remixicon)\b/i;
const MONO_NAME = /\b(?:mono|consolas|courier|menlo|monaco|code)\b/i;
const IDENT = /^-?[a-z_][\w-]*$/i;

const MONO_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'tt']);
const BOLD_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'th']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TAG_STYLES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'small'] as const;

/**
 * Chrome's built-in font size per tag. The style table omits properties that equal the browser
 * default for the tag, so an absent `font-size` means this value (approximate; see CLAUDE.md).
 */
const UA_FONT_SIZE: Record<string, number> = {
  h1: 32,
  h2: 24,
  h3: 18.72,
  h5: 13.28,
  h6: 10.72,
  small: 13.33,
  sub: 13.33,
  sup: 13.33,
  big: 19.2,
  code: 13,
  pre: 13,
  kbd: 13,
  samp: 13,
  tt: 13,
};

export const defaultFontSizePx = (tag: string): number => UA_FONT_SIZE[tag] ?? 16;

/** Unquoted family names of a `font-family` value, in order, without duplicates. */
export function fontFamilyNames(value: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of splitTopLevel(value, ',')) {
    const name = part.replace(/^(["'])(.*)\1$/, '$2').trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** A CSS-ready stack: names with spaces/digits are quoted, generics are not. */
export function formatFontStack(names: readonly string[]): string {
  return names.map((n) => (GENERIC.has(n.toLowerCase()) || IDENT.test(n) ? n : `"${n}"`)).join(', ');
}

function fontCategory(names: readonly string[]): FontCategory {
  const lower = names.map((n) => n.toLowerCase());
  if (lower.includes('monospace') || lower.includes('ui-monospace') || names.some((n) => MONO_NAME.test(n))) return 'mono';
  if (lower.includes('cursive') || lower.includes('fantasy')) return 'display';
  if (lower.some((n) => SANS_HINT.has(n))) return 'sans';
  if (lower.includes('serif') || lower.includes('ui-serif')) return 'serif';
  return 'sans';
}

const primaryName = (names: readonly string[]) =>
  names.find((n) => !GENERIC.has(n.toLowerCase())) ?? names[0] ?? 'sans-serif';

function fontWeight(raw: string | undefined, tag: string): string {
  if (raw === undefined) return BOLD_TAGS.has(tag) ? '700' : '400';
  if (raw === 'normal') return '400';
  if (raw === 'bold') return '700';
  return raw;
}

function lineHeight(raw: string | undefined, sizePx: number): string {
  if (raw === undefined || raw === 'normal') return 'normal';
  const px = parsePx(raw);
  if (px === null || sizePx <= 0) return raw;
  return String(round2(px / sizePx));
}

function toValueCounts(tally: Tally<string>, limit: number): ValueCount[] {
  return tally.top(limit).map(([value, count]) => ({ value, count }));
}

interface TextStyle {
  tag: string;
  stack: string;
  names: string[];
  sizePx: number;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  transform: string | null;
  color: string | null;
}

/** Typography tokens from text-bearing nodes (plus every node of the per-tag styles). */
export function buildTypography(capture: CaptureResult): TypographyTokens {
  const familyTally = new Map<string, { names: string[]; stack: string; count: number; heading: number }>();
  const sizes = new Tally<number>();
  const weights = new Tally<string>();
  const lineHeights = new Tally<string>();
  const letterSpacings = new Tally<string>();
  const byTag = new Map<string, { styles: Tally<string>; samples: Map<string, TextStyle>; count: number; textCount: number }>();

  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const style = capture.styleTable[node.styleId];
    if (!style) continue;
    const wantsTag = (TAG_STYLES as readonly string[]).includes(node.tag);
    if (!node.text && !wantsTag) continue;

    const rawFamily = style['font-family'];
    const names = fontFamilyNames(rawFamily ?? (MONO_TAGS.has(node.tag) ? 'monospace' : 'Times New Roman'));
    const stack = formatFontStack(names);
    const sizePx = round2(parsePx(style['font-size']) ?? defaultFontSizePx(node.tag));
    const text: TextStyle = {
      tag: node.tag,
      stack,
      names,
      sizePx,
      weight: fontWeight(style['font-weight'], node.tag),
      lineHeight: lineHeight(style['line-height'], sizePx),
      letterSpacing: style['letter-spacing'] ?? 'normal',
      transform: style['text-transform'] && style['text-transform'] !== 'none' ? style['text-transform'] : null,
      color: normalizeColor(style.color ?? (node.tag === 'a' ? DEFAULT_LINK_COLOR : DEFAULT_TEXT_COLOR)),
    };

    if (node.text) {
      const key = stack.toLowerCase();
      const entry = familyTally.get(key) ?? { names, stack, count: 0, heading: 0 };
      entry.count++;
      if (HEADING_TAGS.has(node.tag)) entry.heading++;
      familyTally.set(key, entry);
      sizes.add(sizePx);
      weights.add(text.weight);
      lineHeights.add(text.lineHeight);
      letterSpacings.add(text.letterSpacing);
    }

    if (wantsTag) {
      const entry = byTag.get(node.tag) ?? { styles: new Tally<string>(), samples: new Map(), count: 0, textCount: 0 };
      const signature = [text.stack, text.sizePx, text.weight, text.lineHeight, text.letterSpacing, text.transform, text.color].join('|');
      // Nodes without their own text (e.g. a button wrapping a span) only count when no node of that tag has text.
      entry.count++;
      if (node.text) entry.textCount++;
      if (node.text || entry.textCount === 0) {
        entry.styles.add(signature);
        entry.samples.set(signature, text);
      }
      byTag.set(node.tag, entry);
    }
  }

  // Families: icon fonts are not typography. Roles: body = most used, heading = top heading font.
  const families: FontFamilyToken[] = [...familyTally.values()]
    .filter((f) => !ICON_FONT.test(f.names.join(' ')))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOKEN_TUNING.maxFamilies)
    .map((f) => ({
      name: primaryName(f.names),
      stack: f.stack,
      category: fontCategory(f.names),
      count: f.count,
      role: null,
    }));
  const raw = [...familyTally.values()];
  const byHeading = [...raw].sort((a, b) => b.heading - a.heading)[0];
  const body = families[0];
  if (body) body.role = 'body';
  const heading = byHeading && byHeading.heading > 0 ? families.find((f) => f.stack === byHeading.stack) : undefined;
  if (heading && heading !== body) heading.role = 'heading';
  const mono = families.find((f) => f.category === 'mono' && f.role === null);
  if (mono) mono.role = 'mono';

  const tags: TagTypography[] = [];
  for (const tag of TAG_STYLES) {
    const entry = byTag.get(tag);
    const top = entry?.styles.top(1)[0];
    const sample = top && entry?.samples.get(top[0]);
    if (!entry || !sample) continue;
    tags.push({
      tag,
      fontFamily: sample.stack,
      fontSizePx: sample.sizePx,
      fontWeight: sample.weight,
      lineHeight: sample.lineHeight,
      letterSpacing: sample.letterSpacing,
      textTransform: sample.transform,
      color: sample.color,
      count: entry.count,
    });
  }

  const sizeScale: ScaleValue[] = sizes
    .top(TOKEN_TUNING.maxFontSizes)
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => a.px - b.px);

  return {
    families,
    sizes: sizeScale,
    weights: toValueCounts(weights, 8).sort((a, b) => Number(a.value) - Number(b.value)),
    lineHeights: toValueCounts(lineHeights, 8),
    letterSpacings: toValueCounts(letterSpacings, 6),
    tags,
  };
}
