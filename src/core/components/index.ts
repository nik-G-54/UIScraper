// Phase 4: layout + components. Pure functions only: capture + tokens in, sections and components out.
import type { CaptureResult, CssStateRule, DesignTokens, LayoutAnalysis, SelectorMatches } from '../../shared/types';
import { detectComponents } from './components';
import { detectSections } from './sections';
import { attachStates } from './states';
import { buildTailwindContext } from './tailwind';
import { buildTree } from './tree';

/** Sections and repeated components of one capture. States are added later by `addComponentStates`. */
export function analyzeLayout(capture: CaptureResult, tokens: DesignTokens): LayoutAnalysis {
  const tree = buildTree(capture);
  const ctx = buildTailwindContext(tokens);
  const sections = detectSections(tree, ctx);
  const warnings: LayoutAnalysis['warnings'] = [];
  if (sections.length === 0) {
    warnings.push({ code: 'no-sections', message: 'No page sections could be detected; the layout section will be empty.' });
  }
  const components = detectComponents(tree, sections, ctx);
  return { sections, components, warnings };
}

/** Attach hover/focus/active/disabled styles using the page's answer about which nodes each selector matches. */
export function addComponentStates(
  layout: LayoutAnalysis,
  capture: CaptureResult,
  tokens: DesignTokens,
  rules: readonly CssStateRule[],
  matches: SelectorMatches,
): LayoutAnalysis {
  return {
    ...layout,
    components: attachStates(layout.components, buildTree(capture), rules, matches, buildTailwindContext(tokens)),
  };
}

export { classifyComponent, detectComponents, outline } from './components';
export { findSectionRoots, detectSections, sectionOfNode, summarizeLayout } from './sections';
export { computeStructureHashes } from './structure';
export { stateSelectors } from './states';
export { buildTailwindContext, declarationsToTailwind, styleToTailwind, DEFAULT_TAILWIND_CONTEXT } from './tailwind';
export type { TailwindContext } from './tailwind';
export { buildTree } from './tree';
export type { Tree } from './tree';
