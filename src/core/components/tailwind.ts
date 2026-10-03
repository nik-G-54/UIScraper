import type { DesignTokens, StyleRecord } from '../../shared/types';
import { colorDistance, normalizeColor } from '../tokens/color';
import { fontNames, radiusNames, shadowNames, baseFontSize, colorNames, typeScaleNames } from '../tokens/theme';
import { parsePx, splitTopLevel } from '../tokens/util';

/**
 * Style record -> Tailwind v4 utility classes. Names follow the generated theme.css when a context
 * is given (so `rounded-lg` means what theme.css says), else Tailwind's defaults. Anything that has
 * no utility becomes an arbitrary value such as `p-[13px]`. Pure.
 */
export interface TailwindContext {
  /** Pixels per spacing step: `p-2` = 2 x this. Tailwind's default is 4. */
  spacingUnitPx: number;
  colors: { hex: string; name: string }[];
  fontSizes: ReadonlyMap<number, string>;
  radii: ReadonlyMap<number, string>;
  shadows: ReadonlyMap<string, string>;
  /** First family name (lowercase) -> `font-<name>`. */
  fontFamilies: ReadonlyMap<string, string>;
}

const DEFAULT_FONT_SIZES = new Map<number, string>([
  [12, 'xs'], [14, 'sm'], [16, 'base'], [18, 'lg'], [20, 'xl'], [24, '2xl'], [30, '3xl'], [36, '4xl'],
  [48, '5xl'], [60, '6xl'], [72, '7xl'], [96, '8xl'], [128, '9xl'],
]);
const DEFAULT_RADII = new Map<number, string>([[2, 'xs'], [4, 'sm'], [6, 'md'], [8, 'lg'], [12, 'xl'], [16, '2xl'], [24, '3xl'], [32, '4xl']]);

export const DEFAULT_TAILWIND_CONTEXT: TailwindContext = {
  spacingUnitPx: 4,
  colors: [],
  fontSizes: DEFAULT_FONT_SIZES,
  radii: DEFAULT_RADII,
  shadows: new Map(),
  fontFamilies: new Map(),
};

/** Names used by the generated theme.css, so classes in design.md agree with it. */
export function buildTailwindContext(tokens: DesignTokens): TailwindContext {
  const names = colorNames(tokens.colors);
  const fontSizes = new Map<number, string>();
  for (const step of typeScaleNames(tokens.typography.sizes, baseFontSize(tokens))) fontSizes.set(step.px, step.name);
  const radii = new Map<number, string>();
  for (const r of radiusNames(tokens)) {
    if (r.name === 'full') continue;
    const rem = /^([\d.]+)rem$/.exec(r.value);
    if (rem) radii.set(Math.round(Number(rem[1]) * 16 * 100) / 100, r.name);
  }
  const shadows = new Map<string, string>();
  for (const s of shadowNames(tokens)) shadows.set(s.value.replace(/\s+/g, ' ').trim(), s.name);
  const fontFamilies = new Map<string, string>();
  for (const font of fontNames(tokens)) {
    const family = tokens.typography.families.find((f) => f.stack === font.value);
    if (family) fontFamilies.set(family.name.toLowerCase(), font.name);
  }
  return {
    spacingUnitPx: tokens.spacing.baseUnit ?? 4,
    colors: tokens.colors.map((c, i) => ({ hex: c.hex, name: names[i] ?? c.hex })),
    fontSizes: fontSizes.size > 0 ? fontSizes : DEFAULT_FONT_SIZES,
    radii: radii.size > 0 ? radii : DEFAULT_RADII,
    shadows,
    fontFamilies,
  };
}

export interface TailwindOptions {
  /** Font size used for line-height ratios and `em` letter spacing when the style has none (px). */
  fontSizePx?: number;
}

const num = (n: number): string => String(Number(n.toFixed(2)));
const underscored = (value: string): string => value.replace(/\s+/g, '_');

function spacingClass(prefix: string, value: string | undefined, ctx: TailwindContext): string | null {
  if (value === undefined) return null;
  if (value === 'auto') return `${prefix}-auto`;
  const n = parsePx(value);
  if (n === null) return null;
  if (n === 0) return `${prefix}-0`;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs === 1) return `${sign}${prefix}-px`;
  const steps = abs / ctx.spacingUnitPx;
  if (Math.abs(steps * 2 - Math.round(steps * 2)) < 0.02) return `${sign}${prefix}-${num(Math.round(steps * 2) / 2)}`;
  return `${sign}${prefix}-[${num(abs)}px]`;
}

