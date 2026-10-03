// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { probePage } from './probe';
import { parsePageProbeData } from './validate';

describe('probePage', () => {
  it('reports page metrics without modifying the DOM', () => {
    document.title = 'Probe test';
    document.body.innerHTML = '<main><p>a</p><p>b</p></main>';
    const before = document.documentElement.outerHTML;

    const result = probePage();

    expect(result.title).toBe('Probe test');
    expect(result.url).toBe(location.href);
    expect(result.nodeCount).toBe(document.getElementsByTagName('*').length);
    expect(result.nodeCount).toBeGreaterThanOrEqual(5);
    expect(result.viewportWidth).toBe(window.innerWidth);
    expect(result.viewportHeight).toBe(window.innerHeight);
    expect(result.devicePixelRatio).toBe(window.devicePixelRatio);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('is JSON-serializable and passes validation', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(probePage()));
    expect(parsePageProbeData(roundTripped)).not.toBeNull();
  });
});

describe('parsePageProbeData', () => {
  const valid = {
    title: 't',
    url: 'https://example.com',
    nodeCount: 1,
    viewportWidth: 1,
    viewportHeight: 1,
    devicePixelRatio: 2,
    documentHeight: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a well-formed result', () => {
    expect(parsePageProbeData(valid)).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['missing title', { ...valid, title: undefined }],
    ['non-numeric count', { ...valid, nodeCount: '3' }],
    ['NaN dimension', { ...valid, documentHeight: NaN }],
  ])('rejects %s', (_label, raw) => {
    expect(parsePageProbeData(raw)).toBeNull();
  });
});
