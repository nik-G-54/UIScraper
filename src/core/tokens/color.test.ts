import { describe, expect, it } from 'vitest';
import type { CssVariable } from '../../shared/types';
import { assignRoles, buildColorTokens, clusterColors, gatherColors, normalizeColor, pageBackground, shadowColors, variableColor } from './color';
import { captureOf, repeat } from './fixtures';

describe('normalizeColor', () => {
  it('canonicalizes rgb, hsl, oklch and named colours to hex', () => {
    expect(normalizeColor('rgb(29, 78, 216)')).toBe('#1d4ed8');
    expect(normalizeColor('hsl(0 0% 100%)')).toBe('#ffffff');
    expect(normalizeColor('WHITE')).toBe('#ffffff');
    expect(normalizeColor('oklch(0.5 0 0)')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('keeps translucency as hex8 and drops transparent / non-colours', () => {
    expect(normalizeColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(normalizeColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(normalizeColor('transparent')).toBeNull();
    expect(normalizeColor('not-a-colour')).toBeNull();
  });
  it('finds every colour in a box-shadow', () => {
    expect(shadowColors('rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgb(255, 0, 0) 0px 0px 2px 0px')).toEqual(['#0000001a', '#ff0000']);
    expect(shadowColors('none')).toEqual([]);
  });
});

describe('clusterColors', () => {
  const usage = (hex: string, count: number) => ({
    hex,
    count,
    area: 0,
    uses: { text: count, background: 0, border: 0, shadow: 0, gradient: 0 },
    interactive: 0,
  });

  it('merges near-duplicates into the heaviest member and keeps distinct colours apart', () => {
    const clusters = clusterColors([usage('#1d4ed8', 10), usage('#1e4fd9', 3), usage('#ff0000', 4), usage('#ffffff', 5)]);
    expect(clusters.map((c) => [c.hex, c.count, c.members.length])).toEqual([
      ['#1d4ed8', 13, 2],
      ['#ffffff', 5, 1],
      ['#ff0000', 4, 1],
    ]);
  });
  it('does not merge a translucent colour into its opaque twin', () => {
    expect(clusterColors([usage('#000000', 5), usage('#00000080', 5)])).toHaveLength(2);
  });
});

describe('role assignment', () => {
  const page = captureOf([
    { tag: 'html' },
    { tag: 'body', style: { 'background-color': 'rgb(255, 255, 255)', color: 'rgb(17, 24, 39)' }, size: [1000, 2000] },
    ...repeat(6, { tag: 'p', text: 'Body copy', style: { color: 'rgb(17, 24, 39)' } }),
    ...repeat(4, { tag: 'span', text: 'Caption', style: { color: 'rgb(107, 114, 128)' } }),
    ...repeat(3, { tag: 'div', style: { 'background-color': 'rgb(249, 250, 251)', 'border-top-color': 'rgb(229, 231, 235)', 'border-top-width': '1px' }, size: [300, 200] }),
    ...repeat(2, { tag: 'a', text: 'Link', attrs: { href: '/' }, style: { color: 'rgb(37, 99, 235)' } }),
    { tag: 'button', text: 'Buy', style: { 'background-color': 'rgb(220, 38, 38)', color: 'rgb(255, 255, 255)' } },
  ]);

  it('reads the page background from body, falling back to white', () => {
    expect(pageBackground(page)).toEqual({ hex: '#ffffff', inferred: false });
    expect(pageBackground(captureOf([{ tag: 'html' }]))).toEqual({ hex: '#ffffff', inferred: true });
  });

  it('assigns background, surface, text, brand and border roles', () => {
    const tokens = buildColorTokens(page, []);
    const role = (r: string) => tokens.find((t) => t.role === r)?.hex;
    expect(role('background')).toBe('#ffffff');
    expect(role('text-primary')).toBe('#111827');
    expect(role('text-muted')).toBe('#6b7280');
    expect(role('surface')).toBe('#f9fafb');
    expect(role('border')).toBe('#e5e7eb');
    // Links and buttons: the blue is used on two links, the red on one button.
    expect(role('primary')).toBe('#2563eb');
    expect(role('accent')).toBe('#dc2626');
    expect(new Set(tokens.map((t) => t.role).filter(Boolean)).size).toBe(tokens.filter((t) => t.role).length);
  });

  it('keeps the CSS variable name when a variable holds the colour (incl. bare HSL triplets)', () => {
    const variables: CssVariable[] = [
      { name: '--brand', value: 'hsl(221 83% 53%)', selector: ':root', theme: 'default', media: null },
      { name: '--ink', value: '17 24 39', selector: ':root', theme: 'default', media: null },
      { name: '--text', value: 'var(--ink)', selector: ':root', theme: 'default', media: null },
    ];
    const tokens = buildColorTokens(page, variables);
    expect(tokens.find((t) => t.hex === '#111827')?.variable).toBe('--ink');
    expect(variableColor('var(--text)', new Map([['--text', '17 24 39']]))).toBe('#111827');
  });

  it('creates a background entry when the page colour is never used elsewhere', () => {
    const only = captureOf([{ tag: 'html' }, { tag: 'p', text: 'x', style: { color: 'rgb(0, 0, 0)' } }]);
    const { clusters, roles } = assignRoles(clusterColors(gatherColors(only).values()), pageBackground(only));
    expect([...roles.entries()].find(([, r]) => r === 'background')?.[0].hex).toBe('#ffffff');
    expect(clusters.length).toBeGreaterThan(1);
  });
});
