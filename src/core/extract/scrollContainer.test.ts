import { describe, expect, it } from 'vitest';
import { containerDescriptor, pickScrollContainer, visibleArea } from './scrollContainer';
import type { ScrollCandidate } from './scrollContainer';

const viewport = { width: 1000, height: 800 };
const MIN = 100;

let counter = 0;
const candidate = (overrides: Partial<ScrollCandidate<string>> = {}): ScrollCandidate<string> => ({
  handle: `el-${++counter}`,
  tag: 'div',
  overflowY: 'auto',
  clientHeight: 700,
  scrollHeight: 3000,
  rect: { left: 0, top: 0, width: 1000, height: 700 },
  rendered: true,
  ...overrides,
});
const pick = (...cs: ScrollCandidate<string>[]) => pickScrollContainer(cs, viewport, MIN)?.handle ?? null;

describe('visibleArea', () => {
  it('is the full area for an element inside the viewport', () => {
    expect(visibleArea({ left: 10, top: 10, width: 100, height: 50 }, viewport)).toBe(5000);
  });

  it('clips to the viewport and is 0 when entirely outside', () => {
    expect(visibleArea({ left: 900, top: 700, width: 200, height: 200 }, viewport)).toBe(100 * 100);
    expect(visibleArea({ left: 2000, top: 0, width: 100, height: 100 }, viewport)).toBe(0);
    expect(visibleArea({ left: 0, top: -500, width: 100, height: 100 }, viewport)).toBe(0);
  });
});

describe('pickScrollContainer', () => {
  it('picks a scrollable element whose content clearly overflows', () => {
    const main = candidate({ handle: 'main' });
    expect(pick(main)).toBe('main');
  });

  it('picks the one with the largest visible area', () => {
    const sidebar = candidate({ handle: 'sidebar', rect: { left: 0, top: 0, width: 250, height: 800 } });
    const content = candidate({ handle: 'content', rect: { left: 250, top: 0, width: 750, height: 800 } });
    const tiny = candidate({ handle: 'dropdown', rect: { left: 0, top: 0, width: 100, height: 100 } });
    expect(pick(sidebar, tiny, content)).toBe('content');
  });

  it('measures the VISIBLE area, so a huge but mostly off-screen element loses', () => {
    const offscreen = candidate({ handle: 'offscreen', rect: { left: 900, top: 700, width: 5000, height: 5000 } }); // 100x100 visible
    const onscreen = candidate({ handle: 'onscreen', rect: { left: 0, top: 0, width: 400, height: 400 } });
    expect(pick(offscreen, onscreen)).toBe('onscreen');
  });

  it.each(['auto', 'scroll', 'overlay'])('accepts overflow-y: %s', (overflowY) => {
    expect(pick(candidate({ overflowY }))).not.toBeNull();
  });

  it.each(['visible', 'hidden', 'clip'])('ignores overflow-y: %s', (overflowY) => {
    expect(pick(candidate({ overflowY }))).toBeNull();
  });

  it('ignores elements whose content barely overflows', () => {
    expect(pick(candidate({ clientHeight: 700, scrollHeight: 750 }))).toBeNull(); // 50px < 100px
    expect(pick(candidate({ clientHeight: 700, scrollHeight: 799 }))).toBeNull();
  });

  it('accepts overflow exactly at the threshold', () => {
    expect(pick(candidate({ clientHeight: 700, scrollHeight: 800 }))).not.toBeNull();
  });

  it('ignores elements that are not rendered or have no height', () => {
    expect(pick(candidate({ rendered: false }))).toBeNull();
    expect(pick(candidate({ clientHeight: 0, scrollHeight: 500 }))).toBeNull();
  });

  it('ignores elements entirely outside the viewport', () => {
    expect(pick(candidate({ rect: { left: 0, top: 5000, width: 500, height: 500 } }))).toBeNull();
  });

  it('skips unsuitable big elements in favour of a suitable smaller one', () => {
    const hiddenOverflow = candidate({ handle: 'big-but-hidden', overflowY: 'hidden', rect: { left: 0, top: 0, width: 1000, height: 800 } });
    const real = candidate({ handle: 'real', rect: { left: 0, top: 0, width: 300, height: 300 } });
    expect(pick(hiddenOverflow, real)).toBe('real');
  });

  it('breaks ties in favour of the earlier candidate', () => {
    const a = candidate({ handle: 'a' });
    const b = candidate({ handle: 'b' });
    expect(pick(a, b)).toBe('a');
  });

  it('returns null with no candidates, and honours a custom threshold', () => {
    expect(pick()).toBeNull();
    expect(pickScrollContainer([candidate({ scrollHeight: 750 })], viewport, 40)).not.toBeNull();
  });

  it('never looks at class names (the candidate type has none)', () => {
    expect(Object.keys(candidate())).not.toContain('className');
  });
});

describe('containerDescriptor', () => {
  it('is tag + depth', () => {
    expect(containerDescriptor('main', 3)).toBe('main (depth 3)');
    expect(containerDescriptor('div', 0)).toBe('div (depth 0)');
  });
});
