import { KEY_ELEMENTS } from '../../shared/config';
import type { CapturedNode, ColorRef, KeyElement, KeyElementRole, PageSection, StyleRecord, TextRun } from '../../shared/types';
import { DEFAULT_LINK_COLOR, DEFAULT_TEXT_COLOR, normalizeColor } from '../tokens/color';
import { gradientLayers } from '../tokens/gradient';
import { defaultFontSizePx } from '../tokens/typography';
import { parsePx } from '../tokens/util';
import { classifyComponent } from './components';
import { visibleBorders } from './geometry';
import { colorTokenName, nodeClasses, solidBackground } from './nodeClasses';
import { radiusInfo } from './radius';
import type { TailwindContext } from './tailwind';
import type { Tree } from './tree';

const HEADING = /^h([1-6])$/;
const INLINE_TAGS = new Set(['span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'mark', 'code', 'small', 'sub', 'sup', 'abbr', 'cite', 'q', 'label', 'br', 'time', 'kbd']);
const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|flow-root)/;
const MEDIA_TAGS = new Set(['img', 'svg', 'canvas', 'video']);
const CHROME_TAGS = new Set(['header', 'nav', 'footer']);
const BACKDROP_MIN_AREA = 200 * 100;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const px = (n: number): string => `${round2(n)}px`;

function colorRef(hex: string | null, ctx: TailwindContext): ColorRef | null {
  return hex ? { hex, token: colorTokenName(hex, ctx) } : null;
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The text fill is invisible (`transparent`): the glyphs are painted by a clipped background instead. */
const hasTransparentFill = (style: StyleRecord): boolean => {
  const fill = style['-webkit-text-fill-color'];
  return fill !== undefined && normalizeColor(fill) === null;
};
const isClippedText = (style: StyleRecord): boolean => style['background-clip'] === 'text' || hasTransparentFill(style);

function defaultWeight(tag: string): string {
  return /^h[1-6]$|^(b|strong|th)$/.test(tag) ? '700' : '400';
}

function inlineLook(node: CapturedNode, style: StyleRecord): Omit<TextRun, 'text' | 'fontSizePx'> & { sizePx: number } {
  const gradientText = isClippedText(style);
  const hex = gradientText ? null : normalizeColor(style['-webkit-text-fill-color'] ?? style.color ?? (node.tag === 'a' ? DEFAULT_LINK_COLOR : DEFAULT_TEXT_COLOR));
  return {
    color: hex,
    colorToken: null,
    fontWeight: style['font-weight'] ?? defaultWeight(node.tag),
    gradientText,
    sizePx: parsePx(style['font-size']) ?? defaultFontSizePx(node.tag),
  };
}

/** Elements that hold the text of `el`, in order: its own text first, then descendants that carry text. */
function textParts(tree: Tree, el: CapturedNode): CapturedNode[] {
  const parts: CapturedNode[] = [];
  if (el.text) parts.push(el);
  for (const node of tree.descendants(el)) if (node.text && tree.isVisible(node)) parts.push(node);
  return parts;
}

/**
 * Inline runs of a text block: adjacent pieces with the same colour, weight and size are merged.
 * An element's own text is assumed to come before its children's text.
 */
export function textRuns(tree: Tree, el: CapturedNode, ctx: TailwindContext): TextRun[] {
  const runs: (TextRun & { sizePx: number })[] = [];
  let last = '';
  for (const part of textParts(tree, el)) {
    const look = inlineLook(part, tree.style(part));
    const signature = `${look.color}|${look.fontWeight}|${look.sizePx}|${look.gradientText}`;
    const text = part.text as string;
    const previous = runs[runs.length - 1];
    if (previous && signature === last) {
      previous.text = `${previous.text} ${text}`;
      continue;
    }
    last = signature;
    runs.push({ text, ...look, colorToken: look.color ? colorTokenName(look.color, ctx) : null, fontSizePx: null });
  }
  const first = runs[0];
  return runs.map(({ sizePx, ...run }) => ({ ...run, fontSizePx: first && sizePx !== first.sizePx ? round2(sizePx) : null }));
}

/** True when the runs do not all look the same (color, weight, size or gradient fill). */
export const runsDiffer = (runs: readonly TextRun[]): boolean =>
  runs.length >= 2 &&
  runs.some((r) => r.color !== runs[0]?.color || r.fontWeight !== runs[0]?.fontWeight || r.fontSizePx !== null || r.gradientText !== runs[0]?.gradientText);

function inlineOnly(tree: Tree, el: CapturedNode): boolean {
  return tree.descendants(el).every((n) => {
    if (!tree.isVisible(n)) return true;
    const display = tree.style(n).display;
    return (INLINE_TAGS.has(n.tag) || n.svg === true) && !(display && BLOCK_DISPLAY.test(display));
  });
}

function formatBorder(style: StyleRecord): string | null {
  const borders = visibleBorders(style);
  if (borders.length === 0) return null;
  const fmt = (b: (typeof borders)[number]) => `${px(b.width)} ${b.kind}${b.color ? ` ${b.color}` : ''}`;
  const [first] = borders;
  if (borders.length === 4 && first && borders.every((b) => fmt(b) === fmt(first))) return fmt(first);
  return borders.map((b) => `${b.side} ${fmt(b)}`).join(', ');
}

function formatPadding(style: StyleRecord): string | null {
  const [t, r, b, l] = (['top', 'right', 'bottom', 'left'] as const).map((s) => round2(parsePx(style[`padding-${s}`]) ?? 0));
  if (!t && !r && !b && !l) return null;
  if (t === r && r === b && b === l) return px(t as number);
  if (t === b && r === l) return `${px(t as number)} ${px(r as number)}`;
  return [t, r, b, l].map((n) => px(n as number)).join(' ');
}

interface Backdrop {
  node: CapturedNode;
  kind: 'gradient' | 'canvas' | 'video' | 'image';
  detail: string | null;
}

/** Layers that can sit behind text: canvas/video, large images, backgrounds with a gradient or url(). */
function findBackdrops(tree: Tree, block: CapturedNode): Backdrop[] {
  const out: Backdrop[] = [];
  for (const node of [block, ...tree.descendants(block)]) {
    if (!tree.isVisible(node) || node.possibleOverlay) continue;
    const { width, height } = node.rect;
    const style = tree.style(node);
    if (node.tag === 'canvas' || node.tag === 'video') out.push({ node, kind: node.tag, detail: null });
    else if (node.tag === 'img' && width * height >= BACKDROP_MIN_AREA) out.push({ node, kind: 'image', detail: null });
    const image = style['background-image'];
    if (image && image !== 'none' && !(style['background-clip'] === 'text')) {
      const gradient = gradientLayers(image)[0];
      if (gradient) out.push({ node, kind: 'gradient', detail: gradient });
      else if (/url\(/i.test(image)) out.push({ node, kind: 'image', detail: null });
    }
  }
  return out;
}

function effectNotes(tree: Tree, block: CapturedNode, el: CapturedNode, style: StyleRecord, backdrops: readonly Backdrop[], text: boolean): string[] {
  const notes: string[] = [];
  const cx = el.rect.x + el.rect.width / 2;
  const cy = el.rect.y + el.rect.height / 2;
  const area = el.rect.width * el.rect.height;
  const end = el.id + (tree.span[el.id] ?? 1);
  if (text) {
    const seen = new Set<string>();
    for (const layer of backdrops) {
      const r = layer.node.rect;
      if (layer.node.id >= el.id && layer.node.id < end) continue;
      if (cx < r.x || cx > r.x + r.width || cy < r.y || cy > r.y + r.height || r.width * r.height < area) continue;
      if (seen.has(layer.kind)) continue;
      seen.add(layer.kind);
      notes.push(layer.kind === 'gradient' ? `text sits over a gradient (${clip(layer.detail ?? '', 90)})` : `text sits over ${layer.kind === 'image' ? 'an image' : `a ${layer.kind}`}`);
    }
    if (isClippedText(style)) {
      const gradient = gradientLayers(style['background-image'] ?? '')[0];
      const how = [style['background-clip'] === 'text' ? 'background-clip: text' : null, hasTransparentFill(style) ? '-webkit-text-fill-color: transparent' : null].filter(Boolean).join(', ');
      notes.push(`clipped text (${how})${gradient ? ` showing ${clip(gradient, 90)}` : ''}`);
    } else if (style['-webkit-text-fill-color']) {
      notes.push(`-webkit-text-fill-color: ${style['-webkit-text-fill-color']}`);
    }
  }
  for (let current: CapturedNode | null = el; current; current = current.parentId === null || current.id === block.id ? null : (tree.nodes[current.parentId] as CapturedNode)) {
    const blend = tree.style(current)['mix-blend-mode'];
    if (blend && blend !== 'normal') {
      notes.push(`mix-blend-mode: ${blend}${current === el ? '' : ' (set on an ancestor)'}`);
      break;
    }
  }
  return notes;
}

interface Candidate {
  node: CapturedNode;
  role: KeyElementRole;
  tier: number;
  weight: number;
}

function imageRole(node: CapturedNode, section: PageSection): KeyElementRole | null {
  const { width, height } = node.rect;
  if (width < 16 || height < 12) return null;
  const label = `${node.attrs?.alt ?? ''} ${node.attrs?.['aria-label'] ?? ''}`;
  const chrome = CHROME_TAGS.has(section.tag) && width <= 240 && height <= 100;
  if (chrome || /logo/i.test(label)) return 'logo';
  if (node.svg && width < 48 && height < 48) return null;
  return 'image';
}

function candidates(tree: Tree, section: PageSection, block: CapturedNode): Candidate[] {
  const out: Candidate[] = [];
  const end = block.id + (tree.span[block.id] ?? 1);
  for (let i = block.id + 1; i < end; ) {
    const node = tree.nodes[i] as CapturedNode;
    const span = tree.span[i] ?? 1;
    if (node.possibleOverlay || (!tree.isVisible(node) && node.hidden !== 'zero-size')) {
      i += span;
      continue;
    }
    if (!tree.isVisible(node)) {
      i += 1;
      continue;
    }

    if (MEDIA_TAGS.has(node.tag) || node.placeholder) {
      const role = node.placeholder && !MEDIA_TAGS.has(node.tag) ? (node.rect.width >= 48 && node.rect.height >= 48 ? 'image' : null) : imageRole(node, section);
      if (role) out.push({ node, role, tier: role === 'logo' ? 1 : 2, weight: node.rect.width * node.rect.height });
      i += span;
      continue;
    }

    const level = HEADING.exec(node.tag);
    const block_ = level !== null || node.tag === 'p' || node.tag === 'button' || node.tag === 'a' || node.attrs?.role === 'button';
    if (!node.text && !block_) {
      i += 1;
      continue;
    }
    const parts = textParts(tree, node);
    if (parts.length === 0) {
      i += 1;
      continue;
    }
    const style = tree.style(node);
    const size = parsePx(style['font-size']) ?? defaultFontSizePx(node.tag);
    const text = parts.map((p) => p.text).join(' ');

    let role: KeyElementRole | null = null;
    let tier = 2;
    const kind = node.tag === 'p' || level ? null : classifyComponent(tree, node);
    if (level) {
      role = 'heading';
      tier = Number(level[1]) <= 3 ? 0 : 3;
    } else if (kind === 'button' || node.tag === 'button' || node.attrs?.role === 'button') {
      role = 'button';
      tier = 1;
    } else if (kind === 'badge') {
      role = 'badge';
      tier = 3;
    } else if (size >= KEY_ELEMENTS.largeTextPx) {
      role = 'heading';
      tier = 0;
    } else if (node.tag !== 'a' && (node.tag === 'p' || text.length >= KEY_ELEMENTS.minParagraphChars)) {
      role = 'paragraph';
      tier = 2;
    }
    // Wrapper elements with child blocks are not text blocks; only headings, paragraphs and buttons absorb their subtree.
    const absorbs = level !== null || node.tag === 'p' || role === 'button';
    if (role === null || (!absorbs && !inlineOnly(tree, node))) {
      i += 1;
      continue;
    }
    out.push({ node, role, tier, weight: role === 'heading' || role === 'paragraph' ? size : node.rect.width * node.rect.height });
    i += span;
  }
  return out;
}

/** Row-wise reading order: top to bottom, left to right within a row (elements within 8px of the row's top). */
function readingOrder(items: Candidate[]): Candidate[] {
  const sorted = [...items].sort((a, b) => a.node.rect.y - b.node.rect.y || a.node.rect.x - b.node.rect.x);
  const out: Candidate[] = [];
  let row: Candidate[] = [];
  let rowTop = -Infinity;
  const flush = () => out.push(...row.sort((a, b) => a.node.rect.x - b.node.rect.x));
  for (const item of sorted) {
    if (item.node.rect.y - rowTop > 8) {
      flush();
      row = [];
      rowTop = item.node.rect.y;
    }
    row.push(item);
  }
  flush();
  return out;
}

/**
 * The most important visible elements of a section in reading order: headings (h1-h3 or large text),
 * button-like links/buttons, images and logos, paragraphs, badges, in that priority, each with its
 * measured typography, colours, border, radius and Tailwind classes.
 */
export function selectKeyElements(tree: Tree, section: PageSection, ctx: TailwindContext, max: number = KEY_ELEMENTS.maxPerSection): KeyElement[] {
  const block = tree.nodes[section.nodeId] as CapturedNode;
  const picked = readingOrder(
    candidates(tree, section, block)
      .sort((a, b) => a.tier - b.tier || b.weight - a.weight || a.node.rect.y - b.node.rect.y)
      .slice(0, max),
  );
  const backdrops = picked.some((c) => c.role !== 'image' && c.role !== 'logo') ? findBackdrops(tree, block) : [];

  return picked.map(({ node, role }): KeyElement => {
    const style = tree.style(node);
    const isImage = role === 'image' || role === 'logo';
    const radius = radiusInfo(style, node.rect);
    const runs = isImage ? [] : textRuns(tree, node, ctx);
    const text = isImage ? (node.attrs?.alt ?? node.attrs?.['aria-label'] ?? null) : runs.map((r) => r.text).join(' ');
    const first = isImage ? null : runs[0];
    const bgHex = solidBackground(style);
    const textColor = first && !first.gradientText ? first.color : null;
    const notes = effectNotes(tree, block, node, style, backdrops, !isImage);
    const bgImage = style['background-image'];
    const ownGradient = bgImage && bgImage !== 'none' && style['background-clip'] !== 'text' ? gradientLayers(bgImage)[0] : null;
    if (ownGradient) notes.push(`own background gradient: ${clip(ownGradient, 120)}`);

    return {
      nodeId: node.id,
      role,
      tag: node.tag,
      text: text ? clip(text, KEY_ELEMENTS.maxTextChars) : null,
      rect: { x: Math.round(node.rect.x), y: Math.round(node.rect.y), width: Math.round(node.rect.width), height: Math.round(node.rect.height) },
      fontFamily: isImage ? null : ((style['font-family'] ?? '').split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '') || null,
      fontSizePx: isImage ? null : round2(parsePx(style['font-size']) ?? defaultFontSizePx(node.tag)),
      lineHeight: isImage ? null : (style['line-height'] ?? 'normal'),
      fontWeight: isImage ? null : (style['font-weight'] ?? defaultWeight(node.tag)),
      letterSpacing: isImage ? null : (style['letter-spacing'] ?? 'normal'),
      color: colorRef(textColor, ctx),
      background: colorRef(bgHex, ctx),
      border: formatBorder(style),
      radius: radius.value,
      pill: radius.pill,
      padding: formatPadding(style),
      tailwind: nodeClasses(tree, node, ctx).join(' '),
      runs: runsDiffer(runs) ? runs.slice(0, KEY_ELEMENTS.maxRuns) : [],
      notes,
      src: node.tag === 'img' ? (node.attrs?.src ?? null) : null,
    };
  });
}
