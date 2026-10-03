import { LAYOUT_TUNING } from '../../shared/config';
import type {
  CapturedNode,
  ComponentGroup,
  ComponentKind,
  ComponentVariant,
  PageSection,
  StyleRecord,
} from '../../shared/types';
import { nodeClasses, solidBackground } from './nodeClasses';
import { radiusInfo } from './radius';
import { sectionOfNode } from './sections';
import { computeStructureHashes } from './structure';
import { styleToTailwind } from './tailwind';
import type { TailwindContext } from './tailwind';
import type { Tree } from './tree';

/** Tags that are never a component of their own (page furniture, media, text leaves). */
const SKIP_TAGS = new Set([
  'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'svg', 'img', 'picture', 'video', 'canvas', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);
/** Leaf tags that count as a component even without a visible box. */
const ALWAYS_LEAF = new Set(['a', 'button', 'input', 'select', 'textarea', 'li', 'label']);
const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea']);

/** Properties whose difference makes two members look different (layout offsets are ignored). */
const VISUAL_PROPS = [
  'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'text-transform', 'text-decoration-line',
  'border-top-width', 'border-top-color', 'border-top-style', 'border-top-left-radius', 'box-shadow', 'opacity',
] as const;

const hasBox = (style: StyleRecord): boolean =>
  solidBackground(style) !== null ||
  ['top', 'right', 'bottom', 'left'].some((side) => {
    const width = style[`border-${side}-width`];
    return width !== undefined && parseFloat(width) > 0;
  }) ||
  (style['box-shadow'] !== undefined && style['box-shadow'] !== 'none');

const paddingOf = (style: StyleRecord): number =>
  Math.max(...['top', 'right', 'bottom', 'left'].map((side) => parseFloat(style[`padding-${side}`] ?? '0') || 0));

function inNav(tree: Tree, node: CapturedNode): boolean {
  return tree.findAncestor(node, (a) => a.tag === 'nav' || a.attrs?.role === 'navigation') !== null;
}

/** Name a repeated structure from its tag, attributes and look (never class names). */
export function classifyComponent(tree: Tree, node: CapturedNode): ComponentKind {
  const style = tree.style(node);
  const { width, height } = node.rect;
  const size = tree.visibleSize[node.id] ?? 1;
  if (node.tag === 'input' || node.tag === 'textarea' || node.tag === 'select') {
    return node.tag === 'input' && (node.attrs?.type === 'submit' || node.attrs?.type === 'button') ? 'button' : 'input';
  }
  if (node.tag === 'button' || node.attrs?.role === 'button') return 'button';
  const buttonLike = hasBox(style) && paddingOf(style) >= 6 && height >= 24 && height <= 80 && width <= 420;
  if (node.tag === 'a') {
    if (inNav(tree, node)) return 'nav-item';
    return buttonLike ? 'button' : 'link';
  }
  if (node.tag === 'li') return inNav(tree, node) ? 'nav-item' : 'list-item';
  const fontSize = parseFloat(style['font-size'] ?? '16') || 16;
  if (size <= 3 && hasBox(style) && width <= 180 && height <= 40 && fontSize <= 15) return 'badge';
  const parent = node.parentId === null ? null : tree.nodes[node.parentId];
  if (parent && (parent.tag === 'ul' || parent.tag === 'ol')) return 'list-item';
  const content = tree.descendants(node).some((n) => n.svg || n.tag === 'img' || /^h[1-6]$/.test(n.tag));
  if (size >= 3 && hasBox(style) && content && width >= 120 && width <= 720 && height >= 80 && height <= 900) return 'card';
  return 'generic';
}

/** `div[img, div[h3, p], a]`: tags only, two levels deep, repeated siblings folded (`li×5`). */
export function outline(tree: Tree, node: CapturedNode, depth = 2): string {
  if (depth === 0) return node.tag;
  const kids = tree.visibleChildren(node);
  if (kids.length === 0) return node.tag;
  const parts: string[] = [];
  let i = 0;
  while (i < kids.length && parts.length < 6) {
    const kid = kids[i] as CapturedNode;
    const text = outline(tree, kid, depth - 1);
    let run = 1;
    while (i + run < kids.length && outline(tree, kids[i + run] as CapturedNode, depth - 1) === text) run++;
    parts.push(run > 1 ? `${text}×${run}` : text);
    i += run;
  }
  if (i < kids.length) parts.push('…');
  return `${node.tag}[${parts.join(', ')}]`;
}

/** The first bit of visible text inside a node. */
function textOf(tree: Tree, node: CapturedNode): string | null {
  const text = node.text ?? tree.descendants(node).find((n) => n.text && tree.isVisible(n))?.text;
  if (!text) return null;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

const visualKey = (style: StyleRecord): string => VISUAL_PROPS.map((p) => style[p] ?? '').join('|');

function isCandidate(tree: Tree, node: CapturedNode): boolean {
  if (SKIP_TAGS.has(node.tag) || !tree.isVisible(node) || node.possibleOverlay || node.parentId === null) return false;
  const { width, height } = node.rect;
  if (width < 16 || height < 12) return false;
  if (width >= tree.pageWidth * 0.9 && height > 300) return false;
  const size = tree.visibleSize[node.id] ?? 0;
  if (size > LAYOUT_TUNING.maxComponentSubtree) return false;
  if (size >= 3) return true;
  if (ALWAYS_LEAF.has(node.tag)) return true;
  return size >= 1 && (node.tag === 'span' || node.tag === 'div') && hasBox(tree.style(node));
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Find repeated structures: subtrees with the same tags and child shape that occur 2+ times. Each
 * group becomes a named component with a representative node and its style variants.
 */
export function detectComponents(tree: Tree, sections: readonly PageSection[], ctx: TailwindContext): ComponentGroup[] {
  const hashes = computeStructureHashes(tree, LAYOUT_TUNING.hashDepth);
  const buckets = new Map<number, CapturedNode[]>();
  for (const node of tree.nodes) {
    if (!isCandidate(tree, node)) continue;
    const key = hashes.structure[node.id] as number;
    const list = buckets.get(key);
    if (list) list.push(node);
    else buckets.set(key, [node]);
  }

  interface Draft {
    kind: ComponentKind;
    members: CapturedNode[];
    representative: CapturedNode;
    variants: ComponentVariant[];
    score: number;
  }
  const drafts: Draft[] = [];

  // Same shape is not enough: a plain link and a styled button share their tags but are not one component.
  const groups: CapturedNode[][] = [];
  for (const list of buckets.values()) {
    if (list.length < LAYOUT_TUNING.minComponentCount) continue;
    const byKind = new Map<ComponentKind, CapturedNode[]>();
    for (const node of list) {
      const kind = classifyComponent(tree, node);
      const entry = byKind.get(kind);
      if (entry) entry.push(node);
      else byKind.set(kind, [node]);
    }
    groups.push(...byKind.values());
  }

  for (const list of groups) {
    if (list.length < LAYOUT_TUNING.minComponentCount) continue;
    // Same shape but wildly different size is a different thing.
    const areas = list.map((n) => n.rect.width * n.rect.height);
    const mid = median(areas);
    let members = list.filter((_, i) => {
      const area = areas[i] as number;
      return mid > 0 && area <= mid * LAYOUT_TUNING.areaRatio && area >= mid / LAYOUT_TUNING.areaRatio;
    });
    // Keep the outermost of nested look-alikes.
    members = members.filter((n) => !members.some((o) => o !== n && tree.isInside(o.id, n.id)));
    if (members.length < LAYOUT_TUNING.minComponentCount) continue;

    // Look: members with the same root look are one variant; the most common is the base.
    const byLook = new Map<string, CapturedNode[]>();
    for (const m of members) {
      const key = visualKey(tree.style(m));
      const entry = byLook.get(key);
      if (entry) entry.push(m);
      else byLook.set(key, [m]);
    }
    const looks = [...byLook.values()].sort((a, b) => b.length - a.length);
    const baseLook = looks[0] as CapturedNode[];
    const representative = baseLook[Math.floor(baseLook.length / 2)] as CapturedNode;
    const baseStyle = tree.style(representative);

    const variants: ComponentVariant[] = looks.slice(1, 1 + LAYOUT_TUNING.maxVariants).map((group) => {
      const sample = group[0] as CapturedNode;
      const style = tree.style(sample);
      const diff: Record<string, string> = {};
      const only: StyleRecord = {};
      for (const prop of VISUAL_PROPS) {
        if ((style[prop] ?? '') !== (baseStyle[prop] ?? '')) {
          diff[prop] = style[prop] ?? 'default';
          if (style[prop] !== undefined) only[prop] = style[prop] as string;
        }
      }
      return { count: group.length, nodeId: sample.id, diff, tailwind: styleToTailwind(only, ctx).join(' ') };
    });

    const kind = classifyComponent(tree, representative);
    const size = tree.visibleSize[representative.id] ?? 1;
    drafts.push({
      kind,
      members,
      representative,
      variants,
      score: members.length * Math.min(size, 40) + (kind === 'generic' ? 0 : 1000),
    });
  }

  // A generic look-alike that sits inside members of another (larger or named) group is just that
  // group's internals, not a component.
  const owner = new Map<number, Draft>();
  for (const draft of drafts) if (draft.kind !== 'generic') for (const m of draft.members) owner.set(m.id, draft);
  const kept = drafts.filter((draft) => {
    if (draft.kind !== 'generic') return true;
    const inside = draft.members.filter((m) => tree.findAncestor(m, (a) => owner.has(a.id)) !== null).length;
    return inside / draft.members.length < 0.8;
  });

  kept.sort((a, b) => b.score - a.score);
  const used = new Map<string, number>();
  return kept.slice(0, LAYOUT_TUNING.maxComponents).map((draft) => {
    const n = (used.get(draft.kind) ?? 0) + 1;
    used.set(draft.kind, n);
    const rep = draft.representative;
    const tallies = new Map<string, number>();
    for (const m of draft.members) {
      const name = sectionOfNode(tree, sections, m.id)?.name;
      if (name) tallies.set(name, (tallies.get(name) ?? 0) + 1);
    }
    const section = [...tallies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      name: n === 1 ? draft.kind : `${draft.kind}-${n}`,
      kind: draft.kind,
      count: draft.members.length,
      nodeId: rep.id,
      tag: rep.tag,
      size: { width: Math.round(rep.rect.width), height: Math.round(rep.rect.height) },
      structure: outline(tree, rep),
      text: INTERACTIVE.has(rep.tag) || draft.kind === 'badge' || draft.kind === 'nav-item' ? textOf(tree, rep) : null,
      tailwind: nodeClasses(tree, rep, ctx).join(' '),
      ...(({ value, pill }) => ({ radius: value, pill }))(radiusInfo(tree.style(rep), rep.rect)),
      variants: draft.variants,
      states: [],
      section,
      members: draft.members.slice(0, LAYOUT_TUNING.maxMembersKept).map((m) => m.id),
    };
  });
}
