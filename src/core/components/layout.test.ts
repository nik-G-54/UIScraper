import { describe, expect, it } from 'vitest';
import type { StyleRecord } from '../../shared/types';
import { analyzeLayout, buildTree, computeStructureHashes, detectSections } from './index';
import { DEFAULT_TAILWIND_CONTEXT } from './tailwind';
import { emptyTokens } from '../tokens';
import { pageOf } from './fixtures';
import type { Box } from './fixtures';

const CARD: StyleRecord = {
  'background-color': 'rgb(255, 255, 255)',
  'border-top-width': '1px',
  'border-top-style': 'solid',
  'border-top-color': 'rgb(229, 231, 235)',
  'border-top-left-radius': '8px',
  'padding-top': '16px',
  'padding-right': '16px',
  'padding-bottom': '16px',
  'padding-left': '16px',
};
const BUTTON: StyleRecord = {
  'background-color': 'rgb(29, 78, 216)',
  color: 'rgb(255, 255, 255)',
  'padding-top': '8px',
  'padding-right': '16px',
  'padding-bottom': '8px',
  'padding-left': '16px',
  'border-top-left-radius': '6px',
};

const card = (x: number, style: StyleRecord = CARD, buttonStyle: StyleRecord = BUTTON): Box => ({
  tag: 'div',
  rect: [x, 700, 400, 300],
  style,
  children: [
    { tag: 'img', rect: [x, 700, 400, 160] },
    { tag: 'h3', rect: [x, 870, 400, 24], text: 'Title' },
    { tag: 'p', rect: [x, 900, 400, 48], text: 'Body text' },
    { tag: 'a', rect: [x, 960, 120, 36], text: 'Read more', style: buttonStyle, attrs: { href: '/more' } },
  ],
});

/** body > #root > [header, main > [hero, features > grid > 3 cards], footer] */
function landingPage(secondCardStyle: StyleRecord = CARD) {
  return pageOf({
    tag: 'html',
    rect: [0, 0, 1440, 1500],
    children: [
      {
        tag: 'body',
        rect: [0, 0, 1440, 1500],
        children: [
          {
            tag: 'div',
            rect: [0, 0, 1440, 1500],
            children: [
              {
                tag: 'header',
                rect: [0, 0, 1440, 72],
                style: { 'background-color': 'rgb(17, 24, 39)' },
                children: [{ tag: 'div', rect: [120, 0, 1200, 72], style: { display: 'flex', 'max-width': '1200px', 'justify-content': 'space-between' }, children: [{ tag: 'a', rect: [120, 20, 80, 32], text: 'Logo' }] }],
              },
              {
                tag: 'main',
                rect: [0, 72, 1440, 1300],
                children: [
                  { tag: 'section', rect: [0, 72, 1440, 600], children: [{ tag: 'h1', rect: [120, 200, 600, 60], text: 'Build faster' }] },
                  {
                    tag: 'section',
                    rect: [0, 672, 1440, 400],
                    style: { 'background-color': 'rgb(243, 244, 246)' },
                    children: [
                      {
                        tag: 'div',
                        rect: [120, 700, 1200, 300],
                        style: { display: 'grid', 'grid-template-columns': '400px 400px 400px', 'column-gap': '0px', 'max-width': '1200px' },
                        children: [card(120), card(520, secondCardStyle), card(920)],
                      },
                    ],
                  },
                ],
              },
              { tag: 'footer', rect: [0, 1372, 1440, 128], children: [{ tag: 'p', rect: [120, 1400, 300, 20], text: '© 2026' }] },
            ],
          },
        ],
      },
    ],
  });
}

describe('structural hashing', () => {
  it('ignores colours but not shape (and look hashes see both)', () => {
    const tree = buildTree(landingPage({ ...CARD, 'background-color': 'rgb(0, 0, 0)' }));
    const hashes = computeStructureHashes(tree, 4);
    const cards = tree.nodes.filter((n) => n.tag === 'div' && n.rect.width === 400);
    expect(cards).toHaveLength(3);
    const [a, b, c] = cards.map((n) => n.id) as [number, number, number];
    expect(hashes.structure[a]).toBe(hashes.structure[b]);
    expect(hashes.structure[a]).toBe(hashes.structure[c]);
    expect(hashes.look[a]).not.toBe(hashes.look[b]); // second card is black
    expect(hashes.look[a]).toBe(hashes.look[c]);
    const header = tree.nodes.find((n) => n.tag === 'header');
    expect(hashes.structure[header?.id ?? 0]).not.toBe(hashes.structure[a]);
  });
});

describe('component grouping', () => {
  const tokens = emptyTokens(landingPage());

  it('groups repeated structures, names them and records the look variants', () => {
    const layout = analyzeLayout(landingPage({ ...CARD, 'background-color': 'rgb(0, 0, 0)' }), tokens);
    const byKind = Object.fromEntries(layout.components.map((c) => [c.kind, c]));
    expect(byKind.card?.count).toBe(3);
    expect(byKind.card?.structure).toBe('div[img, h3, p, a]');
    expect(byKind.card?.variants).toHaveLength(1);
    expect(byKind.card?.variants[0]?.diff['background-color']).toBeDefined();
    expect(byKind.button?.count).toBe(3);
    expect(byKind.button?.text).toBe('Read more');
    expect(byKind.button?.tailwind).toContain('px-4');
  });

  it('does not invent components from one-off blocks', () => {
    const layout = analyzeLayout(landingPage(), tokens);
    expect(layout.components.every((c) => c.count >= 2)).toBe(true);
    expect(layout.components.some((c) => c.nodeId === 0)).toBe(false);
  });
});

describe('section detection', () => {
  it('finds header, hero, content section and footer in order, through wrappers and <main>', () => {
    const tree = buildTree(landingPage());
    const sections = detectSections(tree, DEFAULT_TAILWIND_CONTEXT);
    expect(sections.map((s) => s.name)).toEqual(['header', 'hero', 'section-1', 'footer']);
    expect(sections.map((s) => Math.round(s.rect.y))).toEqual([0, 72, 672, 1372]);
  });

  it('summarizes the layout and resolves backgrounds', () => {
    const sections = detectSections(buildTree(landingPage()), DEFAULT_TAILWIND_CONTEXT);
    const [header, , features] = sections;
    expect(header?.layout).toMatchObject({ display: 'flex', containerMaxWidth: 1200, alignment: 'center' });
    expect(header?.background.hex).toBe('#111827');
    expect(features?.layout).toMatchObject({ display: 'grid', columns: 3, containerMaxWidth: 1200 });
    expect(features?.background.hex).toBe('#f3f4f6');
    expect(sections.at(-1)?.background.hex).toBe('#ffffff'); // inferred page background
  });
});
