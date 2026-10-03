import { describe, expect, it } from 'vitest';
import { collectAttributes, isSameOrigin, resolveSrcset, resolveUrl, trimText } from './text';

const BASE = 'https://example.com/a/b/page.html';

describe('trimText', () => {
  it('collapses whitespace and trims', () => {
    expect(trimText('  Hello \n\t  world  ', 100)).toBe('Hello world');
  });

  it('returns an empty string for whitespace only', () => {
    expect(trimText(' \n ', 10)).toBe('');
  });

  it('leaves text at exactly the limit alone', () => {
    expect(trimText('abcde', 5)).toBe('abcde');
  });

  it('cuts long text to the limit, ending with an ellipsis', () => {
    const out = trimText('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out).toHaveLength(5);
  });

  it('does not split a surrogate pair', () => {
    const out = trimText('ab😀cd', 4); // 😀 is two UTF-16 units; cutting at 3 would split it
    expect(out).toBe('ab…');
  });
});

describe('resolveUrl', () => {
  it.each([
    ['/img/logo.png', 'https://example.com/img/logo.png'],
    ['logo.png', 'https://example.com/a/b/logo.png'],
    ['../up.png', 'https://example.com/a/up.png'],
    ['//cdn.example.org/x.js', 'https://cdn.example.org/x.js'],
    ['#section', 'https://example.com/a/b/page.html#section'],
    ['?q=1', 'https://example.com/a/b/page.html?q=1'],
    ['https://other.test/x', 'https://other.test/x'],
    ['mailto:me@example.com', 'mailto:me@example.com'],
  ])('resolves %s', (raw, expected) => {
    expect(resolveUrl(raw, BASE, 500)).toBe(expected);
  });

  it('trims and returns empty for blank values', () => {
    expect(resolveUrl('  /x  ', BASE, 500)).toBe('https://example.com/x');
    expect(resolveUrl('   ', BASE, 500)).toBe('');
  });

  it('resolves against the given base (e.g. a <base href>)', () => {
    expect(resolveUrl('x.png', 'https://cdn.test/assets/', 500)).toBe('https://cdn.test/assets/x.png');
  });

  it('shortens huge data: URIs but keeps their type', () => {
    const data = `data:image/png;base64,${'A'.repeat(5000)}`;
    const out = resolveUrl(data, BASE, 200);
    expect(out.startsWith('data:image/png;base64,')).toBe(true);
    expect(out).toContain('chars truncated');
    expect(out.length).toBeLessThan(200);
  });

  it('keeps small data: URIs intact', () => {
    expect(resolveUrl('data:text/plain,hi', BASE, 200)).toBe('data:text/plain,hi');
  });

  it('caps very long ordinary URLs', () => {
    expect(resolveUrl(`/${'a'.repeat(1000)}`, BASE, 100).length).toBeLessThanOrEqual(100);
  });
});

describe('resolveSrcset', () => {
  it('resolves each candidate and keeps descriptors', () => {
    expect(resolveSrcset('a.png 1x, /b.png 2x', BASE, 500)).toBe(
      'https://example.com/a/b/a.png 1x, https://example.com/b.png 2x',
    );
  });

  it('handles width descriptors and irregular spacing', () => {
    expect(resolveSrcset('  small.jpg   480w ,large.jpg 800w  ', BASE, 500)).toBe(
      'https://example.com/a/b/small.jpg 480w, https://example.com/a/b/large.jpg 800w',
    );
  });

  it('handles candidates without descriptors', () => {
    expect(resolveSrcset('a.png, b.png', BASE, 500)).toBe('https://example.com/a/b/a.png, https://example.com/a/b/b.png');
  });

  it('returns an empty string for an empty srcset', () => {
    expect(resolveSrcset('  ', BASE, 500)).toBe('');
  });
});

describe('collectAttributes', () => {
  const attrsOf = (map: Record<string, string>) => (name: string) => map[name] ?? null;

  it('keeps only the allow-listed attributes', () => {
    const out = collectAttributes(
      attrsOf({ id: 'hero', role: 'banner', class: 'css-1x2y3z', style: 'color:red', 'data-foo': 'bar', alt: 'A logo' }),
      BASE,
      100,
    );
    expect(out).toEqual({ id: 'hero', role: 'banner', alt: 'A logo' });
  });

  it('resolves href, src and data-src to absolute URLs and srcset entries too', () => {
    const out = collectAttributes(
      attrsOf({ href: '/pricing', src: 'img.png', 'data-src': 'lazy.png', srcset: 'a.png 1x' }),
      BASE,
      200,
    );
    expect(out).toEqual({
      href: 'https://example.com/pricing',
      src: 'https://example.com/a/b/img.png',
      'data-src': 'https://example.com/a/b/lazy.png',
      srcset: 'https://example.com/a/b/a.png 1x',
    });
  });

  it('trims long free-text attributes', () => {
    const out = collectAttributes(attrsOf({ title: 'x'.repeat(50) }), BASE, 10);
    expect(out?.title).toHaveLength(10);
  });

  it('returns undefined when there is nothing to keep', () => {
    expect(collectAttributes(attrsOf({ class: 'x' }), BASE, 100)).toBeUndefined();
  });

  it('keeps empty-string attributes (e.g. alt="")', () => {
    expect(collectAttributes(attrsOf({ alt: '' }), BASE, 100)).toEqual({ alt: '' });
  });

  it('never looks at class names', () => {
    const seen: string[] = [];
    collectAttributes((name) => (seen.push(name), null), BASE, 100);
    expect(seen).not.toContain('class');
  });
});

describe('isSameOrigin', () => {
  it('compares origins', () => {
    expect(isSameOrigin('https://example.com/x', 'https://example.com/y')).toBe(true);
    expect(isSameOrigin('/x', 'https://example.com/y')).toBe(true);
    expect(isSameOrigin('https://other.com/x', 'https://example.com/y')).toBe(false);
    expect(isSameOrigin('http://example.com/x', 'https://example.com/y')).toBe(false);
    expect(isSameOrigin('https://example.com:8443/x', 'https://example.com/y')).toBe(false);
  });

  it('treats about:/data:/blob: documents as same-origin', () => {
    expect(isSameOrigin('about:blank', 'https://example.com/')).toBe(true);
    expect(isSameOrigin('data:text/html,hi', 'https://example.com/')).toBe(true);
  });
});
