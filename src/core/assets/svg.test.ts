import { describe, expect, it } from 'vitest';
import { sanitizeSvg, svgHash } from './svg';

describe('sanitizeSvg', () => {
  it('removes scripts, event handlers, script links and foreignObject, and keeps the drawing', () => {
    const dirty =
      '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><path d="M0 0h24v24H0z" onclick=\'x()\'/></a>' +
      '<foreignObject><div>hi</div></foreignObject><use xlink:href="data:text/html;base64,AAAA"/></svg>';
    const clean = sanitizeSvg(dirty, 5000) as string;
    expect(clean).not.toMatch(/script|onload|onclick|javascript|foreignObject|data:text/i);
    expect(clean).toContain('<path d="M0 0h24v24H0z"');
    expect(clean).toContain('viewBox="0 0 24 24"');
  });

  it('defeats nested and slash-separated tricks', () => {
    const clean = sanitizeSvg('<svg/onload=alert(1)><scr<script>ipt>alert(1)</scr</script>ipt><circle r="1"/></svg>', 5000) as string;
    expect(clean).not.toMatch(/<script|onload/i);
    expect(clean).toContain('<circle r="1"/>');
  });

  it('adds the SVG namespace so the file opens standalone', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', 5000)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
    const already = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    expect(sanitizeSvg(already, 5000)).toBe(already);
  });

  it('rejects non-SVG input and oversized markup', () => {
    expect(sanitizeSvg('<div><svg></svg></div>', 5000)).toBeNull();
    expect(sanitizeSvg('<script>alert(1)</script>', 5000)).toBeNull();
    expect(sanitizeSvg(`<svg>${'<path d="M0 0"/>'.repeat(100)}</svg>`, 200)).toBeNull();
  });
});

describe('svgHash', () => {
  it('is the same for markup that differs only in whitespace', () => {
    expect(svgHash('<svg><path d="M0 0"/>\n  <path d="M1 1"/></svg>')).toBe(svgHash('<svg><path d="M0 0"/><path d="M1 1"/></svg>'));
    expect(svgHash('<svg><path d="M0 0"/></svg>')).not.toBe(svgHash('<svg><path d="M9 9"/></svg>'));
  });
});
