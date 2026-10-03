import { STYLE_PROPERTIES } from './styleProps';
import type {
  BudgetName,
  CaptureTuning,
  CaptureWarning,
  CapturedNode,
  CapturedPlaceholder,
  CapturedPseudo,
  ExtractionBudgets,
  HiddenReason,
  Rect,
  SkipReason,
  StyleRecord,
} from '../../shared/types';
import { abortError } from './abort';
import { CaptureBudget } from './budget';
import type { DefaultStyleSource } from './defaults';
import { isPossibleOverlay } from './overlay';
import { classifyVisibility, isIgnoredTag, NO_PSEUDO_TAGS, PLACEHOLDER_TAGS } from './rules';
import { diffStyles, pruneInvisibleDetails, StyleTable } from './styles';
import { collectAttributes, isSameOrigin, resolveUrl, trimText } from './text';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ShadowInfo = { kind: 'open'; root: ShadowRoot } | { kind: 'closed' } | null;

/** Everything the walker needs from the outside world, so it can be driven from tests. */
export interface CaptureEnv {
  doc: Document;
  now(): number;
  /** Give the page's event loop a turn. */
  yieldNow(): Promise<void>;
  /** Bounding box in viewport coordinates. */
  getRect(el: Element): RectLike;
  getScroll(): { x: number; y: number };
  getViewport(): { width: number; height: number };
  getComputedStyle(el: Element, pseudo?: string): CSSStyleDeclaration;
  getShadow(el: Element): ShadowInfo;
  signal?: AbortSignal;
}

export interface DomCapture {
  nodes: CapturedNode[];
  styleTable: StyleRecord[];
  placeholders: CapturedPlaceholder[];
  warnings: CaptureWarning[];
  counts: {
    visited: number;
    skipped: Record<SkipReason, number>;
    hidden: number;
    pseudoElements: number;
    overlays: number;
    shadowRoots: number;
    closedShadowHosts: number;
  };
  /** Set when the walk stopped early because a budget ran out. */
  truncated: Extract<BudgetName, 'maxNodes' | 'maxCaptureTimeMs'> | null;
}

