import { describe, expect, it } from 'vitest';
import type { StyleRecord } from '../../shared/types';
import { pageOf } from './fixtures';
import type { Box } from './fixtures';
import { analyzeLayout, buildTree, findDecorativeLines, selectKeyElements } from './index';
import { describeRadius, radiusInfo } from './radius';
import { DEFAULT_TAILWIND_CONTEXT } from './tailwind';
import { emptyTokens } from '../tokens';

const H1: StyleRecord = { 'font-size': '56px', 'font-weight': '500', 'line-height': '60px', 'letter-spacing': '-1.4px', color: 'rgb(6, 27, 49)' };
const SPAN: StyleRecord = { ...H1, 'font-weight': '300', color: 'rgb(66, 84, 102)' };
const BUTTON: StyleRecord = {
  'background-color': 'rgb(83, 58, 253)',
  color: 'rgb(255, 255, 255)',
  'padding-top': '8px',
  'padding-right': '16px',
  'padding-bottom': '8px',
  'padding-left': '16px',
  'border-top-left-radius': '4px',
  'border-top-right-radius': '4px',
  'border-bottom-right-radius': '4px',
  'border-bottom-left-radius': '4px',
};
const LINE: StyleRecord = { 'background-color': 'rgb(229, 237, 245)' };
const SOLID = 'solid';

function heroPage(extra: Box[] = []) {
  return pageOf({
    tag: 'html',
    rect: [0, 0, 1440, 1000],
    children: [
      {
        tag: 'body',
        rect: [0, 0, 1440, 1000],
        children: [
          {
            tag: 'section',
            rect: [0, 0, 1440, 600],
            children: [
              // Listed out of reading order on purpose.
              { tag: 'a', rect: [190, 400, 120, 36], text: 'Get started', style: BUTTON, attrs: { href: '/start' } },
              { tag: 'p', rect: [190, 300, 500, 48], text: 'Millions of companies of all sizes use the platform.', style: { 'font-size': '18px' } },
              {
                tag: 'h1',
                rect: [190, 100, 800, 120],
                text: 'Financial infrastructure to grow your revenue.',
                style: H1,
                children: [{ tag: 'span', rect: [190, 160, 700, 60], text: 'Accept payments online.', style: SPAN }],
              },
              { tag: 'a', rect: [20, 10, 60, 20], text: 'Pricing', attrs: { href: '/pricing' } },
              { tag: 'div', rect: [190, 0, 1, 600], style: LINE },
              { tag: 'div', rect: [1707, 0, 1, 600], style: LINE },
              ...extra,
            ],
          },
          { tag: 'footer', rect: [0, 900, 1440, 100] },
        ],
      },
    ],
  });
}

const ctx = DEFAULT_TAILWIND_CONTEXT;
function hero(extra: Box[] = []) {
  const capture = heroPage(extra);
  const layout = analyzeLayout(capture, emptyTokens(capture));
  const section = layout.sections.find((s) => s.tag === 'section');
  if (!section) throw new Error('no section');
  return { tree: buildTree(capture), section, layout };
}

describe('selectKeyElements', () => {
  it('lists headings, paragraphs and buttons in reading order, and skips plain nav links', () => {
    const { section } = hero();
    expect(section.keyElements.map((e) => [e.role, e.tag])).toEqual([
      ['heading', 'h1'],
      ['paragraph', 'p'],
      ['button', 'a'],
    ]);
    const [h1, p, button] = section.keyElements;
    expect(h1).toMatchObject({ fontSizePx: 56, fontWeight: '500', lineHeight: '60px', letterSpacing: '-1.4px' });
    expect(p).toMatchObject({ fontSizePx: 18 });
    expect(button).toMatchObject({ background: { hex: '#533afd' }, color: { hex: '#ffffff' }, radius: '4px', padding: '8px 16px', pill: false });
    expect(button?.tailwind).toContain('rounded-sm');
  });

  it('keeps the most important elements when the cap is small, still in reading order', () => {
    const { tree, section } = hero();
    const picked = selectKeyElements(tree, section, ctx, 2);
    // Headings rank first, then buttons; the paragraph is dropped. Output stays top to bottom.
    expect(picked.map((e) => e.role)).toEqual(['heading', 'button']);
  });

  it('puts elements on the same row left to right', () => {
    const { tree, section } = hero([{ tag: 'a', rect: [330, 402, 120, 36], text: 'Contact sales', style: BUTTON, attrs: { href: '/c' } }]);
    const buttons = selectKeyElements(tree, section, ctx).filter((e) => e.role === 'button');
    expect(buttons.map((b) => b.text)).toEqual(['Get started', 'Contact sales']);
  });
});

