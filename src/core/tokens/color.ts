import { converter, differenceCiede2000, formatHex, formatHex8, parse } from 'culori';
import { COLOR_ROLES } from '../../shared/types';
import type { CaptureResult, ColorRole, ColorToken, ColorUse, CssVariable } from '../../shared/types';
import { TOKEN_TUNING } from '../../shared/config';
import { splitTopLevel } from './util';

const toOklch = converter('oklch');
const deltaE = differenceCiede2000();

const COLOR_FUNCTION = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi;

/** Chrome's default text colour, and its default link colour (the style table omits defaults). */
export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_LINK_COLOR = '#0000ee';

/**
 * Canonical `#rrggbb` (or `#rrggbbaa` when translucent) for any CSS colour string, or null when
 * it is not a colour or is (nearly) transparent.
 */
export function normalizeColor(input: string): string | null {
  const color = parse(input.trim());
  if (!color) return null;
  const alpha = color.alpha ?? 1;
  if (alpha <= TOKEN_TUNING.minColorAlpha) return null;
  const hex = alpha >= 0.995 ? formatHex(color) : formatHex8(color);
  return hex ?? null;
}

/** Every colour inside a (box|text)-shadow value, normalized. */
export function shadowColors(value: string): string[] {
  if (value === '' || value === 'none') return [];
  const found: string[] = [];
  for (const layer of splitTopLevel(value, ',')) {
    for (const match of layer.matchAll(COLOR_FUNCTION)) {
      const hex = normalizeColor(match[0]);
      if (hex) found.push(hex);
    }
  }
  return found;
}

export interface OklchInfo {
  l: number;
  c: number;
  /** Degrees; 0 for greys. */
  h: number;
}

export function oklchOf(hex: string): OklchInfo {
  const color = parse(hex);
  const lch = color ? toOklch(color) : undefined;
  return { l: lch?.l ?? 0, c: lch?.c ?? 0, h: lch?.h ?? 0 };
}

/** CIEDE2000 distance between two normalized colours (alpha ignored). */
export function colorDistance(a: string, b: string): number {
  const ca = parse(a);
  const cb = parse(b);
  return ca && cb ? deltaE(ca, cb) : Infinity;
}

function alphaOf(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
}

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

export interface ColorUsage {
  hex: string;
  count: number;
  area: number;
  uses: Record<ColorUse, number>;
  /** Uses as the text or background colour of a link or button. */
  interactive: number;
}

const newUsage = (hex: string): ColorUsage => ({
  hex,
  count: 0,
  area: 0,
  uses: { text: 0, background: 0, border: 0, shadow: 0 },
  interactive: 0,
});

const BORDER_COLORS = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] as const;

function isInteractive(tag: string, attrs: Record<string, string> | undefined): boolean {
  return (
    tag === 'a' ||
    tag === 'button' ||
    attrs?.role === 'button' ||
    (tag === 'input' && (attrs?.type === 'button' || attrs?.type === 'submit'))
  );
}

/** Colour usage from the style table: text, background, border and box-shadow colours of visible nodes. */
export function gatherColors(capture: CaptureResult): Map<string, ColorUsage> {
  const usages = new Map<string, ColorUsage>();
  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const style = capture.styleTable[node.styleId];
    if (!style) continue;
    const area = Math.max(0, node.rect.width) * Math.max(0, node.rect.height);
    const interactive = isInteractive(node.tag, node.attrs);

    const record = (hex: string | null, kind: ColorUse, interactiveUse = false) => {
      if (!hex) return;
      let usage = usages.get(hex);
      if (!usage) usages.set(hex, (usage = newUsage(hex)));
      usage.count++;
      usage.area += area;
      usage.uses[kind]++;
      if (interactiveUse) usage.interactive++;
    };

    if (node.text) {
      const raw = style.color;
      // An unstyled link keeps the browser's blue; that is not a design colour.
      if (raw !== undefined || node.tag !== 'a') record(normalizeColor(raw ?? DEFAULT_TEXT_COLOR), 'text', interactive);
    }
    const background = style['background-color'];
    if (background !== undefined) record(normalizeColor(background), 'background', interactive);

    const borders = new Set<string>();
    for (const prop of BORDER_COLORS) {
      const raw = style[prop];
      const hex = raw === undefined ? null : normalizeColor(raw);
      if (hex) borders.add(hex);
    }
    for (const hex of borders) record(hex, 'border');

    const shadows = new Set(shadowColors(style['box-shadow'] ?? ''));
    for (const hex of shadows) record(hex, 'shadow');
  }
  return usages;
}