interface Frame {
  el: Element;
  parentId: number | null;
  depth: number;
  ancestorOpacityZero: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

function isInShadow(el: Element): boolean {
  if (typeof ShadowRoot === 'undefined') return false;
  return el.getRootNode() instanceof ShadowRoot;
}

/** Children in the flat (rendered) tree: shadow content for hosts, assigned nodes for slots. */
function childElements(el: Element, shadow: ShadowInfo): Element[] {
  if (shadow?.kind === 'open') return Array.from(shadow.root.children);
  if (el.localName === 'slot' && 'assignedElements' in el) {
    const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return Array.from(el.children);
}

/** Concatenate the element's own direct text nodes (not descendants'), bounded in length. */
function ownText(el: Element, max: number): string {
  let raw = '';
  for (const child of el.childNodes) {
    if (child.nodeType !== 3) continue;
    raw += (child as Text).data;
    if (raw.length > max * 4) break;
  }
  return raw ? trimText(raw, max) : '';
}

/**
 * Walk the rendered top-frame DOM (including open shadow roots) and record a compact node tree.
 * Iterative and chunked: it yields to the event loop regularly and stops gracefully when a
 * node/time budget runs out. Never uses class names, and never modifies the page.
 */
export async function captureDom(
  env: CaptureEnv,
  budgets: Pick<ExtractionBudgets, 'maxNodes' | 'maxCaptureTimeMs' | 'maxTextLength'>,
  tuning: Pick<CaptureTuning, 'chunkTimeMs' | 'overlayMinZIndex' | 'overlayMinViewportCoverage'>,
  defaults: DefaultStyleSource,
): Promise<DomCapture> {
  const nodes: CapturedNode[] = [];
  const placeholders: CapturedPlaceholder[] = [];
  const warnings: CaptureWarning[] = [];
  const styles = new StyleTable();
  const counts: DomCapture['counts'] = {
    visited: 0,
    skipped: { 'ignored-tag': 0, 'display-none': 0, 'budget-truncated': 0 },
    hidden: 0,
    pseudoElements: 0,
    overlays: 0,
    shadowRoots: 0,
    closedShadowHosts: 0,
  };
  let truncated: DomCapture['truncated'] = null;

  const budget = new CaptureBudget(budgets, env.now);
  budget.start();
  const scroll = env.getScroll();
  const viewport = env.getViewport();
  const pageUrl = env.doc.baseURI;
  const maxText = budgets.maxTextLength;

  const capturePseudo = (el: Element, which: '::before' | '::after'): CapturedPseudo | undefined => {
    const computed = env.getComputedStyle(el, which);
    const content = computed.content;
    if (!content || content === 'none' || content === 'normal') return undefined;
    if (computed.display === 'none') return undefined;
    const pseudoDefaults = defaults.forPseudo();
    const style = pruneInvisibleDetails(
      diffStyles((p) => computed.getPropertyValue(p), STYLE_PROPERTIES, pseudoDefaults),
      pseudoDefaults,
    );
    counts.pseudoElements++;
    return { content: trimText(content, maxText), styleId: styles.intern(style) };
  };

  const root = env.doc.documentElement;
  const stack: Frame[] = root ? [{ el: root, parentId: null, depth: 0, ancestorOpacityZero: false }] : [];
  let sliceStart = env.now();

  while (stack.length > 0) {
    if (env.signal?.aborted) throw abortError();
    truncated = budget.check(nodes.length);
    if (truncated) {
      counts.skipped['budget-truncated'] += stack.length;
      break;
    }
    if (env.now() - sliceStart >= tuning.chunkTimeMs) {
      await env.yieldNow();
      if (env.signal?.aborted) throw abortError();
      sliceStart = env.now();
    }

    const frame = stack.pop() as Frame;
    const { el } = frame;
    counts.visited++;

    const tag = el.localName;
    if (isIgnoredTag(tag)) {
      counts.skipped['ignored-tag']++;
      continue;
    }

    const computed = env.getComputedStyle(el);
    const display = computed.display;
    if (display === 'none') {
      counts.skipped['display-none']++;
      continue;
    }

    const box = env.getRect(el);
    const rect: Rect = {
      x: round(box.left + scroll.x),
      y: round(box.top + scroll.y),
      width: round(box.width),
      height: round(box.height),
    };
    const verdict = classifyVisibility({
      display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      width: box.width,
      height: box.height,
      ancestorOpacityZero: frame.ancestorOpacityZero,
    });
    const hidden: HiddenReason | undefined = verdict.kind === 'hidden' ? verdict.reason : undefined;

    const id = nodes.length;
    const node: CapturedNode = {
      id,
      parentId: frame.parentId,
      childIds: [],
      depth: frame.depth,
      tag,
      rect,
      inShadow: isInShadow(el),
      styleId: null,
    };
    const attrs = collectAttributes((name) => el.getAttribute(name), pageUrl, maxText);
    if (attrs) node.attrs = attrs;
    const text = ownText(el, maxText);
    if (text) node.text = text;
    if (hidden) {
      node.hidden = hidden;
      counts.hidden++;
    } else {
      const elementDefaults = defaults.forElement(el);
      node.styleId = styles.intern(
        pruneInvisibleDetails(
          diffStyles((p) => computed.getPropertyValue(p), STYLE_PROPERTIES, elementDefaults),
          elementDefaults,
        ),
      );
      if (!NO_PSEUDO_TAGS.has(tag)) {
        const before = capturePseudo(el, '::before');
        const after = capturePseudo(el, '::after');
        if (before || after) {
          node.pseudo = {};
          if (before) node.pseudo.before = before;
          if (after) node.pseudo.after = after;
        }
      }
      const viewportRect: Rect = { ...rect, x: rect.x - scroll.x, y: rect.y - scroll.y };
      if (
        isPossibleOverlay(
          { position: computed.position, zIndex: computed.zIndex, viewportRect, viewport },
          tuning,
        )
      ) {
        node.possibleOverlay = true;
        counts.overlays++;
      }
    }

    nodes.push(node);
    if (frame.parentId !== null) (nodes[frame.parentId] as CapturedNode).childIds.push(id);

    if (tag === 'svg') {
      node.svg = true; // one node; children are not walked (assets come in Phase 5)
      continue;
    }
    if (PLACEHOLDER_TAGS.has(tag)) {
      node.placeholder = true;
      const rawSrc =
        (el as HTMLMediaElement).currentSrc || el.getAttribute('src') || el.getAttribute('data') || '';
      const src = rawSrc ? resolveUrl(rawSrc, pageUrl, maxText * 5) : null;
      placeholders.push({
        nodeId: id,
        tag,
        src,
        rect,
        sameOrigin: src === null ? null : isSameOrigin(src, pageUrl),
      });
      continue;
    }

    const shadow = env.getShadow(el);
    if (shadow?.kind === 'closed') {
      node.closedShadowHost = true;
      counts.closedShadowHosts++;
      continue;
    }
    if (shadow?.kind === 'open') {
      node.shadowHost = true;
      counts.shadowRoots++;
    }

    const children = childElements(el, shadow).filter((child) => !defaults.owns(child));
    const nextOpacityZero = frame.ancestorOpacityZero || hidden === 'opacity-0';
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        el: children[i] as Element,
        parentId: id,
        depth: frame.depth + 1,
        ancestorOpacityZero: nextOpacityZero,
      });
    }
  }

  if (defaults.problem) warnings.push({ code: 'default-styles-unavailable', message: defaults.problem });

  return {
    nodes,
    styleTable: styles.toArray(),
    placeholders,
    warnings,
    counts,
    truncated,
  };
}
