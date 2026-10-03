// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { IframeDefaultStyles } from './defaults';
import { STYLE_PROPERTIES } from './styleProps';
import { diffStyles, pruneInvisibleDetails, readAllStyles, StyleTable } from './styles';

describe('STYLE_PROPERTIES whitelist', () => {
  it('has no duplicates and only lowercase longhand-style names', () => {
    expect(new Set(STYLE_PROPERTIES).size).toBe(STYLE_PROPERTIES.length);
    for (const property of STYLE_PROPERTIES) expect(property).toMatch(/^-?[a-z]+(-[a-z]+)*$/);
  });

  it('covers every design-relevant group', () => {
    const expected = [
      'display', 'position', 'z-index', 'flex-direction', 'grid-template-columns', 'margin-top', 'padding-left',
      'min-width', 'font-family', 'font-size', 'line-height', 'color', 'background-color', 'background-image',
      'border-top-width', 'border-top-left-radius', 'box-shadow', 'text-shadow', 'opacity', 'filter',
      'backdrop-filter', 'transform', 'transition-duration', 'animation-name', 'animation-duration',
      'object-fit', 'cursor', 'list-style-type',
    ];
    for (const property of expected) expect(STYLE_PROPERTIES).toContain(property);
  });

  it.each(['min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'box-sizing'])(
    'captures the sizing property %s',
    (property) => {
      expect(STYLE_PROPERTIES).toContain(property);
    },
  );

  it('leaves out used-value width/height (the rect already has them)', () => {
    expect(STYLE_PROPERTIES).not.toContain('width');
    expect(STYLE_PROPERTIES).not.toContain('height');
  });
});

describe('diffStyles', () => {
  const values: Record<string, string> = {
    display: 'flex',
    color: 'rgb(0, 0, 0)',
    'font-size': '20px',
    'not-whitelisted': 'x',
    cursor: '',
  };
  const read = (property: string) => values[property] ?? '';

  it('keeps only whitelisted properties that differ from the defaults', () => {
    const style = diffStyles(read, ['display', 'color', 'font-size', 'cursor', 'opacity'], {
      display: 'block',
      color: 'rgb(0, 0, 0)',
      'font-size': '16px',
    });
    expect(style).toEqual({ display: 'flex', 'font-size': '20px' });
  });

  it('never reads properties outside the list it was given', () => {
    const style = diffStyles(read, ['display'], {});
    expect(style).not.toHaveProperty('not-whitelisted');
  });

  it('records everything when there are no defaults, but drops empty values', () => {
    expect(diffStyles(read, ['display', 'color', 'cursor'], {})).toEqual({
      display: 'flex',
      color: 'rgb(0, 0, 0)',
    });
  });

  it('produces an empty record when everything is default', () => {
    expect(diffStyles(read, ['display', 'color'], { display: 'flex', color: 'rgb(0, 0, 0)' })).toEqual({});
  });

  it('is stable in whitelist order (equal styles serialize identically)', () => {
    const a = diffStyles(read, ['display', 'color'], {});
    const b = diffStyles((p) => ({ color: 'rgb(0, 0, 0)', display: 'flex' })[p as 'color'] ?? '', ['display', 'color'], {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('pruneInvisibleDetails', () => {
  const colors = {
    'border-top-color': 'rgb(1, 1, 1)',
    'border-right-color': 'rgb(1, 1, 1)',
    'border-bottom-color': 'rgb(1, 1, 1)',
    'border-left-color': 'rgb(1, 1, 1)',
  };

  it('drops border colours when there is no border (style absent = default none)', () => {
    const out = pruneInvisibleDetails({ ...colors, color: 'red' }, { 'border-top-style': 'none', 'border-left-style': 'none' });
    expect(out).toEqual({
      'border-right-color': 'rgb(1, 1, 1)',
      'border-bottom-color': 'rgb(1, 1, 1)',
      color: 'red',
    });
    // right/bottom styles are unknown (neither set nor in defaults) so their colours stay
  });

  it('keeps the colour of a side that has a border', () => {
    const out = pruneInvisibleDetails(
      { 'border-top-style': 'solid', 'border-top-color': 'rgb(9, 9, 9)', 'border-left-color': 'rgb(9, 9, 9)' },
      { 'border-left-style': 'none' },
    );
    expect(out).toEqual({ 'border-top-style': 'solid', 'border-top-color': 'rgb(9, 9, 9)' });
  });

  it('drops hidden-border colours too', () => {
    expect(pruneInvisibleDetails({ 'border-top-style': 'hidden', 'border-top-color': 'x' }, {})).toEqual({
      'border-top-style': 'hidden',
    });
  });

  it('drops text-decoration colour/style when there is no decoration', () => {
    const out = pruneInvisibleDetails(
      { 'text-decoration-color': 'red', 'text-decoration-style': 'solid', color: 'red' },
      { 'text-decoration-line': 'none' },
    );
    expect(out).toEqual({ color: 'red' });
  });

  it('keeps the decoration colour of an element that is underlined by default (e.g. a link)', () => {
    const out = pruneInvisibleDetails({ 'text-decoration-color': 'rgb(0, 0, 238)' }, { 'text-decoration-line': 'underline' });
    expect(out).toEqual({ 'text-decoration-color': 'rgb(0, 0, 238)' });
  });

  it('respects an explicit text-decoration-line: none override', () => {
    const out = pruneInvisibleDetails(
      { 'text-decoration-line': 'none', 'text-decoration-color': 'red' },
      { 'text-decoration-line': 'underline' },
    );
    expect(out).toEqual({ 'text-decoration-line': 'none' });
  });

  it('makes differently-coloured but equally-invisible borders share one style', () => {
    const table = new StyleTable();
    const a = table.intern(pruneInvisibleDetails({ ...colors, display: 'flex' }, { 'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none' }));
    const b = table.intern(pruneInvisibleDetails({ display: 'flex' }, {}));
    expect(a).toBe(b);
  });
});

describe('readAllStyles', () => {
  it('reads every property and skips empty values', () => {
    expect(readAllStyles((p) => (p === 'a' ? '1' : ''), ['a', 'b'])).toEqual({ a: '1' });
  });
});

describe('StyleTable', () => {
  it('interns identical styles to the same id', () => {
    const table = new StyleTable();
    const a = table.intern({ display: 'flex', color: 'red' });
    const b = table.intern({ display: 'block' });
    const c = table.intern({ display: 'flex', color: 'red' });
    expect(a).toBe(c);
    expect(b).not.toBe(a);
    expect(table.size).toBe(2);
    expect(table.toArray()).toEqual([{ display: 'flex', color: 'red' }, { display: 'block' }]);
  });

  it('gives the empty style one id too', () => {
    const table = new StyleTable();
    expect(table.intern({})).toBe(table.intern({}));
    expect(table.size).toBe(1);
  });

  it('assigns ids in insertion order', () => {
    const table = new StyleTable();
    expect([table.intern({ a: '1' }), table.intern({ a: '2' }), table.intern({ a: '1' })]).toEqual([0, 1, 0]);
  });
});

describe('IframeDefaultStyles', () => {
  it('computes defaults per tag in a temporary iframe and removes it on dispose', () => {
    const defaults = new IframeDefaultStyles(document, ['display']);
    const div = document.createElement('div');
    const span = document.createElement('span');

    expect(defaults.forElement(div).display).toBe('block');
    expect(defaults.forElement(span).display).toBe('inline');
    expect(defaults.forPseudo().display).toBe('inline');
    expect(defaults.problem).toBeNull();
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(defaults.owns(document.querySelector('iframe') as Element)).toBe(true);
    expect(defaults.owns(div)).toBe(false);

    defaults.dispose();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    defaults.dispose(); // idempotent
  });

  it('caches per tag', () => {
    const defaults = new IframeDefaultStyles(document, ['display']);
    const first = defaults.forElement(document.createElement('div'));
    expect(defaults.forElement(document.createElement('div'))).toBe(first);
    defaults.dispose();
  });

  it('degrades to "record everything" with a problem message if the iframe is unusable', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', { configurable: true, get: () => null });
    try {
      const defaults = new IframeDefaultStyles(document, ['display']);
      expect(defaults.forElement(document.createElement('div'))).toEqual({});
      expect(defaults.problem).toMatch(/default styles/i);
      defaults.dispose();
      expect(document.querySelectorAll('iframe')).toHaveLength(0);
    } finally {
      if (original) Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', original);
    }
  });
});
