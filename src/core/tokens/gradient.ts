import { TOKEN_TUNING } from '../../shared/config';
import type { CaptureResult, GradientStop, GradientToken } from '../../shared/types';
import { normalizeColor } from './color';
import { Tally, splitTopLevel } from './util';

const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
const COLOR_FUNCTION = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i;
const POSITION = /^-?\d*\.?\d+(?:px|%|deg|turn|rad|em|rem)$|^calc\(.*\)$/i;

/** Parse one gradient layer (`linear-gradient(...)`); null for anything else (url(), none...). */
export function parseGradient(layer: string): Omit<GradientToken, 'count'> | null {
  const value = layer.replace(/\s+/g, ' ').trim();
  const head = GRADIENT.exec(value);
  if (!head || !value.endsWith(')')) return null;
  const inner = value.slice(head[0].length, -1);
  const stops: GradientStop[] = [];
  for (const part of splitTopLevel(inner, ',')) {
    const found = COLOR_FUNCTION.exec(part);
    if (!found) continue; // direction / shape / interpolation hint
    const hex = normalizeColor(found[0]);
    const rest = (part.slice(0, found.index) + ' ' + part.slice(found.index + found[0].length)).trim().split(/\s+(?![^(]*\))/);
    const position = rest.find((token) => POSITION.test(token)) ?? null;
    stops.push({ color: hex ?? 'transparent', position });
  }
  if (stops.length === 0) return null;
  return {
    value,
    kind: (head[2] ?? 'linear').toLowerCase() as GradientToken['kind'],
    repeating: Boolean(head[1]),
    stops,
  };
}

/** The gradient layers of a `background-image` value (it can mix url() and gradients). */
export function gradientLayers(backgroundImage: string): string[] {
  if (!backgroundImage || backgroundImage === 'none') return [];
  return splitTopLevel(backgroundImage, ',').filter((layer) => GRADIENT.test(layer.trim()));
}

/** Distinct gradients in use, with usage counts (each counted once per node), most used first. */
export function buildGradients(capture: CaptureResult): GradientToken[] {
  const tally = new Tally<string>();
  const parsed = new Map<string, Omit<GradientToken, 'count'>>();
  for (const node of capture.nodes) {
    if (node.styleId === null) continue;
    const image = capture.styleTable[node.styleId]?.['background-image'];
    if (!image) continue;
    const seen = new Set<string>();
    for (const layer of gradientLayers(image)) {
      const gradient = parseGradient(layer);
      if (!gradient) continue;
      parsed.set(gradient.value, gradient);
      seen.add(gradient.value);
    }
    for (const value of seen) tally.add(value);
  }
  return tally
    .top(TOKEN_TUNING.maxGradients)
    .map(([value, count]) => ({ ...(parsed.get(value) as Omit<GradientToken, 'count'>), count }));
}
