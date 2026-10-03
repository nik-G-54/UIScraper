import type { HiddenReason } from '../../shared/types';

/** Never captured, never descended into. Comments/text are not elements, so the walk never sees them. */
export const IGNORED_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
]);

/** Recorded as placeholders; their contents are not traversed in this phase. */
export const PLACEHOLDER_TAGS: ReadonlySet<string> = new Set(['iframe', 'canvas', 'video', 'embed', 'object']);

/** Elements that cannot generate ::before / ::after, so we skip those two style lookups. */
export const NO_PSEUDO_TAGS: ReadonlySet<string> = new Set([
  'img',
  'input',
  'textarea',
  'select',
  'br',
  'hr',
  'svg',
  ...PLACEHOLDER_TAGS,
]);

export const ATTRIBUTE_ALLOWLIST = [
  'id',
  'role',
  'aria-label',
  'href',
  'src',
  'srcset',
  'alt',
  'type',
  'placeholder',
  'title',
  'data-src',
] as const;

export function isIgnoredTag(tag: string): boolean {
  return IGNORED_TAGS.has(tag);
}

export type VisibilityVerdict =
  | { kind: 'display-none' }
  | { kind: 'visible' }
  | { kind: 'hidden'; reason: HiddenReason };

export interface VisibilityInput {
  display: string;
  visibility: string;
  opacity: string;
  /** Border-box size from the bounding rect. */
  width: number;
  height: number;
  /** True when an ancestor has opacity 0 (so this element cannot be seen either). */
  ancestorOpacityZero: boolean;
}

/**
 * Decide whether an element is skipped (`display: none`, along with its subtree), hidden
 * (kept as a node, but without styles) or visible. Only computed styles and geometry are used.
 */
export function classifyVisibility(input: VisibilityInput): VisibilityVerdict {
  if (input.display === 'none') return { kind: 'display-none' };
  if (input.visibility === 'hidden' || input.visibility === 'collapse') {
    return { kind: 'hidden', reason: 'visibility-hidden' };
  }
  if (Number.parseFloat(input.opacity) === 0) return { kind: 'hidden', reason: 'opacity-0' };
  if (input.ancestorOpacityZero) return { kind: 'hidden', reason: 'ancestor-opacity-0' };
  // `display: contents` generates no box, so a zero rect says nothing about it.
  if (input.display !== 'contents' && (input.width <= 0 || input.height <= 0)) {
    return { kind: 'hidden', reason: 'zero-size' };
  }
  return { kind: 'visible' };
}
