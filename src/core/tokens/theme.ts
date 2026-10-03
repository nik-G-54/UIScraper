import type { ColorToken, DesignTokens, ScaleValue } from '../../shared/types';

const rem = (px: number): string => `${Number((px / 16).toFixed(4))}rem`;

/** Names for 1..6 ordered steps (small to large): radius, shadows. */
const STEP_NAMES: string[][] = [
  [],
  ['md'],
  ['sm', 'lg'],
  ['sm', 'md', 'lg'],
  ['sm', 'md', 'lg', 'xl'],
  ['xs', 'sm', 'md', 'lg', 'xl'],
  ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
];
const stepNames = (n: number): string[] =>
  STEP_NAMES[Math.min(n, 6)] ?? Array.from({ length: n }, (_, i) => `step-${i + 1}`);

const SCREEN_NAMES = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'];
const TEXT_NAMES = ['3xs', '2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const TEXT_BASE_INDEX = 4;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** One unique, Tailwind-safe name per colour: its role, else its variable name, else `palette-N`. */
export function colorNames(colors: readonly ColorToken[]): string[] {
  const used = new Set<string>();
  let palette = 0;
  return colors.map((color) => {
    let base = color.role ?? slug((color.variable ?? '').replace(/^--/, '').replace(/^color-/, ''));
    if (base === '' || /^\d/.test(base)) base = `palette-${++palette}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    return name;
  });
}

/** The size the page treats as body text: the `p` size, else the most used size, else 16px. */
export function baseFontSize(tokens: DesignTokens): number {
  const p = tokens.typography.tags.find((t) => t.tag === 'p');
  if (p) return p.fontSizePx;
  const top = [...tokens.typography.sizes].sort((a, b) => b.count - a.count)[0];
  return top?.px ?? 16;
}

/** Tailwind-style names (`sm`, `base`, `lg`...) for an ascending size scale, anchored on the base size. */
export function typeScaleNames(sizes: readonly ScaleValue[], basePx: number): { name: string; px: number }[] {
  if (sizes.length === 0) return [];
  let nearest = 0;
  sizes.forEach((s, i) => {
    if (Math.abs(s.px - basePx) < Math.abs((sizes[nearest]?.px ?? 0) - basePx)) nearest = i;
  });
  const out: { name: string; px: number }[] = [];
  sizes.forEach((s, i) => {
    const name = TEXT_NAMES[TEXT_BASE_INDEX + i - nearest];
    if (name) out.push({ name, px: s.px });
  });
  return out;
}

interface Named<T> {
  name: string;
  value: T;
}

function radii(tokens: DesignTokens): Named<string>[] {
  const pill = tokens.radius.find((r) => r.px === 9999 || r.value === '50%');
  const steps = tokens.radius.filter((r) => r.px !== null && r.px < 9999);
  const names = stepNames(steps.length);
  const out: Named<string>[] = steps.map((r, i) => ({ name: names[i] ?? `step-${i + 1}`, value: rem(r.px ?? 0) }));
  if (pill) out.push({ name: 'full', value: '9999px' });
  return out;
}

function shadows(tokens: DesignTokens): Named<string>[] {
  const names = stepNames(tokens.shadows.length);
  return tokens.shadows.map((s, i) => ({ name: names[i] ?? `step-${i + 1}`, value: s.value }));
}

function screens(tokens: DesignTokens): Named<number>[] {
  return tokens.breakpoints.map((b, i) => ({ name: SCREEN_NAMES[i] ?? `bp-${b.px}`, value: b.px }));
}

function fonts(tokens: DesignTokens): Named<string>[] {
  const out: Named<string>[] = [];
  const seen = new Set<string>();
  for (const family of tokens.typography.families) {
    if (!seen.has(family.category)) {
      seen.add(family.category);
      out.push({ name: family.category === 'display' ? 'display' : family.category, value: family.stack });
    }
  }
  const heading = tokens.typography.families.find((f) => f.role === 'heading');
  if (heading) out.push({ name: 'heading', value: heading.stack });
  return out;
}

function spacingSteps(tokens: DesignTokens): number[] {
  return tokens.spacing.scale.map((s) => s.px).filter((px) => Number.isInteger(px));
}

/** A Tailwind CSS v4 `@theme` block (CSS-first config) from the tokens. */
export function generateThemeCss(tokens: DesignTokens): string {
  const lines: string[] = [];
  const add = (property: string, value: string, comment?: string) =>
    lines.push(`  --${property}: ${value};${comment ? ` /* ${comment} */` : ''}`);
  const section = (title: string) => lines.push(lines.length > 0 ? `\n  /* ${title} */` : `  /* ${title} */`);

  const names = colorNames(tokens.colors);
  if (tokens.colors.length > 0) section('Colors');
  tokens.colors.forEach((color, i) => add(`color-${names[i]}`, color.hex, color.variable ? `was ${color.variable}` : undefined));

  const fontList = fonts(tokens);
  if (fontList.length > 0) section('Fonts');
  for (const font of fontList) add(`font-${font.name}`, font.value);

  const scale = typeScaleNames(tokens.typography.sizes, baseFontSize(tokens));
  if (scale.length > 0) section('Type scale');
  for (const step of scale) add(`text-${step.name}`, rem(step.px));

  const { baseUnit } = tokens.spacing;
  const steps = spacingSteps(tokens);
  if (baseUnit !== null || steps.length > 0) section('Spacing');
  if (baseUnit !== null) add('spacing', rem(baseUnit), `base unit ${baseUnit}px: p-2 = ${baseUnit * 2}px`);
  else for (const px of steps) add(`spacing-${px}px`, rem(px));

  const radiusList = radii(tokens);
  if (radiusList.length > 0) section('Radius');
  for (const r of radiusList) add(`radius-${r.name}`, r.value);

  const shadowList = shadows(tokens);
  if (shadowList.length > 0) section('Shadows');
  for (const s of shadowList) add(`shadow-${s.name}`, s.value);

  const screenList = screens(tokens);
  if (screenList.length > 0) section('Breakpoints');
  for (const s of screenList) add(`breakpoint-${s.name}`, rem(s.value));

  const { durations, easings } = tokens.motion;
  const topDuration = [...durations].sort((a, b) => b.count - a.count)[0];
  const topEasing = easings[0];
  if (topDuration || topEasing) section('Motion');
  if (topDuration) add('default-transition-duration', `${topDuration.ms}ms`);
  if (topEasing) add('default-transition-timing-function', topEasing.value);
  easings.forEach((e, i) => add(`ease-${i + 1}`, e.value));
  if (durations.length > 0) lines.push(`  /* transition durations seen: ${durations.map((d) => `${d.ms}ms`).join(', ')} */`);

  const note = tokens.darkMode ? '\n/* This page also has a dark theme: see cssVariables.dark in tokens.json. */' : '';
  const host = (() => {
    try {
      return new URL(tokens.source.url).hostname;
    } catch {
      return tokens.source.url;
    }
  })();
  return `/* Generated by DesignLens from ${host} (${tokens.source.capturedAt.slice(0, 10)}). Tailwind CSS v4. */\n@theme {\n${lines.join('\n')}\n}\n${note}`.trimEnd() + '\n';
}

/** The contents of Tailwind v3 `theme.extend`, as a JS object-literal string. */
export function generateTailwindV3Extend(tokens: DesignTokens): string {
  const extend: Record<string, unknown> = {};
  const names = colorNames(tokens.colors);
  if (tokens.colors.length > 0) {
    extend.colors = Object.fromEntries(tokens.colors.map((c, i) => [names[i], c.hex]));
  }
  const fontList = fonts(tokens);
  if (fontList.length > 0) {
    extend.fontFamily = Object.fromEntries(fontList.map((f) => [f.name, f.value.split(/,\s*/).map((n) => n.replace(/^"|"$/g, ''))]));
  }
  const scale = typeScaleNames(tokens.typography.sizes, baseFontSize(tokens));
  if (scale.length > 0) extend.fontSize = Object.fromEntries(scale.map((s) => [s.name, rem(s.px)]));
  const steps = spacingSteps(tokens);
  if (steps.length > 0) {
    // Keys follow Tailwind's own scale: key N is N * 0.25rem (4px).
    extend.spacing = Object.fromEntries(steps.map((px) => [String(px / 4), rem(px)]));
  }
  const radiusList = radii(tokens);
  if (radiusList.length > 0) extend.borderRadius = Object.fromEntries(radiusList.map((r) => [r.name, r.value]));
  const shadowList = shadows(tokens);
  if (shadowList.length > 0) extend.boxShadow = Object.fromEntries(shadowList.map((s) => [s.name, s.value]));
  const screenList = screens(tokens);
  if (screenList.length > 0) extend.screens = Object.fromEntries(screenList.map((s) => [s.name, `${s.value}px`]));
  if (tokens.motion.durations.length > 0) {
    extend.transitionDuration = Object.fromEntries(tokens.motion.durations.map((d) => [String(d.ms), `${d.ms}ms`]));
  }
  if (tokens.motion.easings.length > 0) {
    extend.transitionTimingFunction = Object.fromEntries(tokens.motion.easings.map((e, i) => [`custom-${i + 1}`, e.value]));
  }
  return JSON.stringify(extend, null, 2).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:');
}
