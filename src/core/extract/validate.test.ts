/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately corrupt untyped JSON */
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../shared/types';
import { validResult } from './fixtures';
import { validateCaptureResult } from './validate';

const rejects = (mutate: (r: Record<string, any>) => void, reason: RegExp) => {
  const raw = JSON.parse(JSON.stringify(validResult())) as Record<string, any>;
  mutate(raw);
  const outcome = validateCaptureResult(raw);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toMatch(reason);
};

describe('validateCaptureResult', () => {
  it('accepts a well-formed result (and survives a JSON round trip)', () => {
    const raw: unknown = JSON.parse(JSON.stringify(validResult()));
    expect(validateCaptureResult(raw)).toEqual({ ok: true, result: raw });
  });

  it.each([null, undefined, 'x', 3, []])('rejects non-object %j', (raw) => {
    expect(validateCaptureResult(raw).ok).toBe(false);
  });

  it('rejects a different schema version', () => {
    rejects((r) => (r.schemaVersion = SCHEMA_VERSION - 1), /schemaVersion/);
  });

  it('rejects malformed meta and stats', () => {
    rejects((r) => delete r.meta, /meta/);
    rejects((r) => (r.meta.viewportWidth = 'wide'), /viewportWidth/);
    rejects((r) => (r.meta.colorSchemeMeta = 5), /colorSchemeMeta/);
    rejects((r) => (r.stats.nodesVisited = NaN), /nodesVisited|number/);
    rejects((r) => delete r.stats.durationsMs.total, /durationsMs/);
    rejects((r) => delete r.stats.nodesSkipped['display-none'], /nodesSkipped/);
    rejects((r) => (r.stats.scroll = {}), /scroll/);
  });

  it('requires a valid scroll target and container descriptor', () => {
    rejects((r) => (r.stats.scroll.target = 'frame'), /scroll/);
    rejects((r) => delete r.stats.scroll.target, /scroll/);
    rejects((r) => (r.stats.scroll.container = 5), /scroll/);
    const ok = JSON.parse(JSON.stringify(validResult())) as Record<string, any>;
    ok.stats.scroll = { steps: 3, stoppedBy: 'bottom', target: 'container', container: 'main (depth 3)' };
    expect(validateCaptureResult(ok).ok).toBe(true);
  });

  it('rejects arrays that are not arrays', () => {
    rejects((r) => (r.nodes = {}), /array/);
    rejects((r) => (r.styleTable = null), /array/);
    rejects((r) => (r.warnings = 'x'), /array/);
  });

  it('rejects stats that contradict the data', () => {
    rejects((r) => (r.stats.nodesCaptured = 99), /nodesCaptured/);
    rejects((r) => (r.stats.uniqueStyles = 99), /uniqueStyles/);
  });

  it('rejects dangling or inconsistent references', () => {
    rejects((r) => (r.nodes[1].id = 7), /id must equal/);
    rejects((r) => (r.nodes[1].parentId = 2), /parentId/);
    rejects((r) => (r.nodes[0].childIds = [9]), /childIds/);
    rejects((r) => (r.nodes[0].childIds = [0]), /childIds/);
    rejects((r) => (r.nodes[1].styleId = 5), /styleId/);
    rejects((r) => (r.nodes[2].styleId = 0), /hidden/);
    rejects((r) => delete r.nodes[2].hidden, /hidden/);
    rejects((r) => (r.nodes[1].pseudo.before.styleId = 50), /pseudo/);
    rejects((r) => (r.placeholders[0].nodeId = 10), /placeholders/);
  });

  it('rejects malformed nodes, styles, placeholders and warnings', () => {
    rejects((r) => (r.nodes[0].rect = { x: 1 }), /rect/);
    rejects((r) => (r.nodes[0].tag = 5), /tag/);
    rejects((r) => (r.nodes[0].inShadow = 'no'), /inShadow/);
    rejects((r) => (r.styleTable[1].display = 5), /styleTable/);
    rejects((r) => (r.placeholders[0].sameOrigin = 'yes'), /placeholders/);
    rejects((r) => (r.warnings[0] = { code: 1 }), /warnings/);
  });
});
