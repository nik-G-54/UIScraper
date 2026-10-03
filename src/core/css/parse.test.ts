import { describe, expect, it } from 'vitest';
import { CSS_LIMITS } from '../../shared/config';
import { parseBreakpoints } from './breakpoints';
import { findImports, parseCss } from './parse';

const BASE = 'https://cdn.example.com/css/main.css';

const FIXTURE = `
/*! tailwindcss v4.1.0 | MIT License */
@import url("theme.css") screen;
:root { --brand: #1d4ed8; --radius: 8px; --tw-ring-color: red; }
body { --body-bg: white; color: var(--brand); }
.dark, [data-theme="dark"] { --brand: #93c5fd; --body-bg: #111; }
.card { padding: 8px; }
a.btn:hover, a.btn:focus-visible { color: red; background: url(img/bg.png); }
.nav > li:hover > a { text-decoration: underline; }
button:disabled { opacity: .5; }
@media (min-width: 768px) {
  .card:active { transform: scale(.98); }
}
@media (min-width: 768px) and (max-width: 1023px) { .x { color: red; } }
@media (width >= 48rem) { .y { color: blue; } }
@media (prefers-color-scheme: dark) {
  :root { --brand: #bfdbfe; --body-bg: #000; }
  .panel { color: white; }
}
@layer components { .z:hover { color: green; } }
@keyframes fade { from { opacity: 0; } 50% { opacity: .5; transform: none; } to { opacity: 1; } }
@font-face {
  font-family: "Inter Var";
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  src: local("Inter"), url(../fonts/inter.woff2) format("woff2"), url(../fonts/inter.woff) format("woff");
}
`;

const parse = (text = FIXTURE) => parseCss([{ text, baseUrl: BASE, media: null, label: 'fixture' }], CSS_LIMITS);

describe('parseCss', () => {
  const data = parse();

  it('collects default-theme custom properties from :root and body, not dark overrides', () => {
    const defaults = data.variables.filter((v) => v.theme === 'default');
    expect(defaults.map((v) => [v.name, v.value, v.selector])).toEqual(
      expect.arrayContaining([
        ['--brand', '#1d4ed8', ':root'],
        ['--radius', '8px', ':root'],
        ['--body-bg', 'white', 'body'],
      ]),
    );
    expect(data.variables.some((v) => v.value === '#93c5fd')).toBe(false);
  });

  it('detects dark mode from selectors and prefers-color-scheme, with variable overrides', () => {
    expect(data.darkMode.detected).toBe(true);
    expect(data.darkMode.viaMediaQuery).toBe(true);
    expect(data.darkMode.selectors).toEqual(expect.arrayContaining(['.dark, [data-theme="dark"]'.split(', ')[0]]));
    const overrides = Object.fromEntries(data.darkMode.variables.map((v) => [`${v.selector}|${v.name}`, v.value]));
    expect(overrides['.dark|--brand']).toBe('#93c5fd');
    expect(overrides['[data-theme="dark"]|--body-bg']).toBe('#111');
    expect(overrides[':root|--brand']).toBe('#bfdbfe');
    expect(data.darkMode.ruleCount).toBe(3);
  });

  it('records state rules with the state pseudo removed, resolved urls and the enclosing media', () => {
    const hover = data.stateRules.filter((r) => r.selector === 'a.btn');
    expect(hover.map((r) => r.state).sort()).toEqual(['focus-visible', 'hover']);
    expect(hover[0]?.declarations.color).toBe('red');
    expect(hover[0]?.declarations.background).toContain('https://cdn.example.com/css/img/bg.png');
    expect(data.stateRules.find((r) => r.state === 'hover' && r.selector === '.nav > li > a')).toBeDefined();
    expect(data.stateRules.find((r) => r.selector === 'button')?.state).toBe('disabled');
    const active = data.stateRules.find((r) => r.state === 'active');
    expect(active).toMatchObject({ selector: '.card', media: '(min-width:768px)' });
    expect(data.stateRules.find((r) => r.selector === '.z')?.media).toBeNull();
  });

  it('counts breakpoints from min/max-width and range syntax', () => {
    const find = (feature: string, value: string) => data.breakpoints.find((b) => b.feature === feature && b.value === value);
    expect(find('min-width', '768px')).toMatchObject({ px: 768, count: 2 });
    expect(find('max-width', '1023px')).toMatchObject({ px: 1023, count: 1 });
    expect(find('min-width', '48rem')).toMatchObject({ px: 768, count: 1 });
    expect(data.breakpoints.map((b) => b.px)).toEqual([...data.breakpoints.map((b) => b.px)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('summarizes @keyframes and @font-face', () => {
    expect(data.keyframes).toEqual([{ name: 'fade', steps: 3, properties: ['opacity', 'transform'] }]);
    expect(data.fontFaces).toEqual([
      {
        family: 'Inter Var',
        weight: '100 900',
        style: 'normal',
        display: 'swap',
        sources: [
          { url: 'https://cdn.example.com/fonts/inter.woff2', format: 'woff2' },
          { url: 'https://cdn.example.com/fonts/inter.woff', format: 'woff' },
        ],
      },
    ]);
  });

  it('hints at frameworks from banners and custom property names', () => {
    expect(data.frameworks).toEqual([{ name: 'Tailwind CSS', version: '4.1.0', evidence: '1 --tw-* custom properties' }]);
  });

  it('turns unparseable input into warnings, never a throw', () => {
    const broken = parse('}}} .a { color: ; @@@ } .b:hover { color: red }');
    expect(broken.stateRules.some((r) => r.selector === '.b')).toBe(true);
    expect(() => parseCss([{ text: '', baseUrl: 'not a url', media: null, label: 'x' }], CSS_LIMITS)).not.toThrow();
  });

  it('caps state rules and says so', () => {
    const many = Array.from({ length: 5 }, (_, i) => `.a${i}:hover{color:red}`).join('');
    const capped = parseCss([{ text: many, baseUrl: BASE, media: null, label: 'x' }], { ...CSS_LIMITS, maxStateRules: 2 });
    expect(capped.stateRules).toHaveLength(2);
    expect(capped.warnings.map((w) => w.code)).toContain('css-state-rule-limit');
  });
});

describe('findImports', () => {
  it('resolves url() and string imports against the sheet and keeps the media condition', () => {
    expect(findImports(`@import url(a.css); @import "../b.css" print; @import url('https://x.test/c.css') layer(base);`, BASE)).toEqual([
      { url: 'https://cdn.example.com/css/a.css', media: null },
      { url: 'https://cdn.example.com/b.css', media: 'print' },
      { url: 'https://x.test/c.css', media: null },
    ]);
  });
});

describe('parseBreakpoints', () => {
  it('reads the range form with both bounds', () => {
    expect(parseBreakpoints('(600px <= width <= 900px)').map((b) => [b.feature, b.px])).toEqual([
      ['min-width', 600],
      ['max-width', 900],
    ]);
  });
});
