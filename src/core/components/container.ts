import type { CapturedNode } from '../../shared/types';
import type { Tree } from './tree';

/**
 * The content container of a block: the first flex/grid node on the way down through
 * single-child wrappers. `chain` holds every wrapper visited, the block first.
 */
export function findContainer(tree: Tree, block: CapturedNode): { chain: CapturedNode[]; container: CapturedNode } {
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
  return { chain, container };
}
