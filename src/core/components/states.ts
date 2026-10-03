import { LAYOUT_TUNING } from '../../shared/config';
import type { ComponentGroup, ComponentState, CssState, CssStateRule, SelectorMatches } from '../../shared/types';
import { declarationsToTailwind } from './tailwind';
import type { TailwindContext } from './tailwind';
import type { Tree } from './tree';

/** Declarations that say nothing about how the state looks. */
const IGNORED = /^(transition|animation|will-change|pointer-events|content|--)/;
/** How many levels above a matched node a component root is looked for. */
const MAX_CLIMB = 4;

/** The base selectors worth asking the page about: those of state rules outside media queries. */
export function stateSelectors(rules: readonly CssStateRule[]): string[] {
  return [...new Set(rules.filter((r) => r.media === null && r.selector.trim() !== '').map((r) => r.selector))];
}

/**
 * Attach hover/focus/active/disabled styles to components. `matches` says which captured nodes each
 * rule's base selector matches (answered by the page). A rule counts for a component when it
 * matches a member, or something inside a member (then it is marked `onDescendant`).
 */
export function attachStates(
  components: readonly ComponentGroup[],
  tree: Tree,
  rules: readonly CssStateRule[],
  matches: SelectorMatches,
  ctx: TailwindContext,
): ComponentGroup[] {
  const owner = new Map<number, number>();
  components.forEach((component, index) => {
    for (const id of component.members) owner.set(id, index);
  });

  // component index -> `${state}|${onDescendant}` -> merged declarations (first rule wins per property)
  const found = new Map<number, Map<string, { state: CssState; onDescendant: boolean; declarations: Record<string, string> }>>();
  for (const rule of rules) {
    if (rule.media !== null) continue;
    const ids = matches[rule.selector];
    if (!ids) continue;
    const declarations = Object.fromEntries(Object.entries(rule.declarations).filter(([property]) => !IGNORED.test(property)));
    if (Object.keys(declarations).length === 0) continue;
    for (const id of ids) {
      let componentIndex = owner.get(id);
      let onDescendant = false;
      if (componentIndex === undefined) {
        let node = tree.nodes[id];
        for (let climbed = 0; node && climbed < MAX_CLIMB && componentIndex === undefined; climbed++) {
          node = node.parentId === null ? undefined : tree.nodes[node.parentId];
          if (node) componentIndex = owner.get(node.id);
        }
        onDescendant = true;
      }
      if (componentIndex === undefined) continue;
      const perComponent = found.get(componentIndex) ?? new Map();
      found.set(componentIndex, perComponent);
      const key = `${rule.state}|${onDescendant}`;
      const entry = perComponent.get(key) ?? { state: rule.state, onDescendant, declarations: {} };
      perComponent.set(key, entry);
      for (const [property, value] of Object.entries(declarations)) entry.declarations[property] ??= value;
    }
  }

  return components.map((component, index) => {
    const entries = found.get(index);
    if (!entries) return component;
    const states: ComponentState[] = [...entries.values()]
      .sort((a, b) => Number(a.onDescendant) - Number(b.onDescendant))
      .slice(0, 6)
      .map((entry) => {
        const declarations = Object.fromEntries(Object.entries(entry.declarations).slice(0, LAYOUT_TUNING.maxStateDeclarations));
        const prefix = entry.onDescendant ? `group-${entry.state}:` : `${entry.state}:`;
        return {
          state: entry.state,
          declarations,
          tailwind: declarationsToTailwind(declarations, prefix, ctx).join(' '),
          onDescendant: entry.onDescendant,
        };
      });
    return { ...component, states };
  });
}
