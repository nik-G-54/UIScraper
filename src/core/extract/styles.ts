import type { StyleRecord } from '../../shared/types';

/**
 * Read `props` through `read` and keep only values that differ from `defaults`
 * (the browser's values for the same tag). Empty values (unsupported properties) are dropped.
 * Insertion order follows `props`, so equal styles always serialize identically.
 */
export function diffStyles(
  read: (property: string) => string,
  props: readonly string[],
  defaults: StyleRecord,
): StyleRecord {
  const style: StyleRecord = {};
  for (const property of props) {
    const value = read(property);
    if (value && value !== defaults[property]) style[property] = value;
  }
  return style;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * Drop values that cannot be seen: a border colour with no border, a text-decoration colour/style
 * with no decoration. "Effective" values fall back to the defaults, so a link that is underlined
 * by default keeps its decoration colour. Keeps equal-looking elements in one style-table entry.
 */
export function pruneInvisibleDetails(style: StyleRecord, defaults: StyleRecord): StyleRecord {
  const effective = (property: string) => style[property] ?? defaults[property];
  for (const side of SIDES) {
    const borderStyle = effective(`border-${side}-style`);
    if (borderStyle === 'none' || borderStyle === 'hidden') delete style[`border-${side}-color`];
  }
  if (effective('text-decoration-line') === 'none') {
    delete style['text-decoration-color'];
    delete style['text-decoration-style'];
  }
  return style;
}

/** Every property in `props`, no diffing. Used to learn the browser defaults. */
export function readAllStyles(read: (property: string) => string, props: readonly string[]): StyleRecord {
  const style: StyleRecord = {};
  for (const property of props) {
    const value = read(property);
    if (value) style[property] = value;
  }
  return style;
}

/** Interns identical style objects so nodes can reference them by index. */
export class StyleTable {
  private readonly ids = new Map<string, number>();
  private readonly styles: StyleRecord[] = [];

  intern(style: StyleRecord): number {
    const key = JSON.stringify(style);
    const existing = this.ids.get(key);
    if (existing !== undefined) return existing;
    const id = this.styles.length;
    this.ids.set(key, id);
    this.styles.push(style);
    return id;
  }

  get size(): number {
    return this.styles.length;
  }

  toArray(): StyleRecord[] {
    return this.styles;
  }
}
