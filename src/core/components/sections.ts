import { LAYOUT_TUNING } from '../../shared/config';
import type { CapturedNode, LayoutSummary, PageSection, StyleRecord } from '../../shared/types';
import { pageBackground } from '../tokens/color';
import { gradientLayers } from '../tokens/gradient';
import { parsePx, splitTopLevel } from '../tokens/util';
import { colorTokenName, nodeClasses, solidBackground } from './nodeClasses';
import type { TailwindContext } from './tailwind';
import type { Tree } from './tree';

const SEMANTIC = new Set(['header', 'nav', 'main', 'section', 'footer', 'aside', 'article']);
const NAMED_BY_TAG = new Set(['header', 'nav', 'footer', 'main', 'aside']);
const ALWAYS_KEEP = new Set(['header', 'nav', 'footer']);

/** Visible children that can be a page block: wide enough (or a semantic bar), not an overlay. */
function blockChildren(tree: Tree, node: CapturedNode): CapturedNode[] {
  return tree.visibleChildren(node).filter((child) => {
    if (child.possibleOverlay || child.svg) return false;
    const style = tree.style(child);
    const semantic = SEMANTIC.has(child.tag);
    if (child.rect.height < 8) return false;
    if (!semantic && (style.position === 'absolute' || style.position === 'fixed') && child.rect.width < tree.pageWidth * 0.9) return false;
    return semantic || child.rect.width >= tree.pageWidth * 0.5;
  });
}

const isPassThrough = (tree: Tree, node: CapturedNode): boolean =>
  !SEMANTIC.has(node.tag) && node.rect.width >= tree.pageWidth * 0.9;

