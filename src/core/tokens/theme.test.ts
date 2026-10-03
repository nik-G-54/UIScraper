import { describe, expect, it } from 'vitest';
import { CSS_LIMITS } from '../../shared/config';
import { parseCss } from '../css/parse';
import { captureOf, repeat } from './fixtures';
import { generateTokens } from './index';
import { generateTailwindV3Extend, generateThemeCss, typeScaleNames } from './theme';

const page = captureOf([
  { tag: 'html' },
  { tag: 'body', style: { 'background-color': 'rgb(255, 255, 255)' }, size: [1000, 2000] },
  ...repeat(4, { tag: 'p', text: 'Body', style: { color: 'rgb(17, 24, 39)', 'font-size': '16px', 'font-family': 'Inter, sans-serif', 'padding-top': '16px', 'margin-bottom': '8px', 'border-top-left-radius': '8px', 'box-shadow': 'rgba(0, 0, 0, 0.1) 0px 4px 6px 0px', 'transition-duration': '0.2s', 'transition-timing-function': 'ease-in-out' } }),
  { tag: 'h1', text: 'Hi', style: { 'font-size': '40px', 'font-family': 'Inter, sans-serif' } },
]);
const css = parseCss(
  [{ text: ':root{--ink:#111827} @media (min-width:640px){a{color:red}} @media (min-width:1024px){a{color:red}}', baseUrl: 'https://x.test/', media: null, label: 'x' }],
  CSS_LIMITS,
);

describe('theme output', () => {
  const tokens = generateTokens(page, css);

  it('emits a Tailwind v4 @theme block with the tokens', () => {
    const out = generateThemeCss(tokens);
    expect(out).toContain('@theme {');
    expect(out).toContain('--color-text-primary: #111827; /* was --ink */');
    expect(out).toContain('--color-background: #ffffff;');
    expect(out).toContain('--font-sans: Inter, sans-serif;');
    expect(out).toContain('--text-base: 1rem;');
    expect(out).toContain('--text-lg: 2.5rem;');
    expect(out).toContain('--spacing: 0.5rem;');
    expect(out).toContain('--radius-md: 0.5rem;');
    expect(out).toContain('--breakpoint-sm: 40rem;');
    expect(out).toContain('--breakpoint-md: 64rem;');
    expect(out).toContain('--default-transition-duration: 200ms;');
  });

  it('emits a Tailwind v3 theme.extend object literal', () => {
    const out = generateTailwindV3Extend(tokens);
    expect(out).toContain('"text-primary": "#111827"');
    expect(out).toContain('fontFamily: {');
    expect(out).toContain('screens: {');
    expect(() => new Function(`return (${out});`)()).not.toThrow();
  });

  it('names the type scale around the base size', () => {
    expect(typeScaleNames([{ px: 12, count: 1 }, { px: 16, count: 5 }, { px: 24, count: 2 }], 16).map((s) => s.name)).toEqual(['sm', 'base', 'lg']);
  });
});
