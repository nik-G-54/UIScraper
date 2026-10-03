import type { CapturedNode, StyleRecord } from '../../shared/types';
import { colorDistance, normalizeColor } from '../tokens/color';
import { styleToTailwind } from './tailwind';
import type { TailwindContext } from './tailwind';
import type { Tree } from './tree';

const SIZED_TAGS = new Set(['img', 'svg', 'video', 'canvas']);

/**
 * Tailwind classes for one captured node: its style record plus what only the box tells us.
 * Auto-centred blocks (computed margins come back as equal pixel values) become `mx-auto`, and
 * images/SVGs get an explicit size.
 */
export function nodeClasses(tree: Tree, node: CapturedNode, ctx: TailwindContext): string[] {
  const base = tree.style(node);
  const style: StyleRecord = { ...base };
  const parent = node.parentId === null ? null : (tree.nodes[node.parentId] as CapturedNode);
  const left = style['margin-left'];
  const right = style['margin-right'];
  if (parent && left !== undefined && left === right && node.rect.width < parent.rect.width - 1) {
    const side = parseFloat(left);
    if (side > 0 && Math.abs(side * 2 + node.rect.width - parent.rect.width) <= 2) {
      style['margin-left'] = 'auto';
      style['margin-right'] = 'auto';
    }
  }
  const classes = styleToTailwind(style, ctx);
  if (SIZED_TAGS.has(node.tag)) {
    const w = styleToTailwind({ 'margin-left': `${Math.round(node.rect.width)}px` }, ctx)[0]?.replace(/^ml-/, 'w-');
    const h = styleToTailwind({ 'margin-left': `${Math.round(node.rect.height)}px` }, ctx)[0]?.replace(/^ml-/, 'h-');
    if (w) classes.push(w);
    if (h) classes.push(h);
  }
  return classes;
}

/** Solid background of a node (alpha >= 0.5), or null. */
export function solidBackground(style: StyleRecord): string | null {
  const raw = style['background-color'];
  if (raw === undefined) return null;
  const hex = normalizeColor(raw);
  if (!hex) return null;
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return alpha >= 0.5 ? hex : null;
}

/** Name in theme.css of the colour token closest to `hex` (CIEDE2000 <= 1.5), or null. */
export function colorTokenName(hex: string, ctx: TailwindContext): string | null {
  let best: { name: string; distance: number } | null = null;
  for (const c of ctx.colors) {
    if (c.hex.length !== hex.length) continue;
    const distance = c.hex === hex ? 0 : colorDistance(c.hex, hex);
    if (distance <= 1.5 && (!best || distance < best.distance)) best = { name: c.name, distance };
  }
  return best?.name ?? null;
}
