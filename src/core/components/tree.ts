import type { CaptureResult, CapturedNode, StyleRecord } from '../../shared/types';

/**
 * Read-only helpers over a capture's node tree. Ids are assigned in pre-order, so the subtree of
 * node `i` is exactly the id range `[i, i + span[i])`.
 */
export interface Tree {
  capture: CaptureResult;
  nodes: readonly CapturedNode[];
  /** Page width (CSS px) the capture was rendered at. */
  pageWidth: number;
  viewportHeight: number;
  /** Number of captured nodes in each subtree, itself included. */
  span: Uint32Array;
  /** Number of VISIBLE nodes in each subtree, itself included (0 when the node itself is hidden). */
  visibleSize: Uint32Array;
  style(node: CapturedNode): StyleRecord;
  isVisible(node: CapturedNode): boolean;
  visibleChildren(node: CapturedNode): CapturedNode[];
  isInside(ancestorId: number, nodeId: number): boolean;
  /** First ancestor (not the node itself) for which `test` holds. */
  findAncestor(node: CapturedNode, test: (ancestor: CapturedNode) => boolean): CapturedNode | null;
  /** Descendants (not the node itself) in document order. */
  descendants(node: CapturedNode): CapturedNode[];
}

const EMPTY: StyleRecord = {};

export function buildTree(capture: CaptureResult): Tree {
  const nodes = capture.nodes;
  const span = new Uint32Array(nodes.length);
  const visibleSize = new Uint32Array(nodes.length);
  const style = (node: CapturedNode): StyleRecord => (node.styleId === null ? EMPTY : (capture.styleTable[node.styleId] ?? EMPTY));
  const isVisible = (node: CapturedNode) => node.styleId !== null && node.rect.width > 0 && node.rect.height > 0;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i] as CapturedNode;
    let total = 1;
    let visible = isVisible(node) ? 1 : 0;
    for (const childId of node.childIds) {
      total += span[childId] as number;
      visible += visibleSize[childId] as number;
    }
    span[i] = total;
    visibleSize[i] = isVisible(node) ? visible : 0;
  }

  return {
    capture,
    nodes,
    pageWidth: Math.max(1, capture.meta.captureWidth || capture.meta.viewportWidth),
    viewportHeight: Math.max(1, capture.meta.viewportHeight),
    span,
    visibleSize,
    style,
    isVisible,
    visibleChildren: (node) => node.childIds.map((id) => nodes[id] as CapturedNode).filter(isVisible),
    isInside: (ancestorId, nodeId) => nodeId > ancestorId && nodeId < ancestorId + (span[ancestorId] ?? 0),
    findAncestor: (node, test) => {
      for (let parent = node.parentId; parent !== null; ) {
        const candidate = nodes[parent] as CapturedNode;
        if (test(candidate)) return candidate;
        parent = candidate.parentId;
      }
      return null;
    },
    descendants: (node) => nodes.slice(node.id + 1, node.id + (span[node.id] ?? 1)),
  };
}
