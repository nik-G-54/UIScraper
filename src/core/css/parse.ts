import { generate, parse, walk } from 'css-tree';
import type { Atrule, Block, CssNode, Declaration, List, Rule, Selector } from 'css-tree';
import { CSS_STATES } from '../../shared/types';
import type {
  CaptureWarning,
  CssBreakpoint,
  CssData,
  CssFontFace,
  CssKeyframes,
  CssLimits,
  CssState,
  CssStateRule,
  CssTheme,
  CssVariable,
} from '../../shared/types';
import { parseBreakpoints } from './breakpoints';
import { detectFrameworks } from './frameworks';

/** One stylesheet's CSS text, ready to parse. */
export interface CssSource {
  text: string;
  /** What relative url() values resolve against. */
  baseUrl: string;
  /** Media condition the whole sheet is under (`<link media>` / `@import ... media`). */
  media: string | null;
  /** For warnings: href or a description. */
  label: string;
}

/** Facts only the caller knows (downloads); merged into `CssData`. */
export interface CssParseExtras {
  fetchedSheets?: number;
  unreadableSheets?: number;
  warnings?: CaptureWarning[];
}

const STATE_SET: ReadonlySet<string> = new Set(CSS_STATES);
const MAX_DARK_SELECTORS = 20;

const DARK_SELECTOR = /(?:\.|\[data-[\w-]+\s*[~|^$*]?=\s*["']?)dark\b|\.dark-(?:mode|theme)\b|\.theme-dark\b/i;
const LIGHT_SELECTOR = /(?:\.|\[data-[\w-]+\s*[~|^$*]?=\s*["']?)light\b|\.light-(?:mode|theme)\b|\.theme-light\b/i;
const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i;
/** A single compound selector starting at the document root: `:root`, `html.dark`, `body[data-x]`. */
const ROOT_COMPOUND = /^(?::root|html|body|:host)(?![\w-])[^\s>+~]*$/i;
/** A single compound selector that switches a theme: `.dark`, `[data-theme=blue]`, `.theme-sepia`. */
const THEME_COMPOUND =
  /^[^\s>+~]*(?:\[data-[\w-]*(?:theme|mode|scheme)[\w-]*|\.(?:dark|light|theme-[\w-]+|[\w-]+-theme|[\w-]+-mode))/i;
const TRANSPARENT_AT_RULES: ReadonlySet<string> = new Set(['supports', 'layer', 'container', 'scope', 'document']);

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, '$2');
}

function resolveUrl(raw: string, base: string): string {
  if (raw === '' || raw.startsWith('data:') || raw.startsWith('#')) return raw;
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

function declarationValue(declaration: Declaration): string {
  const value = generate(declaration.value).trim();
  return declaration.important ? `${value} !important` : value;
}

/** Combinators get readable spacing: `a>b` -> `a > b`. */
function joinSelectorParts(parts: CssNode[]): string {
  let out = '';
  for (const part of parts) {
    out += part.type === 'Combinator' ? (part.name.trim() === '' ? ' ' : ` ${part.name} `) : generate(part);
  }
  return out.trim();
}

/** Remove top-level state pseudo-classes; returns the first state found and the remaining selector. */
function splitState(selector: Selector): { state: CssState; base: string } | null {
  const kept: CssNode[] = [];
  let state: CssState | null = null;
  for (const child of selector.children.toArray()) {
    if (child.type === 'PseudoClassSelector' && STATE_SET.has(child.name.toLowerCase())) {
      state ??= child.name.toLowerCase() as CssState;
    } else {
      kept.push(child);
    }
  }
  if (!state) return null;
  let base = joinSelectorParts(kept);
  if (base === '' || /^[>+~]/.test(base)) base = base === '' ? '*' : `* ${base}`;
  return { state, base };
}

function selectorsOf(rule: Rule): Selector[] {
  return rule.prelude.type === 'SelectorList'
    ? rule.prelude.children.toArray().filter((n): n is Selector => n.type === 'Selector')
    : [];
}

function declarationsOf(block: Block): Declaration[] {
  return block.children.toArray().filter((n): n is Declaration => n.type === 'Declaration');
}

function themeOf(selector: string, inDarkMedia: boolean): CssTheme {
  if (inDarkMedia || DARK_SELECTOR.test(selector)) return 'dark';
  if (LIGHT_SELECTOR.test(selector)) return 'light';
  return ROOT_COMPOUND.test(selector) && !THEME_COMPOUND.test(selector) ? 'default' : 'other';
}

interface Ctx {
  media: string[];
  dark: boolean;
}

class CssCollector {
  readonly variables = new Map<string, CssVariable>();
  readonly darkVariables = new Map<string, CssVariable>();
  readonly breakpoints = new Map<string, CssBreakpoint>();
  readonly stateRules: CssStateRule[] = [];
  readonly keyframes = new Map<string, CssKeyframes>();
  readonly fontFaces: CssFontFace[] = [];
  readonly darkSelectors = new Set<string>();
  readonly customProps = new Map<string, number>();
  darkRuleCount = 0;
  darkViaMedia = false;
  rules = 0;
  private nestedRules = 0;
  private droppedStateRules = 0;
  private droppedVariables = 0;
  private droppedKeyframes = 0;
  private droppedFontFaces = 0;

  constructor(private readonly limits: CssLimits) {}

  addBreakpoints(prelude: string): void {
    for (const found of parseBreakpoints(prelude)) {
      const key = `${found.feature}:${found.value}`;
      const existing = this.breakpoints.get(key);
      if (existing) existing.count++;
      else this.breakpoints.set(key, { ...found, count: 1 });
    }
  }

  visit(nodes: List<CssNode>, ctx: Ctx): void {
    for (const node of nodes.toArray()) {
      if (node.type === 'Rule') this.rule(node, ctx);
      else if (node.type === 'Atrule') this.atrule(node, ctx);
    }
  }

  private atrule(node: Atrule, ctx: Ctx): void {
    const name = node.name.toLowerCase();
    const prelude = node.prelude ? generate(node.prelude).trim() : '';
    if (name === 'media') {
      this.addBreakpoints(prelude);
      const dark = DARK_MEDIA.test(prelude);
      if (dark) this.darkViaMedia = true;
      if (node.block) this.visit(node.block.children, { media: [...ctx.media, prelude], dark: ctx.dark || dark });
    } else if (TRANSPARENT_AT_RULES.has(name)) {
      if (node.block) this.visit(node.block.children, ctx);
    } else if (name === 'keyframes' || name.endsWith('-keyframes')) {
      this.keyframe(node, prelude);
    } else if (name === 'font-face') {
      this.fontFace(node);
    }
  }

  private keyframe(node: Atrule, prelude: string): void {
    const name = unquote(prelude);
    if (!node.block || name === '') return;
    if (!this.keyframes.has(name) && this.keyframes.size >= this.limits.maxKeyframes) {
      this.droppedKeyframes++;
      return;
    }
    const properties = new Set<string>();
    let steps = 0;
    for (const child of node.block.children.toArray()) {
      if (child.type !== 'Rule') continue;
      steps++;
      for (const declaration of declarationsOf(child.block)) properties.add(declaration.property.toLowerCase());
    }
    this.keyframes.set(name, { name, steps, properties: [...properties].sort() });
  }

  private fontFace(node: Atrule): void {
    if (!node.block) return;
    if (this.fontFaces.length >= this.limits.maxFontFaces) {
      this.droppedFontFaces++;
      return;
    }
    const face: CssFontFace = { family: '', weight: 'normal', style: 'normal', display: null, sources: [] };
    for (const declaration of declarationsOf(node.block)) {
      const property = declaration.property.toLowerCase();
      const value = generate(declaration.value).trim();
      if (property === 'font-family') face.family = unquote(value);
      else if (property === 'font-weight') face.weight = value;
      else if (property === 'font-style') face.style = value;
      else if (property === 'font-display') face.display = value;
      else if (property === 'src') {
        const children = declaration.value.type === 'Value' ? declaration.value.children.toArray() : [];
        for (const child of children) {
          if (child.type === 'Url') {
            face.sources.push({ url: child.value, format: null });
          } else if (child.type === 'Function' && child.name.toLowerCase() === 'format') {
            const last = face.sources[face.sources.length - 1];
            if (last && last.format === null) last.format = unquote(generate(child).replace(/^format\(|\)$/gi, ''));
          }
        }
      }
    }
    if (face.family !== '') this.fontFaces.push(face);
  }

  private rule(node: Rule, ctx: Ctx): void {
    this.rules++;
    const selectors = selectorsOf(node);
    const declarations = declarationsOf(node.block);
    if (node.block.children.toArray().some((child) => child.type === 'Rule' || child.type === 'Atrule')) {
      this.nestedRules++;
    }
    const media = ctx.media.length > 0 ? ctx.media.join(' and ') : null;

    const customDeclarations = declarations.filter((d) => d.property.startsWith('--'));
    for (const declaration of customDeclarations) {
      this.customProps.set(declaration.property, (this.customProps.get(declaration.property) ?? 0) + 1);
    }

    const texts = selectors.map((selector) => generate(selector).trim());
    let inDark = ctx.dark;
    for (const text of texts) {
      if (!DARK_SELECTOR.test(text)) continue;
      inDark = true;
      if (this.darkSelectors.size < MAX_DARK_SELECTORS) this.darkSelectors.add(text.slice(0, 80));
    }
    if (inDark) this.darkRuleCount++;

    if (customDeclarations.length > 0) {
      for (const text of texts) {
        if (!ROOT_COMPOUND.test(text) && !THEME_COMPOUND.test(text)) continue;
        this.addVariables(text, themeOf(text, ctx.dark), media, customDeclarations);
      }
    }

    if (declarations.length === 0) return;
    for (const selector of selectors) {
      const split = splitState(selector);
      if (!split) continue;
      if (this.stateRules.length >= this.limits.maxStateRules) {
        this.droppedStateRules++;
        continue;
      }
      const record: Record<string, string> = {};
      for (const declaration of declarations) {
        const property = declaration.property.startsWith('--') ? declaration.property : declaration.property.toLowerCase();
        record[property] = declarationValue(declaration);
      }
      this.stateRules.push({ selector: split.base, state: split.state, declarations: record, media });
    }
  }

  private addVariables(selector: string, theme: CssTheme, media: string | null, declarations: Declaration[]): void {
    const target = theme === 'dark' ? this.darkVariables : this.variables;
    for (const declaration of declarations) {
      const key = `${theme}|${selector}|${media ?? ''}|${declaration.property}`;
      if (!target.has(key) && this.variables.size + this.darkVariables.size >= this.limits.maxVariables) {
        this.droppedVariables++;
        continue;
      }
      target.set(key, {
        name: declaration.property,
        value: generate(declaration.value).trim(),
        selector,
        theme,
        media,
      });
    }
  }

  warnings(): CaptureWarning[] {
    const out: CaptureWarning[] = [];
    const dropped = (count: number, code: string, what: string, limit: number) => {
      if (count > 0) {
        out.push({
          code,
          message: `Kept only the first ${limit.toLocaleString()} ${what}; ${count.toLocaleString()} more were dropped.`,
        });
      }
    };
    dropped(this.droppedStateRules, 'css-state-rule-limit', 'state rules', this.limits.maxStateRules);
    dropped(this.droppedVariables, 'css-variable-limit', 'CSS custom properties', this.limits.maxVariables);
    dropped(this.droppedKeyframes, 'css-keyframes-limit', '@keyframes', this.limits.maxKeyframes);
    dropped(this.droppedFontFaces, 'css-font-face-limit', '@font-face rules', this.limits.maxFontFaces);
    if (this.nestedRules > 0) {
      out.push({
        code: 'css-nesting-ignored',
        message: `${this.nestedRules.toLocaleString()} rule(s) use CSS nesting; their nested rules were not analyzed.`,
      });
    }
    return out;
  }
}

/**
 * Parse stylesheets and pull out what design tokens and the design.md need: custom properties,
 * breakpoints, state rules, keyframes, font faces, dark mode and framework hints. Never throws:
 * a sheet that cannot be parsed becomes a warning.
 */
export function parseCss(sources: CssSource[], limits: CssLimits, extras: CssParseExtras = {}): CssData {
  const collector = new CssCollector(limits);
  const warnings: CaptureWarning[] = [...(extras.warnings ?? [])];
  const banners: string[] = [];
  let bytes = 0;

  for (const source of sources) {
    bytes += source.text.length;
    banners.push(source.text.slice(0, 400));
    try {
      let parseErrors = 0;
      const ast = parse(source.text, { onParseError: () => parseErrors++ });
      walk(ast, {
        visit: 'Url',
        enter(node) {
          node.value = resolveUrl(node.value, source.baseUrl);
        },
      });
      if (parseErrors > 0) {
        warnings.push({
          code: 'css-parse-errors',
          message: `${parseErrors.toLocaleString()} recoverable error(s) while parsing ${source.label}; the rest was used.`,
        });
      }
      const media = source.media;
      if (media) collector.addBreakpoints(media);
      if (ast.type === 'StyleSheet') {
        collector.visit(ast.children, { media: media ? [media] : [], dark: media !== null && DARK_MEDIA.test(media) });
      }
    } catch (error) {
      warnings.push({
        code: 'css-parse-failed',
        message: `Could not parse ${source.label}: ${error instanceof Error ? error.message : 'unknown error'}.`,
      });
    }
  }

  warnings.push(...collector.warnings());
  const darkVariables = [...collector.darkVariables.values()];

  return {
    variables: [...collector.variables.values()],
    breakpoints: [...collector.breakpoints.values()].sort(
      (a, b) => (a.px ?? Infinity) - (b.px ?? Infinity) || b.count - a.count,
    ),
    stateRules: collector.stateRules,
    keyframes: [...collector.keyframes.values()],
    fontFaces: collector.fontFaces,
    darkMode: {
      detected: collector.darkViaMedia || collector.darkSelectors.size > 0 || darkVariables.length > 0,
      viaMediaQuery: collector.darkViaMedia,
      selectors: [...collector.darkSelectors],
      ruleCount: collector.darkRuleCount,
      variables: darkVariables,
    },
    frameworks: detectFrameworks(collector.customProps, banners),
    stats: {
      sheets: sources.length,
      fetchedSheets: extras.fetchedSheets ?? 0,
      unreadableSheets: extras.unreadableSheets ?? 0,
      rules: collector.rules,
      bytes,
    },
    warnings,
  };
}

/** `@import` targets of a stylesheet, resolved against `baseUrl`. Never throws. */
export function findImports(text: string, baseUrl: string): { url: string; media: string | null }[] {
  const found: { url: string; media: string | null }[] = [];
  try {
    const ast = parse(text, { parseValue: false });
    walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name.toLowerCase() !== 'import' || !node.prelude) return;
        const prelude = generate(node.prelude).trim();
        const match = /^(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)\s*(.*)$/i.exec(prelude);
        const raw = match?.[2] || match?.[4];
        if (!raw) return;
        const rest = (match?.[5] ?? '').replace(/\b(?:layer|supports)\b(?:\([^)]*\))?/gi, '').trim();
        found.push({ url: resolveUrl(raw, baseUrl), media: rest === '' || /^all$/i.test(rest) ? null : rest });
      },
    });
  } catch {
    // An unparseable sheet simply has no followable imports.
  }
  return found;
}
