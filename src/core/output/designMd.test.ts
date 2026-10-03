import { describe, expect, it } from 'vitest';
import { buildAssetIndex } from '../assets';
import { analyzeLayout, buildTree } from '../components';
import { pageOf } from '../components/fixtures';
import { generateThemeCss, generateTokens } from '../tokens';
import { CSS_LIMITS } from '../../shared/config';
import { parseCss } from '../css';
import { generateDesignMd } from './designMd';

const button = { 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'padding-top': '8px', 'padding-right': '16px', 'padding-bottom': '8px', 'padding-left': '16px', 'font-size': '14px' };

function fixture() {
  const capture = pageOf({
    tag: 'html',
    rect: [0, 0, 1440, 1000],
    children: [
      {
        tag: 'body',
        rect: [0, 0, 1440, 1000],
        style: { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))' },
        children: [
          { tag: 'header', rect: [0, 0, 1440, 72], children: [{ tag: 'img', rect: [20, 20, 80, 32], attrs: { src: 'https://x.test/logo.png' } }] },
          {
            tag: 'section',
            rect: [0, 72, 1440, 500],
            children: [
              { tag: 'h1', rect: [100, 100, 600, 60], text: 'Hello', style: { 'font-size': '48px', 'font-weight': '700' } },
              ...[0, 1, 2].map((i) => ({ tag: 'a', rect: [100 + i * 140, 200, 120, 36] as [number, number, number, number], text: 'Go', style: button, attrs: { href: '/x' } })),
            ],
          },
          { tag: 'footer', rect: [0, 900, 1440, 100] },
        ],
      },
    ],
  });
  const css = parseCss([], CSS_LIMITS);
  const tokens = generateTokens(capture, css);
  const layout = analyzeLayout(capture, tokens);
  const assets = buildAssetIndex(
    buildTree(capture),
    layout.sections,
    {
      schemaVersion: capture.schemaVersion,
      images: [{ nodeId: 3, url: 'https://x.test/logo.png', srcset: null, naturalWidth: 160, naturalHeight: 64, alt: 'Logo', inPicture: false }],
      svgs: [],
      favicons: [],
      warnings: [],
    },
    css,
  );
  return {
    capture,
    tokens,
    themeCss: generateThemeCss(tokens),
    css,
    layout,
    assets,
    screens: { fullPage: { name: 'full-page', path: 'assets/screens/full-page.jpg' }, sections: [{ name: 'header', path: 'assets/screens/01-header.jpg' }], warnings: [] },
    warnings: [{ code: 'x', message: 'Something was skipped.' }],
  };
}

describe('generateDesignMd', () => {
  it('has every section, in order, with the data from each phase', () => {
    const md = generateDesignMd(fixture());
    const headings = [
      '## 1. Instructions for the AI agent',
      '## 2. Overview',
      '## 3. Design tokens',
      '## 4. Layout',
      '## 5. Components',
      '## 6. Assets index',
      '## 7. Responsive breakpoints and dark mode',
      '## 8. Motion',
    ];
    const positions = headings.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(md).toContain('Next.js (App Router)');
    expect(md).toContain('placeholders');
    expect(md).toContain('### Gradients');
    expect(md).toContain('@theme {');
    expect(md).toContain('assets/screens/01-header.jpg');
    expect(md).toContain('Something was skipped.');
    expect(md).toContain('### button — 3× button');
    expect(md).toContain('1440px');
    expect(md).toContain('Key elements');
    expect(md).toContain('**heading** `<h1>` “Hello”');
    expect(md).toContain('48px');
    expect(md).toContain('Do not invent decorations');
    expect(md).toContain('closest free Google Font');
    expect(md).toContain('- **Container:**');
    expect(md).toContain('**Border radius:**');
  });

  it('respects the size cap by summarizing, and says so when it has to cut', () => {
    const input = fixture();
    const full = generateDesignMd(input);
    const capped = generateDesignMd({ ...input, maxChars: full.length - 200 });
    expect(capped.length).toBeLessThanOrEqual(full.length - 200);
    const tiny = generateDesignMd({ ...input, maxChars: 1500 });
    expect(tiny.length).toBeLessThanOrEqual(1500);
    expect(tiny).toContain('was cut to fit');
  });
});
