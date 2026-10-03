import { describe, expect, it } from 'vitest';
import { classifyVisibility, isIgnoredTag, PLACEHOLDER_TAGS } from './rules';
import type { VisibilityInput } from './rules';

const visible: VisibilityInput = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  width: 100,
  height: 20,
  ancestorOpacityZero: false,
};

describe('isIgnoredTag', () => {
  it.each(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link'])('ignores <%s>', (tag) => {
    expect(isIgnoredTag(tag)).toBe(true);
  });

  it.each(['div', 'svg', 'iframe', 'a', 'my-element'])('keeps <%s>', (tag) => {
    expect(isIgnoredTag(tag)).toBe(false);
  });
});

describe('PLACEHOLDER_TAGS', () => {
  it('is iframe, canvas, video, embed and object', () => {
    expect([...PLACEHOLDER_TAGS].sort()).toEqual(['canvas', 'embed', 'iframe', 'object', 'video']);
  });
});

describe('classifyVisibility', () => {
  it('treats a normal element as visible', () => {
    expect(classifyVisibility(visible)).toEqual({ kind: 'visible' });
  });

  it('skips display:none (the caller does not descend)', () => {
    expect(classifyVisibility({ ...visible, display: 'none' })).toEqual({ kind: 'display-none' });
  });

  it('display:none wins over everything else', () => {
    expect(classifyVisibility({ ...visible, display: 'none', opacity: '0', width: 0, height: 0 })).toEqual({
      kind: 'display-none',
    });
  });

  it.each(['hidden', 'collapse'])('marks visibility:%s as hidden', (value) => {
    expect(classifyVisibility({ ...visible, visibility: value })).toEqual({
      kind: 'hidden',
      reason: 'visibility-hidden',
    });
  });

  it.each(['0', '0.0', '0.00'])('marks opacity %s as hidden', (opacity) => {
    expect(classifyVisibility({ ...visible, opacity })).toEqual({ kind: 'hidden', reason: 'opacity-0' });
  });

  it('keeps nearly-transparent elements visible', () => {
    expect(classifyVisibility({ ...visible, opacity: '0.01' })).toEqual({ kind: 'visible' });
  });

  it('marks descendants of an opacity-0 element as hidden', () => {
    expect(classifyVisibility({ ...visible, ancestorOpacityZero: true })).toEqual({
      kind: 'hidden',
      reason: 'ancestor-opacity-0',
    });
  });

  it.each([
    [0, 20],
    [100, 0],
    [0, 0],
  ])('marks a %i x %i box as zero-size', (width, height) => {
    expect(classifyVisibility({ ...visible, width, height })).toEqual({ kind: 'hidden', reason: 'zero-size' });
  });

  it('does not call display:contents zero-size (it has no box by design)', () => {
    expect(classifyVisibility({ ...visible, display: 'contents', width: 0, height: 0 })).toEqual({ kind: 'visible' });
  });

  it('reports visibility before opacity before size', () => {
    expect(classifyVisibility({ ...visible, visibility: 'hidden', opacity: '0', width: 0, height: 0 })).toEqual({
      kind: 'hidden',
      reason: 'visibility-hidden',
    });
    expect(classifyVisibility({ ...visible, opacity: '0', width: 0, height: 0 })).toEqual({
      kind: 'hidden',
      reason: 'opacity-0',
    });
  });
});
