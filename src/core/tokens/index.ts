// Phase 3: design tokens. Pure functions only: capture + CSS data in, tokens out.
import { TOKEN_TUNING } from '../../shared/config';
import { TOKENS_SCHEMA_VERSION } from '../../shared/types';
import type { CaptureResult, CssData, CssVariable, DesignTokens } from '../../shared/types';
import { buildColorTokens } from './color';
import { buildBreakpoints, buildMotion, buildRadius, buildShadows } from './effects';
import { buildGradients } from './gradient';
import { buildSpacing } from './spacing';
import { buildTypography } from './typography';

function variableRecord(variables: readonly CssVariable[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const v of variables.slice(0, TOKEN_TUNING.maxCssVariablesInTokens)) record[v.name] = v.value;
  return record;
}

/** Build the tokens for one captured page. Deterministic; never touches the DOM or the network. */
export function generateTokens(capture: CaptureResult, css: CssData): DesignTokens {
  const themed = css.variables.filter((v) => v.theme === 'default' || v.theme === 'light');
  const gradients = buildGradients(capture);
  return {
    schemaVersion: TOKENS_SCHEMA_VERSION,
    source: { url: capture.meta.url, title: capture.meta.title, capturedAt: capture.meta.timestamp },
    colors: buildColorTokens(capture, css.variables, gradients),
    gradients,
    typography: buildTypography(capture),
    spacing: buildSpacing(capture),
    radius: buildRadius(capture),
    shadows: buildShadows(capture),
    motion: buildMotion(capture),
    breakpoints: buildBreakpoints(css.breakpoints),
    frameworks: css.frameworks,
    cssVariables: { default: variableRecord(themed), dark: variableRecord(css.darkMode.variables) },
    darkMode: css.darkMode.detected,
  };
}

/** Tokens with nothing in them: used when token generation fails, so the rest of the pack can still be built. */
export function emptyTokens(capture: CaptureResult): DesignTokens {
  return {
    schemaVersion: TOKENS_SCHEMA_VERSION,
    source: { url: capture.meta.url, title: capture.meta.title, capturedAt: capture.meta.timestamp },
    colors: [],
    gradients: [],
    typography: { families: [], sizes: [], weights: [], lineHeights: [], letterSpacings: [], tags: [] },
    spacing: { baseUnit: null, coverage: 0, scale: [] },
    radius: [],
    shadows: [],
    motion: { durations: [], easings: [] },
    breakpoints: [],
    frameworks: [],
    cssVariables: { default: {}, dark: {} },
    darkMode: false,
  };
}

export { generateThemeCss, generateTailwindV3Extend } from './theme';
export { detectBaseUnit } from './spacing';
export { buildGradients, gradientLayers, parseGradient } from './gradient';
export { assignRoles, clusterColors, normalizeColor } from './color';