/** `p-4` / `px-2 py-1` / `pt-1 pr-2 ...` for four sides in top, right, bottom, left order. */
function boxClasses(
  prefix: string,
  sides: readonly [string, string, string, string],
  values: readonly (string | undefined)[],
  ctx: TailwindContext,
  zeroIsDefault: boolean,
): string[] {
  const [t, r, b, l] = values;
  if (t === undefined && r === undefined && b === undefined && l === undefined) return [];
  const out: string[] = [];
  const add = (p: string, v: string | undefined) => {
    const cls = spacingClass(p, v, ctx);
    if (cls && !(zeroIsDefault && v === '0px')) out.push(cls);
  };
  if (t !== undefined && t === r && r === b && b === l) {
    add(prefix, t);
    return out;
  }
  const x = r !== undefined && r === l;
  const y = t !== undefined && t === b;
  if (x) add(`${prefix}x`, r);
  if (y) add(`${prefix}y`, t);
  if (!y) {
    add(`${prefix}${sides[0]}`, t);
    add(`${prefix}${sides[2]}`, b);
  }
  if (!x) {
    add(`${prefix}${sides[1]}`, r);
    add(`${prefix}${sides[3]}`, l);
  }
  return out;
}

function colorClass(prefix: string, raw: string | undefined, ctx: TailwindContext): string | null {
  if (raw === undefined) return null;
  if (/^var\(/i.test(raw.trim())) return `${prefix}-[${underscored(raw.trim())}]`;
  const hex = normalizeColor(raw);
  if (!hex) return null;
  let best: { name: string; distance: number } | null = null;
  for (const c of ctx.colors) {
    if (c.hex.length !== hex.length) continue;
    const distance = c.hex === hex ? 0 : colorDistance(c.hex, hex);
    if (distance <= 1.5 && (!best || distance < best.distance)) best = { name: c.name, distance };
  }
  return best ? `${prefix}-${best.name}` : `${prefix}-[${hex}]`;
}

const DISPLAY: Record<string, string> = {
  block: 'block', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid',
  'inline-block': 'inline-block', inline: 'inline', none: 'hidden', contents: 'contents', 'flow-root': 'flow-root',
  table: 'table', 'list-item': 'list-item',
};
const JUSTIFY: Record<string, string> = {
  'flex-start': 'justify-start', start: 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', end: 'justify-end',
  'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly',
};
const ITEMS: Record<string, string> = {
  center: 'items-center', 'flex-start': 'items-start', start: 'items-start', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline',
};
const SELF: Record<string, string> = {
  center: 'self-center', 'flex-start': 'self-start', start: 'self-start', 'flex-end': 'self-end', end: 'self-end', stretch: 'self-stretch',
};
const WEIGHTS: Record<string, string> = {
  '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black',
};
const LEADING: [number, string][] = [[1, 'none'], [1.25, 'tight'], [1.375, 'snug'], [1.5, 'normal'], [1.625, 'relaxed'], [2, 'loose']];
const TRACKING: [number, string][] = [[-0.05, 'tighter'], [-0.025, 'tight'], [0.025, 'wide'], [0.05, 'wider'], [0.1, 'widest']];
const MAX_WIDTH: [number, string][] = [
  [384, 'sm'], [448, 'md'], [512, 'lg'], [576, 'xl'], [672, '2xl'], [768, '3xl'], [896, '4xl'], [1024, '5xl'], [1152, '6xl'], [1280, '7xl'],
];
const DURATIONS = new Set([75, 100, 150, 200, 300, 500, 700, 1000]);
const COLOR_TRANSITIONS = new Set(['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke', 'outline-color']);

const seconds = (value: string): number | null => {
  const m = /^(-?\d*\.?\d+)(ms|s)$/.exec(value.trim());
  return m ? Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1)) : null;
};

function nearest(table: [number, string][], value: number, tolerance: number): string | null {
  for (const [v, name] of table) if (Math.abs(v - value) <= tolerance) return name;
  return null;
}

