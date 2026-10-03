import { hashNumbers } from '../../shared/hash';
import type { CapturedNode } from '../../shared/types';
import type { Tree } from './tree';

/** More children than this are folded into a count, so a 500-item list hashes like a 400-item one. */
const MAX_HASHED_CHILDREN = 24;

export interface StructureHashes {
  /** Tags and child structure only: same shape = same value, whatever the colours. */
  structure: Uint32Array;
  /** Shape plus every node's style id: same shape AND same look. */
  look: Uint32Array;
}

/**
 * Structural hash of the subtree of every node, `depth` levels deep: tags, whether a node has
 * text, and child structure (and, for `look`, style ids). Class names are never read (they may be
 * hashed by CSS-in-JS). Hidden children do not count. Linear in nodes x depth.
 */
export function computeStructureHashes(tree: Tree, depth: number): StructureHashes {
  const { nodes } = tree;
  const tagIds = new Map<string, number>();
  const tagId = (tag: string): number => {
    let id = tagIds.get(tag);
    if (id === undefined) tagIds.set(tag, (id = tagIds.size + 1));
    return id;
  };
  const own = (node: CapturedNode): number => tagId(node.tag) * 4 + (node.text ? 1 : 0) + (node.svg ? 2 : 0);

  let structure = new Uint32Array(nodes.length);
  let look = new Uint32Array(nodes.length);
  for (const node of nodes) {
    structure[node.id] = hashNumbers([own(node)]);
    look[node.id] = hashNumbers([own(node), (node.styleId ?? -1) + 1]);
  }
  for (let level = 1; level <= depth; level++) {
    const nextStructure = new Uint32Array(nodes.length);
    const nextLook = new Uint32Array(nodes.length);
    for (const node of nodes) {
      const kids = tree.visibleChildren(node);
      const shown = kids.length > MAX_HASHED_CHILDREN ? kids.slice(0, MAX_HASHED_CHILDREN) : kids;
      const extra = kids.length > MAX_HASHED_CHILDREN ? [kids.length] : [];
      nextStructure[node.id] = hashNumbers([own(node), ...shown.map((k) => structure[k.id] as number), ...extra]);
      nextLook[node.id] = hashNumbers([own(node), (node.styleId ?? -1) + 1, ...shown.map((k) => look[k.id] as number), ...extra]);
    }
    structure = nextStructure;
    look = nextLook;
  }
  return { structure, look };
}
