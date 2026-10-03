import { describe, expect, it } from 'vitest';
import { captureOf, repeat } from './fixtures';
import { buildSpacing, detectBaseUnit } from './spacing';
import { buildTypography } from './typography';

const values = (...pairs: [number, number][]) => pairs.map(([px, count]) => ({ px, count }));

describe('detectBaseUnit', () => {
  it('finds an 8px grid', () => {
    expect(detectBaseUnit(values([8, 10], [16, 20], [24, 8], [32, 4], [64, 2]))).toEqual({ baseUnit: 8, coverage: 1 });
  });
  it('falls back to a 4px grid when 8 does not fit', () => {
    expect(detectBaseUnit(values([4, 10], [12, 20], [20, 8], [16, 6])).baseUnit).toBe(4);
  });
  it('reports no base unit for ad-hoc values and ignores hairlines', () => {
    expect(detectBaseUnit(values([10, 5], [15, 5], [18, 5], [22, 5])).baseUnit).toBeNull();
    expect(detectBaseUnit(values([1, 99], [8, 3], [16, 3])).baseUnit).toBe(8);
    expect(detectBaseUnit(values([16, 3]))).toEqual({ baseUnit: null, coverage: 0 });
  });
});

describe('buildSpacing', () => {
  it('counts each distinct value once per node and builds an ascending scale', () => {
    const capture = captureOf([
      { tag: 'html' },
      ...repeat(3, { tag: 'div', style: { 'padding-top': '16px', 'padding-bottom': '16px', 'margin-top': '24px', 'row-gap': 'normal' } }),
      ...repeat(2, { tag: 'div', style: { 'padding-left': '8px', 'margin-left': '-8px', 'margin-right': 'auto' } }),
      { tag: 'div', style: { 'padding-left': '400px' } },
    ]);
    const spacing = buildSpacing(capture);
    expect(spacing.scale).toEqual([
      { px: 8, count: 2 },
      { px: 16, count: 3 },
      { px: 24, count: 3 },
    ]);
    expect(spacing.baseUnit).toBe(8);
  });
});

describe('type scale', () => {
  const capture = captureOf([
    { tag: 'html' },
    { tag: 'h1', text: 'Title', style: { 'font-size': '48px', 'font-family': '"Playfair Display", Georgia, serif', 'line-height': '52.8px', 'letter-spacing': '-0.5px' } },
    { tag: 'h2', text: 'Sub', style: { 'font-size': '30px', 'font-family': '"Playfair Display", Georgia, serif' } },
    ...repeat(5, { tag: 'p', text: 'Body', style: { 'font-size': '16px', 'font-family': 'Inter, system-ui, sans-serif', 'line-height': '24px' } }),
    ...repeat(2, { tag: 'small', text: 'Fine' }),
    ...repeat(2, { tag: 'span', text: 'Tiny', style: { 'font-size': '12px', 'font-family': 'Inter, system-ui, sans-serif' } }),
    { tag: 'code', text: 'x', style: { 'font-family': 'ui-monospace, "SF Mono", monospace' } },
    { tag: 'i', text: '★', style: { 'font-family': '"Font Awesome 6 Free"' } },
  ]);
  const typography = buildTypography(capture);

  it('lists sizes ascending with frequency, using browser defaults where the style table is silent', () => {
    expect(typography.sizes).toEqual([
      { px: 12, count: 2 },
      { px: 13, count: 1 },
      { px: 13.33, count: 2 },
      { px: 16, count: 6 },
      { px: 30, count: 1 },
      { px: 48, count: 1 },
    ]);
  });

  it('cleans family stacks, drops icon fonts and assigns body/heading/mono roles', () => {
    const roles = Object.fromEntries(typography.families.map((f) => [f.role ?? f.name, f]));
    expect(roles.body).toMatchObject({ name: 'Inter', stack: 'Inter, system-ui, sans-serif', category: 'sans' });
    expect(roles.heading).toMatchObject({ name: 'Playfair Display', stack: '"Playfair Display", Georgia, serif', category: 'serif' });
    expect(roles.mono).toMatchObject({ category: 'mono' });
    expect(typography.families.some((f) => /awesome/i.test(f.name))).toBe(false);
  });

  it('summarizes per-tag styles with line-height as a ratio', () => {
    const h1 = typography.tags.find((t) => t.tag === 'h1');
    expect(h1).toMatchObject({ fontSizePx: 48, fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.5px' });
    expect(typography.tags.find((t) => t.tag === 'p')).toMatchObject({ fontSizePx: 16, lineHeight: '1.5', count: 5 });
    expect(typography.tags.find((t) => t.tag === 'small')?.fontSizePx).toBe(13.33);
  });
});
