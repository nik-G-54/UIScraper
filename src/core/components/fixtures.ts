// Test fixture: build a CaptureResult from a nested description of the page.
import { validResult } from '../extract/fixtures';
import type { CaptureResult, CapturedNode, Rect, StyleRecord } from '../../shared/types';

export interface Box {
  tag: string;
  /** x, y, width, height in document px (default 0, 0, 100, 20). */
  rect?: [number, number, number, number];
  style?: StyleRecord;
  text?: string;
  attrs?: Record<string, string>;
  children?: Box[];
}

/** Pre-order ids, interned styles, `width` as the capture width. */
export function pageOf(root: Box, width = 1440, viewportHeight = 800): CaptureResult {
  const base = validResult();
  const nodes: CapturedNode[] = [];
  const styleTable: StyleRecord[] = [];
  const styleIds = new Map<string, number>();
  const intern = (style: StyleRecord): number => {
    const key = JSON.stringify(style);
    let id = styleIds.get(key);
    if (id === undefined) {
      id = styleTable.length;
      styleTable.push(style);
      styleIds.set(key, id);
    }
    return id;
  };

  const visit = (box: Box, parentId: number | null, depth: number): number => {
    const id = nodes.length;
    const [x, y, w, h] = box.rect ?? [0, 0, 100, 20];
    const rect: Rect = { x, y, width: w, height: h };
    const node: CapturedNode = {
      id,
      parentId,
      childIds: [],
      depth,
      tag: box.tag,
      rect,
      inShadow: false,
      styleId: intern(box.style ?? {}),
      ...(box.text ? { text: box.text } : {}),
      ...(box.attrs ? { attrs: box.attrs } : {}),
      ...(box.tag === 'svg' ? { svg: true as const } : {}),
    };
    nodes.push(node);
    for (const child of box.children ?? []) node.childIds.push(visit(child, id, depth + 1));
    return id;
  };
  visit(root, null, 0);

  return {
    ...base,
    meta: { ...base.meta, viewportWidth: width, captureWidth: width, viewportHeight, documentWidth: width },
    nodes,
    styleTable,
    placeholders: [],
    warnings: [],
  };
}
