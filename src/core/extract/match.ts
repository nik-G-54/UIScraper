import type { SelectorMatches, SelectorMatchLimits } from '../../shared/types';

/**
 * Which captured nodes does each selector match? `scope.querySelectorAll` does the matching; the
 * element -> node id map turns the answer back into capture ids. Selectors that are invalid, target
 * pseudo-elements or match nothing are left out. Only the light DOM (no shadow roots) is searched.
 */
export function matchSelectors(
  scope: Pick<ParentNode, 'querySelectorAll'>,
  elements: ReadonlyMap<number, Element>,
  selectors: readonly string[],
  limits: SelectorMatchLimits,
): SelectorMatches {
  const idOf = new Map<Element, number>();
  for (const [id, el] of elements) idOf.set(el, id);

  const matches: SelectorMatches = {};
  const seen = new Set<string>();
  for (const selector of selectors) {
    if (seen.size >= limits.maxSelectors) break;
    if (selector === '' || seen.has(selector) || selector.includes('::')) continue;
    seen.add(selector);
    let found: ArrayLike<Element>;
    try {
      found = scope.querySelectorAll(selector);
    } catch {
      continue; // not valid in this document (vendor pseudo-classes, odd escapes...)
    }
    const ids: number[] = [];
    for (let i = 0; i < found.length && ids.length < limits.maxMatchesPerSelector; i++) {
      const id = idOf.get(found[i] as Element);
      if (id !== undefined) ids.push(id);
    }
    if (ids.length > 0) matches[selector] = ids;
  }
  return matches;
}
