import { describe, expect, it } from 'vitest';
import { isPossibleOverlay, viewportCoverage } from './overlay';
import type { OverlayInput } from './overlay';

const tuning = { overlayMinZIndex: 100, overlayMinViewportCoverage: 0.25 };
const viewport = { width: 1000, height: 800 };
const full = { x: 0, y: 0, width: 1000, height: 800 };

const base: OverlayInput = { position: 'fixed', zIndex: '9999', viewportRect: full, viewport };

describe('viewportCoverage', () => {
  it('is 1 for a full-viewport rect and 0 for one outside', () => {
    expect(viewportCoverage(full, viewport)).toBe(1);
    expect(viewportCoverage({ x: 2000, y: 0, width: 100, height: 100 }, viewport)).toBe(0);
    expect(viewportCoverage({ x: 0, y: -500, width: 100, height: 100 }, viewport)).toBe(0);
  });

  it('clips to the viewport', () => {
    // Half of this 1000x800 box hangs off the right edge.
    expect(viewportCoverage({ x: 500, y: 0, width: 1000, height: 800 }, viewport)).toBe(0.5);
  });

  it('is 0 for an empty viewport', () => {
    expect(viewportCoverage(full, { width: 0, height: 0 })).toBe(0);
  });
});

describe('isPossibleOverlay', () => {
  it('flags a full-screen fixed backdrop with a high z-index', () => {
    expect(isPossibleOverlay(base, tuning)).toBe(true);
  });

  it('flags a sticky element too', () => {
    expect(isPossibleOverlay({ ...base, position: 'sticky' }, tuning)).toBe(true);
  });

  it('flags a cookie banner covering a quarter of the viewport', () => {
    const banner = { x: 0, y: 600, width: 1000, height: 200 }; // exactly 25%
    expect(isPossibleOverlay({ ...base, viewportRect: banner }, tuning)).toBe(true);
  });

  it.each(['static', 'relative', 'absolute'])('ignores position: %s', (position) => {
    expect(isPossibleOverlay({ ...base, position }, tuning)).toBe(false);
  });

  it('ignores a thin fixed header even with a high z-index', () => {
    const header = { x: 0, y: 0, width: 1000, height: 64 };
    expect(isPossibleOverlay({ ...base, viewportRect: header }, tuning)).toBe(false);
  });

  it('ignores a low or auto z-index', () => {
    expect(isPossibleOverlay({ ...base, zIndex: '99' }, tuning)).toBe(false);
    expect(isPossibleOverlay({ ...base, zIndex: 'auto' }, tuning)).toBe(false);
    expect(isPossibleOverlay({ ...base, zIndex: '' }, tuning)).toBe(false);
  });

  it('accepts a z-index exactly at the threshold', () => {
    expect(isPossibleOverlay({ ...base, zIndex: '100' }, tuning)).toBe(true);
  });

  it('ignores elements that are mostly off-screen', () => {
    const offscreen = { x: 900, y: 700, width: 1000, height: 800 };
    expect(isPossibleOverlay({ ...base, viewportRect: offscreen }, tuning)).toBe(false);
  });

  it('respects configured thresholds', () => {
    const strict = { overlayMinZIndex: 10_000, overlayMinViewportCoverage: 0.9 };
    expect(isPossibleOverlay(base, strict)).toBe(false);
    expect(isPossibleOverlay({ ...base, zIndex: '10000' }, strict)).toBe(true);
  });
});
