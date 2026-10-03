import { describe, expect, it } from 'vitest';
import { buildColorTokens } from './color';
import { buildGradients, gradientLayers, parseGradient } from './gradient';
import { captureOf } from './fixtures';

describe('parseGradient', () => {
  it('keeps the raw value and the colour stops with their positions', () => {
    const g = parseGradient('linear-gradient(rgb(255, 0, 0) 0%, rgba(0, 0, 255, 0.5) 100%)');
    expect(g).toMatchObject({ kind: 'linear', repeating: false });
    expect(g?.value).toBe('linear-gradient(rgb(255, 0, 0) 0%, rgba(0, 0, 255, 0.5) 100%)');
    expect(g?.stops).toEqual([
      { color: '#ff0000', position: '0%' },
      { color: '#0000ff80', position: '100%' },
    ]);
  });

  it('skips the direction/shape argument and handles other kinds', () => {
    expect(parseGradient('linear-gradient(to right, rgb(0, 0, 0), rgba(0, 0, 0, 0))')?.stops).toEqual([
      { color: '#000000', position: null },
      { color: 'transparent', position: null },
    ]);
    expect(parseGradient('radial-gradient(circle at 50% 50%, rgb(255, 255, 255) 10px, rgb(0, 0, 0) 50%)')).toMatchObject({ kind: 'radial' });
    expect(parseGradient('repeating-conic-gradient(from 0deg, rgb(0, 0, 0), rgb(255, 255, 255) 25%)')).toMatchObject({ kind: 'conic', repeating: true });
    expect(parseGradient('url("https://x.test/a.png")')).toBeNull();
  });
});

describe('gradients as tokens', () => {
  const g1 = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
  const capture = captureOf([
    { tag: 'div', style: { 'background-image': `url("https://x.test/a.png"), ${g1}` } },
    { tag: 'section', style: { 'background-image': g1 } },
    { tag: 'p', text: 'hi', style: {} },
  ]);

  it('splits mixed backgrounds and counts usage per distinct gradient', () => {
    expect(gradientLayers(`url("a.png"), ${g1}`)).toEqual([g1]);
    const gradients = buildGradients(capture);
    expect(gradients).toHaveLength(1);
    expect(gradients[0]).toMatchObject({ value: g1, count: 2, kind: 'linear' });
  });

  it('feeds stop colours into the palette as low-weight, gradient-only sources', () => {
    const colors = buildColorTokens(capture, [], buildGradients(capture));
    const red = colors.find((c) => c.hex === '#ff0000');
    expect(red).toBeDefined();
    expect(red?.uses).toMatchObject({ gradient: 2, text: 0, background: 0 });
    expect(red?.area).toBe(0);
  });
});