function layoutClasses(s: StyleRecord, ctx: TailwindContext): string[] {
  const out: string[] = [];
  const display = s.display;
  if (display !== undefined && DISPLAY[display]) out.push(DISPLAY[display] as string);
  if (s.position && s.position !== 'static') out.push(s.position);
  if (s.position && s.position !== 'static') {
    // Offsets only move a positioned box. On a relative box a 0px/auto offset changes nothing, and
    // static boxes ignore offsets altogether (handled by the guard above).
    const relative = s.position === 'relative';
    const { top, right, bottom, left } = s;
    if (!relative && top === '0px' && right === '0px' && bottom === '0px' && left === '0px') out.push('inset-0');
    else {
      for (const [prefix, value] of [['top', top], ['right', right], ['bottom', bottom], ['left', left]] as const) {
        if (!value || value === 'auto' || (relative && parsePx(value) === 0)) continue;
        const cls = spacingClass(prefix, value, ctx);
        if (cls) out.push(cls);
      }
    }
  }
  if (s['z-index'] && s['z-index'] !== 'auto') {
    out.push(['0', '10', '20', '30', '40', '50'].includes(s['z-index']) ? `z-${s['z-index']}` : `z-[${s['z-index']}]`);
  }
  const ox = s['overflow-x'];
  const oy = s['overflow-y'];
  if (ox !== undefined && ox === oy) out.push(`overflow-${ox === 'auto' ? 'auto' : ox}`);
  else {
    if (ox) out.push(`overflow-x-${ox}`);
    if (oy) out.push(`overflow-y-${oy}`);
  }
  if (s['flex-direction'] === 'column') out.push('flex-col');
  else if (s['flex-direction'] === 'row-reverse') out.push('flex-row-reverse');
  else if (s['flex-direction'] === 'column-reverse') out.push('flex-col-reverse');
  if (s['flex-wrap'] === 'wrap') out.push('flex-wrap');
  else if (s['flex-wrap'] === 'wrap-reverse') out.push('flex-wrap-reverse');
  if (s['flex-grow'] && s['flex-grow'] !== '0') out.push(s['flex-grow'] === '1' ? 'grow' : `grow-[${s['flex-grow']}]`);
  if (s['flex-shrink'] === '0') out.push('shrink-0');
  if (s['justify-content'] && JUSTIFY[s['justify-content']]) out.push(JUSTIFY[s['justify-content']] as string);
  if (s['align-items'] && ITEMS[s['align-items']]) out.push(ITEMS[s['align-items']] as string);
  if (s['align-self'] && SELF[s['align-self']]) out.push(SELF[s['align-self']] as string);
  const rowGap = s['row-gap'];
  const colGap = s['column-gap'];
  if (rowGap !== undefined && rowGap === colGap) {
    const cls = spacingClass('gap', rowGap, ctx);
    if (cls) out.push(cls);
  } else {
    const gx = spacingClass('gap-x', colGap, ctx);
    const gy = spacingClass('gap-y', rowGap, ctx);
    if (gx) out.push(gx);
    if (gy) out.push(gy);
  }
  const columns = s['grid-template-columns'];
  if (columns && columns !== 'none') {
    const tracks = splitTopLevel(columns.replace(/\s+/g, ' '), ' ');
    if (tracks.length > 0 && tracks.every((t) => t === tracks[0]) && tracks.length <= 12) out.push(`grid-cols-${tracks.length}`);
    else out.push(`grid-cols-[${underscored(columns.trim())}]`);
  }
  return out;
}

function sizeClasses(s: StyleRecord): string[] {
  const out: string[] = [];
  const maxW = s['max-width'];
  if (maxW && maxW !== 'none') {
    const n = parsePx(maxW);
    if (maxW === '100%') out.push('max-w-full');
    else if (n !== null) out.push(`max-w-${nearest(MAX_WIDTH, n, 0.5) ?? `[${num(n)}px]`}`);
  }
  const minW = s['min-width'];
  if (minW && minW !== 'auto' && parsePx(minW) !== 0) out.push(`min-w-[${underscored(minW)}]`);
  const minH = s['min-height'];
  if (minH && minH !== 'auto' && parsePx(minH) !== 0) out.push(`min-h-[${underscored(minH)}]`);
  const maxH = s['max-height'];
  if (maxH && maxH !== 'none') out.push(`max-h-[${underscored(maxH)}]`);
  const ratio = s['aspect-ratio'];
  if (ratio && ratio !== 'auto') {
    const clean = ratio.replace(/\s+/g, '');
    out.push(clean === '16/9' ? 'aspect-video' : clean === '1/1' ? 'aspect-square' : `aspect-[${clean}]`);
  }
  return out;
}

