import { KEY_ELEMENTS } from '../../shared/config';
import type { CapturedNode, DecorativeLine, PageSection, SectionGeometry, StyleRecord } from '../../shared/types';
import { normalizeColor } from '../tokens/color';
import { parsePx } from '../tokens/util';
import { findContainer } from './container';
import type { Tree } from './tree';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
const MEDIA_TAGS = new Set(['img', 'svg', 'canvas', 'video', 'picture', 'iframe', 'embed', 'object', 'input', 'select', 'textarea', 'button']);
const MAX_LINE_THICKNESS = 2;

export function emptyGeometry(): SectionGeometry {
  return { contentLeft: 0, contentWidth: 0, maxWidth: null, inkLeft: null, inkRight: null, lines: [] };
}

export interface Border {
  side: Side;
  width: number;
  /** `solid`, `dashed`... */
  kind: string;
  color: string | null;
}

/** Borders that paint something: width > 0 and a style other than none/hidden. A missing colour is currentcolor (black). */
export function visibleBorders(style: StyleRecord): Border[] {
  const out: Border[] = [];
  for (const side of SIDES) {
    const width = parsePx(style[`border-${side}-width`]) ?? 0;
    const kind = style[`border-${side}-style`];
    if (width <= 0 || !kind || kind === 'none' || kind === 'hidden') continue;
    out.push({ side, width, kind, color: normalizeColor(style[`border-${side}-color`] ?? 'rgb(0, 0, 0)') });
  }
  return out;
}

const hasImage = (style: StyleRecord): boolean => style['background-image'] !== undefined && style['background-image'] !== 'none';
const hasShadow = (style: StyleRecord): boolean => style['box-shadow'] !== undefined && style['box-shadow'] !== 'none';

/**
 * Elements whose only visible paint is a thin line: a 1-2px filled box spanning most of the section,
 * or an element whose only paint is a 1-2px border on one or two sides (a divider, a column rule).
 * Text, images, shadows and gradients rule an element out. Positions are document coordinates.
 */
export function findDecorativeLines(tree: Tree, block: CapturedNode): DecorativeLine[] {
  const section = block.rect;
  const found = new Map<string, DecorativeLine>();
  const add = (line: DecorativeLine) => {
    const key = `${line.orientation}|${Math.round(line.at)}|${line.thicknessPx}|${line.color}`;
    const existing = found.get(key);
    if (!existing || existing.length < line.length) found.set(key, { ...line, at: Math.round(line.at), length: Math.round(line.length) });
  };

  for (const node of tree.descendants(block)) {
    if (!tree.isVisible(node) || node.svg || node.placeholder || MEDIA_TAGS.has(node.tag)) continue;
    const style = tree.style(node);
    if (hasImage(style) || hasShadow(style)) continue;
    const { x, y, width, height } = node.rect;
    const leaf = (tree.visibleSize[node.id] ?? 1) <= 1;
    if (leaf && node.text) continue;
    const fill = style['background-color'] === undefined ? null : normalizeColor(style['background-color']);
    const borders = visibleBorders(style);

    if (fill) {
      if (!leaf || borders.length > 0) continue;
      if (width <= MAX_LINE_THICKNESS && height >= Math.max(KEY_ELEMENTS.minLinePx, section.height * KEY_ELEMENTS.lineSpanRatio)) {
        add({ orientation: 'vertical', at: x, thicknessPx: width, color: fill, length: height });
      } else if (height <= MAX_LINE_THICKNESS && width >= Math.max(KEY_ELEMENTS.minLinePx, section.width * KEY_ELEMENTS.lineSpanRatio)) {
        add({ orientation: 'horizontal', at: y, thicknessPx: height, color: fill, length: width });
      }
      continue;
    }

    // Border-only paint: thin borders on at most two sides (all four is an outline, not a line).
    if (borders.length === 0 || borders.length > 2 || borders.some((b) => b.width > MAX_LINE_THICKNESS)) continue;
    for (const b of borders) {
      const vertical = b.side === 'left' || b.side === 'right';
      const length = vertical ? height : width;
      const needed = leaf
        ? KEY_ELEMENTS.minLinePx
        : Math.max(KEY_ELEMENTS.minLinePx, (vertical ? section.height : section.width) * KEY_ELEMENTS.lineSpanRatio);
      if (length < needed) continue;
      const at = b.side === 'left' ? x : b.side === 'right' ? x + width - b.width : b.side === 'top' ? y : y + height - b.width;
      add({ orientation: vertical ? 'vertical' : 'horizontal', at, thicknessPx: b.width, color: b.color, length });
    }
  }
  return [...found.values()]
    .sort((a, b) => (a.orientation === b.orientation ? a.at - b.at : a.orientation === 'vertical' ? -1 : 1))
    .slice(0, KEY_ELEMENTS.maxLinesPerSection);
}

/** Content box of the main container, the extent of the visible content, max-width and decorative lines. */
export function sectionGeometry(tree: Tree, section: PageSection): SectionGeometry {
  const block = tree.nodes[section.nodeId] as CapturedNode;
  const { container } = findContainer(tree, block);
  const style = tree.style(container);
  const padLeft = parsePx(style['padding-left']) ?? 0;
  const padRight = parsePx(style['padding-right']) ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;

  let inkLeft: number | null = null;
  let inkRight: number | null = null;
  for (const node of tree.descendants(block)) {
    if (!tree.isVisible(node) || node.possibleOverlay || !(node.text || node.svg || node.tag === 'img')) continue;
    inkLeft = Math.min(inkLeft ?? Infinity, node.rect.x);
    inkRight = Math.max(inkRight ?? -Infinity, node.rect.x + node.rect.width);
  }

  return {
    contentLeft: round(container.rect.x + padLeft),
    contentWidth: round(Math.max(0, container.rect.width - padLeft - padRight)),
    maxWidth: section.layout.containerMaxWidth,
    inkLeft: inkLeft === null ? null : Math.round(inkLeft),
    inkRight: inkRight === null ? null : Math.round(inkRight),
    lines: findDecorativeLines(tree, block),
  };
}