/** Effective page background: body, else html, else the browser's white canvas. */
export function pageBackground(capture: CaptureResult): { hex: string; inferred: boolean } {
  for (const tag of ['body', 'html']) {
    const node = capture.nodes.find((n) => n.tag === tag);
    const raw = node && node.styleId !== null ? capture.styleTable[node.styleId]?.['background-color'] : undefined;
    const hex = raw === undefined ? null : normalizeColor(raw);
    if (hex && alphaOf(hex) >= 0.995) return { hex, inferred: false };
  }
  return { hex: '#ffffff', inferred: true };
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface ColorCluster extends Omit<ColorUsage, 'hex'> {
  /** Representative: the heaviest member. */
  hex: string;
  /** Member colours, heaviest first. */
  members: string[];
}

export const usageWeight = (u: Pick<ColorUsage, 'count' | 'area'>): number =>
  u.count + u.area / TOKEN_TUNING.areaUnitPx2;

/** Fold near-duplicate colours (CIEDE2000 below `maxDeltaE`, similar opacity) into clusters. */
export function clusterColors(usages: Iterable<ColorUsage>, maxDeltaE: number = TOKEN_TUNING.colorDeltaE): ColorCluster[] {
  const sorted = [...usages].sort((a, b) => usageWeight(b) - usageWeight(a) || a.hex.localeCompare(b.hex));
  const clusters: ColorCluster[] = [];
  for (const usage of sorted) {
    const target = clusters.find(
      (c) => Math.abs(alphaOf(c.hex) - alphaOf(usage.hex)) <= 0.05 && colorDistance(c.hex, usage.hex) <= maxDeltaE,
    );
    if (!target) {
      clusters.push({ ...usage, uses: { ...usage.uses }, members: [usage.hex] });
      continue;
    }
    target.members.push(usage.hex);
    target.count += usage.count;
    target.area += usage.area;
    target.interactive += usage.interactive;
    for (const kind of Object.keys(usage.uses) as ColorUse[]) target.uses[kind] += usage.uses[kind];
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const isSaturated = (hex: string) => alphaOf(hex) >= 0.5 && oklchOf(hex).c >= TOKEN_TUNING.saturatedChroma;
const isNeutral = (hex: string) => oklchOf(hex).c < TOKEN_TUNING.saturatedChroma;

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Pick the cluster playing each role. Background comes from the page; text, brand and border
 * colours from usage. A cluster fills at most one role. Pure and deterministic.
 */
export function assignRoles(
  clusters: ColorCluster[],
  background: { hex: string; inferred: boolean },
): { clusters: ColorCluster[]; roles: Map<ColorCluster, ColorRole> } {
  const all = [...clusters];
  const roles = new Map<ColorCluster, ColorRole>();
  const taken = (c: ColorCluster) => roles.has(c);

  let bg = all.find((c) => c.members.includes(background.hex));
  bg ??= all.find((c) => colorDistance(c.hex, background.hex) <= TOKEN_TUNING.colorDeltaE);
  if (!bg) {
    bg = { hex: background.hex, count: 0, area: 0, uses: { text: 0, background: 0, border: 0, shadow: 0 }, interactive: 0, members: [background.hex] };
    all.push(bg);
  }
  roles.set(bg, 'background');
  const bgL = oklchOf(bg.hex).l;

  const best = (pool: ColorCluster[], score: (c: ColorCluster) => number) =>
    pool.filter((c) => !taken(c) && score(c) > 0).sort((a, b) => score(b) - score(a) || usageWeight(b) - usageWeight(a))[0];

  const textPrimary = best(all, (c) => c.uses.text);
  if (textPrimary) roles.set(textPrimary, 'text-primary');

  const brand = (c: ColorCluster) => isSaturated(c.hex) && c.uses.text + c.uses.background > 0;
  const primary =
    best(all.filter((c) => isSaturated(c.hex) && c.interactive > 0), (c) => c.interactive) ??
    best(all.filter(brand), usageWeight);
  if (primary) roles.set(primary, 'primary');

  const surface = best(
    all.filter((c) => isNeutral(c.hex) && alphaOf(c.hex) >= 0.995),
    (c) => c.uses.background * 1_000_000 + c.area,
  );
  if (surface) roles.set(surface, 'surface');

  if (textPrimary) {
    const pl = oklchOf(textPrimary.hex).l;
    const [lo, hi] = pl < bgL ? [pl, bgL] : [bgL, pl];
    const muted = best(
      all.filter((c) => {
        const l = oklchOf(c.hex).l;
        return isNeutral(c.hex) && l > lo + 0.02 && l < hi - 0.02;
      }),
      (c) => c.uses.text,
    );
    if (muted) roles.set(muted, 'text-muted');
  }

  if (primary) {
    const hue = oklchOf(primary.hex).h;
    const accent = best(
      all.filter((c) => isSaturated(c.hex) && hueDistance(oklchOf(c.hex).h, hue) >= TOKEN_TUNING.accentMinHueDistance),
      (c) => c.interactive * 1_000_000 + usageWeight(c),
    );
    if (accent) roles.set(accent, 'accent');
  }

  const border = best(all, (c) => c.uses.border);
  if (border) roles.set(border, 'border');

  return { clusters: all, roles };
}

// ---------------------------------------------------------------------------
// CSS variables
// ---------------------------------------------------------------------------

const TRIPLET_HSL = /^\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*$/;
const TRIPLET_RGB = /^\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*$/;

/** Resolve a custom-property value to a colour: follows `var()`, accepts bare `H S% L%` / `R G B`. */
export function variableColor(
  value: string,
  lookup: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  if (depth > 5) return null;
  const varRef = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/i.exec(value.trim());
  if (varRef) {
    const target = lookup.get(varRef[1] ?? '');
    if (target !== undefined) return variableColor(target, lookup, depth + 1);
    return varRef[2] ? variableColor(varRef[2], lookup, depth + 1) : null;
  }
  const hsl = TRIPLET_HSL.exec(value);
  if (hsl) return normalizeColor(`hsl(${hsl[1]} ${hsl[2]}% ${hsl[3]}%)`);
  const rgb = TRIPLET_RGB.exec(value);
  if (rgb) return normalizeColor(`rgb(${rgb[1]} ${rgb[2]} ${rgb[3]})`);
  return normalizeColor(value);
}

/** Normalized colour -> the custom property that holds it (default/light theme, first declared wins). */
export function variableColorMap(variables: readonly CssVariable[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const v of variables) if (v.theme === 'default' || v.theme === 'light') lookup.set(v.name, v.value);
  const byColor = new Map<string, string>();
  for (const [name, value] of lookup) {
    if (name.startsWith('--tw-')) continue;
    const hex = variableColor(value, lookup);
    if (hex && !byColor.has(hex)) byColor.set(hex, name);
  }
  return byColor;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Colour tokens: clustered, role-tagged, named after matching CSS variables; roles first. */
export function buildColorTokens(
  capture: CaptureResult,
  variables: readonly CssVariable[],
): ColorToken[] {
  const usages = gatherColors(capture);
  const { clusters, roles } = assignRoles(clusterColors(usages.values()), pageBackground(capture));
  const byVariable = variableColorMap(variables);

  const tokens = clusters.map((cluster) => {
    const memberVar = cluster.members.map((m) => byVariable.get(m)).find((name) => name !== undefined);
    const token: ColorToken = {
      hex: cluster.hex,
      role: roles.get(cluster) ?? null,
      variable: byVariable.get(cluster.hex) ?? memberVar ?? null,
      count: cluster.count,
      area: Math.round(cluster.area),
      uses: cluster.uses,
      merged: cluster.members.length,
    };
    return { token, weight: usageWeight(cluster) };
  });

  const roleIndex = (t: ColorToken) => (t.role ? COLOR_ROLES.indexOf(t.role) : COLOR_ROLES.length);
  tokens.sort((a, b) => roleIndex(a.token) - roleIndex(b.token) || b.weight - a.weight);
  const kept = tokens.filter((t, i) => t.token.role !== null || i < TOKEN_TUNING.maxColors);
  return kept.map((t) => t.token);
}