function typographyClasses(s: StyleRecord, ctx: TailwindContext, opts: TailwindOptions): string[] {
  const out: string[] = [];
  const family = s['font-family'];
  if (family) {
    const first = (family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
    const name = ctx.fontFamilies.get(first.toLowerCase());
    if (name) out.push(`font-${name}`);
    else if (first) out.push(`font-[family-name:${underscored(first)}]`);
  }
  const size = parsePx(s['font-size']);
  if (size !== null) out.push(`text-${ctx.fontSizes.get(Math.round(size * 100) / 100) ?? `[${num(size)}px]`}`);
  const weight = s['font-weight'];
  if (weight) out.push(WEIGHTS[weight] ? `font-${WEIGHTS[weight]}` : `font-[${weight}]`);
  if (s['font-style'] === 'italic') out.push('italic');
  const fs = size ?? opts.fontSizePx ?? 16;
  const lineHeight = s['line-height'];
  if (lineHeight && lineHeight !== 'normal') {
    const lh = parsePx(lineHeight);
    if (lh !== null && fs > 0) out.push(`leading-${nearest(LEADING, lh / fs, 0.01) ?? `[${num(lh / fs)}]`}`);
  }
  const tracking = s['letter-spacing'];
  if (tracking && tracking !== 'normal') {
    const t = parsePx(tracking);
    if (t !== null && t !== 0 && fs > 0) out.push(`tracking-${nearest(TRACKING, t / fs, 0.004) ?? `[${num(t)}px]`}`);
  }
  const align = s['text-align'];
  if (align && ['center', 'right', 'justify', 'left'].includes(align)) out.push(`text-${align}`);
  const transform = s['text-transform'];
  if (transform && transform !== 'none') out.push(transform);
  const decoration = s['text-decoration-line'];
  if (decoration === 'underline') out.push('underline');
  else if (decoration === 'line-through') out.push('line-through');
  else if (decoration === 'none') out.push('no-underline');
  const space = s['white-space'];
  if (space === 'nowrap') out.push('whitespace-nowrap');
  else if (space === 'pre' || space === 'pre-wrap' || space === 'pre-line') out.push(`whitespace-${space}`);
  if (s['text-overflow'] === 'ellipsis') out.push('text-ellipsis');
  if (s['list-style-type'] === 'none') out.push('list-none');
  const fill = s['-webkit-text-fill-color'];
  if (fill !== undefined && normalizeColor(fill) === null) out.push('text-transparent');
  else {
    const color = colorClass('text', fill ?? s.color, ctx);
    if (color) out.push(color);
  }
  return out;
}

function backgroundClasses(s: StyleRecord, ctx: TailwindContext): string[] {
  const out: string[] = [];
  const bg = colorClass('bg', s['background-color'], ctx);
  if (bg) out.push(bg);
  const image = s['background-image'];
  if (image && image !== 'none') {
    const gradient = splitTopLevel(image, ',').find((layer) => /gradient\(/i.test(layer));
    if (gradient) out.push(`bg-[image:${underscored(gradient)}]`);
    if (/url\(/i.test(image)) {
      if (s['background-size'] === 'cover') out.push('bg-cover');
      else if (s['background-size'] === 'contain') out.push('bg-contain');
      if (s['background-position'] === '50% 50%') out.push('bg-center');
      if (s['background-repeat'] === 'no-repeat') out.push('bg-no-repeat');
    }
  }
  return out;
}

function borderClasses(s: StyleRecord, ctx: TailwindContext): string[] {
  const out: string[] = [];
  const widths = ['top', 'right', 'bottom', 'left'].map((side) => s[`border-${side}-width`]);
  if (widths.some((w) => w !== undefined)) {
    const px = widths.map((w) => (w === undefined ? 0 : (parsePx(w) ?? 0)));
    const width = (n: number) => (n === 1 ? '' : n === 2 || n === 4 || n === 8 ? `-${n}` : `-[${num(n)}px]`);
    if (px.every((n) => n === px[0])) {
      if ((px[0] as number) > 0) out.push(`border${width(px[0] as number)}`);
    } else {
      (['t', 'r', 'b', 'l'] as const).forEach((side, i) => {
        const n = px[i] as number;
        if (n > 0) out.push(`border-${side}${width(n)}`);
      });
    }
  }
  const styles = new Set(['top', 'right', 'bottom', 'left'].map((side) => s[`border-${side}-style`]).filter((v) => v && v !== 'none' && v !== 'solid'));
  for (const style of styles) out.push(`border-${style}`);
  const colors = ['top', 'right', 'bottom', 'left'].map((side) => s[`border-${side}-color`]).filter((v): v is string => v !== undefined);
  if (colors.length > 0) {
    const unique = [...new Set(colors)];
    const cls = colorClass('border', unique[0], ctx);
    if (cls) out.push(cls);
  }

  const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => s[`border-${c}-radius`]);
  if (corners.some((c) => c !== undefined)) {
    const radius = (value: string | undefined, prefix: string): string | null => {
      if (value === undefined) return null;
      const first = value.trim().split(/\s+/)[0] ?? '';
      if (first === '50%') return `${prefix}-full`;
      const n = parsePx(first);
      if (n === null) return `${prefix}-[${first}]`;
      if (n === 0) return null;
      if (n >= 9999) return `${prefix}-full`;
      const named = ctx.radii.get(Math.round(n * 100) / 100);
      return named ? `${prefix}-${named}` : `${prefix}-[${num(n)}px]`;
    };
    if (corners.every((c) => c === corners[0])) {
      const cls = radius(corners[0], 'rounded');
      if (cls) out.push(cls);
    } else {
      (['tl', 'tr', 'br', 'bl'] as const).forEach((corner, i) => {
        const cls = radius(corners[i], `rounded-${corner}`);
        if (cls) out.push(cls);
      });
    }
  }
  return out;
}

function effectClasses(s: StyleRecord, ctx: TailwindContext): string[] {
  const out: string[] = [];
  const shadow = s['box-shadow'];
  if (shadow && shadow !== 'none') {
    const key = shadow.replace(/\s+/g, ' ').trim();
    const named = ctx.shadows.get(key);
    out.push(named ? `shadow-${named}` : `shadow-[${underscored(key)}]`);
  }
  if (s['background-clip'] === 'text') out.push('bg-clip-text');
  const blend = s['mix-blend-mode'];
  if (blend && blend !== 'normal') out.push(`mix-blend-${blend}`);
  const opacity = s.opacity;
  if (opacity !== undefined && opacity !== '1') {
    const pct = Math.round(Number(opacity) * 100);
    out.push(Number.isFinite(pct) ? (pct % 5 === 0 ? `opacity-${pct}` : `opacity-[${opacity}]`) : `opacity-[${opacity}]`);
  }
  const backdrop = /blur\(([\d.]+px)\)/.exec(s['backdrop-filter'] ?? '');
  if (backdrop) out.push(`backdrop-blur-[${backdrop[1]}]`);
  const blur = /blur\(([\d.]+px)\)/.exec(s.filter ?? '');
  if (blur) out.push(`blur-[${blur[1]}]`);
  if (s.cursor && ['pointer', 'not-allowed', 'grab', 'move', 'wait', 'text', 'crosshair'].includes(s.cursor)) out.push(`cursor-${s.cursor}`);
  if (s['object-fit'] && ['cover', 'contain', 'fill', 'none', 'scale-down'].includes(s['object-fit'])) out.push(`object-${s['object-fit']}`);

  const durations = (s['transition-duration'] ?? '').split(',').map((d) => seconds(d) ?? 0);
  if (durations.some((d) => d > 0)) {
    const props = splitTopLevel(s['transition-property'] ?? 'all', ',');
    if (props.includes('all')) out.push('transition-all');
    else if (props.length > 0 && props.every((p) => COLOR_TRANSITIONS.has(p))) out.push('transition-colors');
    else if (props.length === 1 && props[0] === 'opacity') out.push('transition-opacity');
    else if (props.length === 1 && props[0] === 'transform') out.push('transition-transform');
    else if (props.length === 1 && props[0] === 'box-shadow') out.push('transition-shadow');
    else out.push(`transition-[${props.join(',')}]`);
    const ms = Math.max(...durations);
    out.push(DURATIONS.has(ms) ? `duration-${ms}` : `duration-[${ms}ms]`);
    const timing = s['transition-timing-function'];
    const first = splitTopLevel(timing ?? '', ',')[0];
    if (first && first !== 'ease') {
      if (first === 'ease-in-out' || first === 'ease-in' || first === 'ease-out' || first === 'linear') out.push(first === 'linear' ? 'ease-linear' : `ease-${first.slice(5)}`);
      else out.push(`ease-[${underscored(first)}]`);
    }
    const delay = seconds(splitTopLevel(s['transition-delay'] ?? '', ',')[0] ?? '');
    if (delay) out.push(DURATIONS.has(delay) ? `delay-${delay}` : `delay-[${delay}ms]`);
  }
  return out;
}

/** Tailwind classes for one computed-style record (properties at their browser default are absent). */
export function styleToTailwind(style: StyleRecord, ctx: TailwindContext = DEFAULT_TAILWIND_CONTEXT, opts: TailwindOptions = {}): string[] {
  const sides = ['t', 'r', 'b', 'l'] as const;
  const read = (prefix: string) => ['top', 'right', 'bottom', 'left'].map((side) => style[`${prefix}-${side}`]);
  const classes = [
    ...layoutClasses(style, ctx),
    ...boxClasses('m', sides, read('margin'), ctx, true),
    ...boxClasses('p', sides, read('padding'), ctx, true),
    ...sizeClasses(style),
    ...typographyClasses(style, ctx, opts),
    ...backgroundClasses(style, ctx),
    ...borderClasses(style, ctx),
    ...effectClasses(style, ctx),
  ];
  return [...new Set(classes)];
}

/** `translateY(-2px)` / `scale(1.05)` as utilities; anything else as an arbitrary property. */
function transformClasses(value: string, ctx: TailwindContext): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/(translate[XY]?|scale)\(([^)]*)\)/g)) {
    const fn = m[1] as string;
    const args = (m[2] as string).split(',').map((a) => a.trim());
    if (fn === 'scale') {
      const n = Number(args[0]);
      out.push(Number.isFinite(n) ? (Math.round(n * 100) % 5 === 0 ? `scale-${Math.round(n * 100)}` : `scale-[${n}]`) : `scale-[${args[0]}]`);
    } else {
      const axes = fn === 'translate' ? ['x', 'y'] : [fn.slice(-1).toLowerCase()];
      axes.forEach((axis, i) => {
        const cls = spacingClass(`translate-${axis}`, args[i] ?? (fn === 'translate' ? '0px' : undefined), ctx);
        if (cls) out.push(cls);
      });
    }
  }
  return out.length > 0 ? out : [`[transform:${underscored(value)}]`];
}

