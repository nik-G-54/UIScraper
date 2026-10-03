import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '../../shared/types';
import { assembleResult } from './result';
import type { AssembleInput } from './result';
import type { ScrollRunOutcome } from './scrollTarget';
import type { DomCapture } from './walker';

const durations: Record<PipelineStep, number> = { prepare: 1, scroll: 2, stabilize: 3, capture: 4, cleanup: 5 };

const dom = (overrides: Partial<DomCapture> = {}): DomCapture => ({
  nodes: [],
  styleTable: [],
  placeholders: [],
  warnings: [],
  counts: {
    visited: 0,
    skipped: { 'ignored-tag': 0, 'display-none': 0, 'budget-truncated': 0 },
    hidden: 0,
    pseudoElements: 0,
    overlays: 0,
    shadowRoots: 0,
    closedShadowHosts: 0,
  },
  truncated: null,
  ...overrides,
});

const windowScroll = (stoppedBy: ScrollRunOutcome['stoppedBy'] = 'bottom'): ScrollRunOutcome => ({
  steps: 4,
  stoppedBy,
  target: 'window',
  container: null,
});

function assemble(overrides: Partial<AssembleInput> = {}) {
  return assembleResult({
    meta: {
      url: 'https://example.com/', title: 't', lang: 'en', dir: 'ltr', viewportWidth: 1, viewportHeight: 1,
      devicePixelRatio: 1, documentWidth: 1, documentHeight: 1, colorSchemeMeta: null, timestamp: '2026-01-01T00:00:00.000Z',
    },
    dom: dom(),
    scroll: windowScroll(),
    stabilize: { settled: true, waitedMs: 5 },
    durationsMs: durations,
    ...overrides,
  });
}

const codes = (r: ReturnType<typeof assemble>) => r.warnings.map((w) => w.code);

describe('assembleResult: truncated means data may be missing', () => {
  it('is false for a clean capture', () => {
    const r = assemble();
    expect(r.stats.truncated).toBe(false);
    expect(r.stats.truncatedReasons).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each(['maxNodes', 'maxCaptureTimeMs'] as const)('is true when the DOM walk hit %s', (reason) => {
    const r = assemble({ dom: dom({ truncated: reason }) });
    expect(r.stats.truncated).toBe(true);
    expect(r.stats.truncatedReasons).toEqual([reason]);
  });

  it.each(['maxScrollHeightPx', 'maxScrollTimeMs'] as const)('is true when scrolling hit %s', (reason) => {
    const r = assemble({ scroll: windowScroll(reason) });
    expect(r.stats.truncated).toBe(true);
    expect(r.stats.truncatedReasons).toEqual([reason]);
  });

  it('lists every budget that was hit', () => {
    const r = assemble({ scroll: windowScroll('maxScrollTimeMs'), dom: dom({ truncated: 'maxNodes' }) });
    expect(r.stats.truncatedReasons).toEqual(['maxScrollTimeMs', 'maxNodes']);
  });

  it('is not set when scrolling simply stopped at the bottom, got stuck or was disabled', () => {
    for (const stoppedBy of ['bottom', 'stuck', 'disabled'] as const) {
      expect(assemble({ scroll: windowScroll(stoppedBy) }).stats.truncated).toBe(false);
    }
  });
});

describe('assembleResult: a page that never settles is a warning, not a truncation', () => {
  const unstable = () => assemble({ stabilize: { settled: false, waitedMs: 3000 } });

  it('does not set truncated', () => {
    const r = unstable();
    expect(r.stats.truncated).toBe(false);
    expect(r.stats.truncatedReasons).toEqual([]);
    expect(r.stats.truncatedReasons).not.toContain('maxStabilizeTimeMs');
  });

  it('adds a page-not-stable warning with an explanation', () => {
    const warning = unstable().warnings.find((w) => w.code === 'page-not-stable');
    expect(warning?.message).toBe(
      'Page kept changing (carousel or animation). Capture is complete but may show a mid-animation state.',
    );
  });

  it('still records settled: false in the stats', () => {
    expect(unstable().stats.stabilize.settled).toBe(false);
  });

  it('adds no such warning for a settled page', () => {
    expect(codes(assemble())).not.toContain('page-not-stable');
  });

  it('can coexist with a real truncation, which stays flagged', () => {
    const r = assemble({ stabilize: { settled: false, waitedMs: 3000 }, dom: dom({ truncated: 'maxNodes' }) });
    expect(r.stats.truncatedReasons).toEqual(['maxNodes']);
    expect(codes(r)).toContain('page-not-stable');
  });
});

describe('assembleResult: scroll target', () => {
  it('records the window as the target by default', () => {
    expect(assemble().stats.scroll).toEqual({ steps: 4, stoppedBy: 'bottom', target: 'window', container: null });
  });

  it('records an inner container and its descriptor', () => {
    const r = assemble({ scroll: { steps: 9, stoppedBy: 'bottom', target: 'container', container: 'main (depth 3)' } });
    expect(r.stats.scroll).toEqual({ steps: 9, stoppedBy: 'bottom', target: 'container', container: 'main (depth 3)' });
  });

  it('warns when scrolling got stuck', () => {
    expect(codes(assemble({ scroll: windowScroll('stuck') }))).toContain('scroll-stuck');
  });
});
