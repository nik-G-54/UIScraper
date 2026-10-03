// Test fixture: build a CaptureResult from a short list of (tag, text, style) nodes.
import { validResult } from '../extract/fixtures';
import type { CaptureResult, CapturedNode, StyleRecord } from '../../shared/types';

export interface FixtureNode {
  tag: string;
  text?: string;
  style?: StyleRecord;
  attrs?: Record<string, string>;
  /** Width x height in px (default 100 x 20). */
  size?: [number, number];
}

export function captureOf(items: FixtureNode[]): CaptureResult {
  const base = validResult();
  const styleTable: StyleRecord[] = [];
  const nodes: CapturedNode[] = items.map((item, id) => {
    styleTable.push(item.style ?? {});
    const [width, height] = item.size ?? [100, 20];
    return {
      id,
      parentId: id === 0 ? null : 0,
      childIds: id === 0 ? items.slice(1).map((_, i) => i + 1) : [],
      depth: id === 0 ? 0 : 1,
      tag: item.tag,
      rect: { x: 0, y: 0, width, height },
      inShadow: false,
      styleId: id,
      ...(item.text ? { text: item.text } : {}),
      ...(item.attrs ? { attrs: item.attrs } : {}),
    };
  });
  return { ...base, nodes, styleTable, placeholders: [], warnings: [] };
}

/** `count` copies of the same node. */
export const repeat = (count: number, item: FixtureNode): FixtureNode[] => Array.from({ length: count }, () => item);