/** Top-level blocks of the page, in reading order. */
export function findSectionRoots(tree: Tree): CapturedNode[] {
  const start = tree.nodes.find((n) => n.tag === 'body') ?? tree.nodes[0];
  if (!start) return [];

  // Follow wrappers (#root > .app > ...) that hold nothing but one page-wide child.
  let container = start;
  for (let depth = 0; depth < LAYOUT_TUNING.maxWrapperDepth; depth++) {
    const kids = blockChildren(tree, container);
    const only = kids[0];
    if (kids.length === 1 && only && isPassThrough(tree, only)) container = only;
    else break;
  }

  const expand = (block: CapturedNode, level: number): CapturedNode[] => {
    if (level >= 3) return [block];
    const kids = blockChildren(tree, block);
    if (block.tag === 'main' || block.tag === 'article') {
      return kids.length >= 2 ? kids.flatMap((k) => expand(k, level + 1)) : [block];
    }
    if (SEMANTIC.has(block.tag)) return [block];
    if (kids.length === 1 && kids[0] && kids[0].rect.height >= block.rect.height * 0.9 && isPassThrough(tree, kids[0])) {
      return expand(kids[0], level + 1);
    }
    const tall = block.rect.height > tree.viewportHeight * LAYOUT_TUNING.expandBlockViewportRatio;
    return tall && kids.length >= 2 ? kids.flatMap((k) => expand(k, level + 1)) : [block];
  };

  const roots = blockChildren(tree, container).flatMap((block) => expand(block, 0));
  return roots
    .filter((block) => ALWAYS_KEEP.has(block.tag) || block.rect.height >= LAYOUT_TUNING.minSectionHeightPx)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

const fmtPx = (value: string | undefined): string | null => {
  const n = parsePx(value);
  return n === null || n === 0 ? null : `${Number(n.toFixed(2))}px`;
};

/** Display, columns, gap, container width, alignment and vertical padding of a block. */
export function summarizeLayout(tree: Tree, block: CapturedNode): LayoutSummary {
  // The content container: the first flex/grid node on the way down through single-child wrappers.
  const chain: CapturedNode[] = [block];
  let container = block;
  for (let depth = 0; depth < 6; depth++) {
    const display = tree.style(container).display;
    if (display === 'flex' || display === 'grid' || display === 'inline-flex') break;
    const kids = tree.visibleChildren(container);
    const only = kids[0];
    if (kids.length !== 1 || !only || only.rect.width < tree.pageWidth * 0.2) break;
    container = only;
    chain.push(only);
  }
  const style: StyleRecord = tree.style(container);
  const display = style.display ?? 'block';
  const kids = tree.visibleChildren(container);

  let columns = 1;
  if (display === 'grid') {
    const tracks = splitTopLevel((style['grid-template-columns'] ?? '').replace(/\s+/g, ' '), ' ').filter((t) => t !== 'none');
    columns = Math.max(1, tracks.length);
  } else if (display === 'flex' && (style['flex-direction'] ?? 'row').startsWith('row')) {
    columns = Math.max(1, Math.min(kids.length, 12));
  } else if (kids[0]) {
    const top = kids[0].rect.y;
    columns = Math.max(1, kids.filter((k) => Math.abs(k.rect.y - top) <= 4).length);
  }

  const rowGap = fmtPx(style['row-gap']);
  const colGap = fmtPx(style['column-gap']);
  const gap = rowGap && colGap ? (rowGap === colGap ? rowGap : `${rowGap} / ${colGap}`) : (rowGap ?? colGap);

  let containerMaxWidth: number | null = null;
  for (const link of chain) {
    const max = parsePx(tree.style(link)['max-width']);
    if (max !== null && max > 0) {
      containerMaxWidth = max;
      break;
    }
  }
  const width = container.rect.width;
  const left = container.rect.x;
  const right = tree.pageWidth - (left + width);
  let alignment: LayoutSummary['alignment'] = 'full';
  if (width < tree.pageWidth * 0.95) alignment = Math.abs(left - right) <= 8 ? 'center' : left < right ? 'left' : 'right';
  if (containerMaxWidth === null && alignment === 'center') containerMaxWidth = Math.round(width);

  const top = fmtPx(tree.style(block)['padding-top']);
  const bottom = fmtPx(tree.style(block)['padding-bottom']);
  const paddingY = top || bottom ? (top === bottom ? (top as string) : `${top ?? '0px'} / ${bottom ?? '0px'}`) : null;

  return {
    display,
    flexDirection: display === 'flex' || display === 'inline-flex' ? (style['flex-direction'] ?? 'row') : null,
    columns,
    gap,
    containerMaxWidth,
    alignment,
    paddingY,
  };
}

/** First solid background on the way up from `node`, else the page background. */
function backgroundOf(tree: Tree, node: CapturedNode, pageHex: string): { hex: string; gradient: string | null } {
  let gradient: string | null = null;
  for (let current: CapturedNode | null = node; current; current = current.parentId === null ? null : (tree.nodes[current.parentId] as CapturedNode)) {
    const style = tree.style(current);
    const solid = solidBackground(style);
    if (!gradient && style['background-image']) gradient = gradientLayers(style['background-image'])[0] ?? null;
    if (solid) return { hex: solid, gradient };
    if (gradient) break;
  }
  return { hex: pageHex, gradient };
}

function headingsOf(tree: Tree, block: CapturedNode): string[] {
  const found: string[] = [];
  for (const node of tree.descendants(block)) {
    if (/^h[1-3]$/.test(node.tag) && node.text && tree.isVisible(node)) {
      found.push(node.text.length > 80 ? `${node.text.slice(0, 79)}…` : node.text);
      if (found.length >= 3) break;
    }
  }
  return found;
}

/** The page's sections in order, with background token, layout summary and Tailwind classes. */
export function detectSections(tree: Tree, ctx: TailwindContext): PageSection[] {
  const roots = findSectionRoots(tree).slice(0, LAYOUT_TUNING.maxSections);
  const pageHex = pageBackground(tree.capture).hex;
  const used = new Set<string>();
  let counter = 0;
  let heroTaken = false;

  return roots.map((block, index) => {
    let name: string;
    if (NAMED_BY_TAG.has(block.tag)) name = block.tag;
    else if (!heroTaken && tree.descendants(block).some((n) => n.tag === 'h1' && tree.isVisible(n))) {
      name = 'hero';
      heroTaken = true;
    } else name = `section-${++counter}`;
    let unique = name;
    for (let i = 2; used.has(unique); i++) unique = `${name}-${i}`;
    used.add(unique);

    const bg = backgroundOf(tree, block, pageHex);
    return {
      index,
      nodeId: block.id,
      tag: block.tag,
      name: unique,
      rect: block.rect,
      background: { hex: bg.hex, token: colorTokenName(bg.hex, ctx), gradient: bg.gradient },
      layout: summarizeLayout(tree, block),
      headings: headingsOf(tree, block),
      tailwind: nodeClasses(tree, block, ctx).join(' '),
    };
  });
}

/** The section a node lives in: the one whose block contains it, else the one covering its y. */
export function sectionOfNode(tree: Tree, sections: readonly PageSection[], nodeId: number): PageSection | null {
  const node = tree.nodes[nodeId];
  if (!node) return null;
  for (const section of sections) if (section.nodeId === nodeId || tree.isInside(section.nodeId, nodeId)) return section;
  const y = node.rect.y + node.rect.height / 2;
  return sections.find((s) => y >= s.rect.y && y < s.rect.y + s.rect.height) ?? null;
}