describe('inline text runs', () => {
  it('lists the runs of a heading whose span has another colour and weight', () => {
    const { section } = hero();
    const h1 = section.keyElements[0];
    expect(h1?.runs.map((r) => [r.text, r.color, r.fontWeight])).toEqual([
      ['Financial infrastructure to grow your revenue.', '#061b31', '500'],
      ['Accept payments online.', '#425466', '300'],
    ]);
    expect(h1?.text).toBe('Financial infrastructure to grow your revenue. Accept payments online.');
  });

  it('reports no runs when every span looks like its parent', () => {
    const page = pageOf({
      tag: 'html',
      rect: [0, 0, 1440, 800],
      children: [
        {
          tag: 'body',
          rect: [0, 0, 1440, 800],
          children: [
            {
              tag: 'section',
              rect: [0, 0, 1440, 600],
              children: [{ tag: 'h2', rect: [100, 100, 600, 40], text: 'Same', style: H1, children: [{ tag: 'span', rect: [200, 100, 100, 40], text: 'look', style: H1 }] }],
            },
            { tag: 'footer', rect: [0, 700, 1440, 100] },
          ],
        },
      ],
    });
    const layout = analyzeLayout(page, emptyTokens(page));
    const h2 = layout.sections.find((s) => s.tag === 'section')?.keyElements[0];
    expect(h2?.runs).toEqual([]);
    expect(h2?.text).toBe('Same look');
  });
});

describe('decorative lines', () => {
  it('finds hairline boxes and border-only dividers, but not content boxes', () => {
    const outline: StyleRecord = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      outline[`border-${side}-width`] = '1px';
      outline[`border-${side}-style`] = SOLID;
      outline[`border-${side}-color`] = 'rgb(0, 0, 0)';
    }
    const { tree, section } = hero([
      { tag: 'div', rect: [900, 0, 40, 500], style: { 'border-left-width': '1px', 'border-left-style': SOLID, 'border-left-color': 'rgb(200, 200, 200)' } },
      { tag: 'div', rect: [0, 590, 1440, 1], style: { 'border-top-width': '1px', 'border-top-style': SOLID, 'border-top-color': 'rgb(229, 237, 245)' } },
      // An outlined card (four borders) and a filled panel are not lines.
      { tag: 'div', rect: [400, 450, 200, 100], style: outline },
      { tag: 'div', rect: [700, 450, 100, 100], style: { 'background-color': 'rgb(240, 240, 240)' } },
    ]);
    const lines = findDecorativeLines(tree, tree.nodes[section.nodeId] as never);
    expect(lines.map((l) => [l.orientation, l.at, l.thicknessPx, l.color])).toEqual([
      ['vertical', 190, 1, '#e5edf5'],
      ['vertical', 900, 1, '#c8c8c8'],
      ['vertical', 1707, 1, '#e5edf5'],
      ['horizontal', 590, 1, '#e5edf5'],
    ]);
    expect(section.geometry.lines).toHaveLength(4);
  });

  it('records the container geometry', () => {
    const { section } = hero();
    expect(section.geometry.inkLeft).toBe(20);
    expect(section.geometry.inkRight).toBe(990);
    expect(section.geometry.contentWidth).toBeGreaterThan(0);
  });
});

describe('radiusInfo', () => {
  const radius = (value: string): StyleRecord => ({
    'border-top-left-radius': value,
    'border-top-right-radius': value,
    'border-bottom-right-radius': value,
    'border-bottom-left-radius': value,
  });

  it('calls a radius a pill only when it is at least half the height', () => {
    expect(radiusInfo(radius('18px'), { height: 36 })).toEqual({ value: '18px', pill: true });
    expect(radiusInfo(radius('9999px'), { height: 36 })).toEqual({ value: '9999px', pill: true });
    expect(radiusInfo(radius('12px'), { height: 200 })).toEqual({ value: '12px', pill: false });
    expect(radiusInfo(radius('17px'), { height: 36 }).pill).toBe(false);
    expect(radiusInfo(radius('50%'), { height: 40 }).pill).toBe(true);
    expect(radiusInfo(radius('20%'), { height: 40 }).pill).toBe(false);
  });

  it('keeps mixed corners exact and treats zero as square', () => {
    const mixed = { ...radius('0px'), 'border-top-left-radius': '8px', 'border-top-right-radius': '8px' };
    expect(radiusInfo(mixed, { height: 40 })).toEqual({ value: '8px 8px 0px 0px', pill: false });
    expect(radiusInfo({}, { height: 40 })).toEqual({ value: null, pill: false });
    expect(describeRadius({ value: '9999px', pill: true })).toBe('9999px (pill)');
    expect(describeRadius({ value: null, pill: false })).toBe('none');
  });
});