/** Turn raw CSS declarations (a `:hover` rule, say) into prefixed classes such as `hover:bg-primary`. */
export function declarationsToTailwind(
  declarations: Record<string, string>,
  prefix: string,
  ctx: TailwindContext = DEFAULT_TAILWIND_CONTEXT,
): string[] {
  const record: StyleRecord = {};
  const extra: string[] = [];
  for (const [property, raw] of Object.entries(declarations)) {
    const value = raw.replace(/\s*!important\s*$/i, '').trim();
    if (value === '' || property.startsWith('--')) continue;
    switch (property) {
      case 'background':
        if (/gradient\(/i.test(value)) record['background-image'] = value;
        else {
          const color = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|var\([^)]*\)/i.exec(value);
          if (color) record['background-color'] = color[0];
        }
        break;
      case 'border-color':
        for (const side of ['top', 'right', 'bottom', 'left']) record[`border-${side}-color`] = value.split(/\s+(?![^(]*\))/)[0] ?? value;
        break;
      case 'text-decoration':
        record['text-decoration-line'] = value.split(/\s+/)[0] ?? value;
        break;
      case 'transform':
        extra.push(...transformClasses(value, ctx));
        break;
      default:
        record[property] = value;
    }
  }
  return [...new Set([...styleToTailwind(record, ctx), ...extra])].map((cls) => `${prefix}${cls}`);
}
