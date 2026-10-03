// Test fixture: a minimal but fully valid capture result.
import { SCHEMA_VERSION } from '../../shared/types';
import type { CaptureResult } from '../../shared/types';

export function validResult(): CaptureResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      url: 'https://example.com/',
      title: 'Example',
      lang: 'en',
      dir: 'ltr',
      viewportWidth: 1000,
      viewportHeight: 800,
      devicePixelRatio: 1,
      documentWidth: 1000,
      documentHeight: 2000,
      colorSchemeMeta: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    stats: {
      nodesVisited: 3,
      nodesCaptured: 3,
      nodesSkipped: { 'ignored-tag': 1, 'display-none': 0, 'budget-truncated': 0 },
      hiddenNodes: 1,
      uniqueStyles: 2,
      pseudoElements: 1,
      placeholders: 1,
      overlays: 0,
      shadowRoots: 0,
      closedShadowHosts: 0,
      truncated: false,
      truncatedReasons: [],
      scroll: { steps: 2, stoppedBy: 'bottom' },
      stabilize: { settled: true },
      durationsMs: { prepare: 1, scroll: 2, stabilize: 3, capture: 4, cleanup: 5, total: 15 },
      resultBytes: 1234,
    },
    nodes: [
      { id: 0, parentId: null, childIds: [1, 2], depth: 0, tag: 'html', rect: { x: 0, y: 0, width: 10, height: 10 }, inShadow: false, styleId: 0 },
      {
        id: 1, parentId: 0, childIds: [], depth: 1, tag: 'iframe', rect: { x: 0, y: 0, width: 5, height: 5 },
        inShadow: false, styleId: 1, placeholder: true, pseudo: { before: { content: '"x"', styleId: 0 } },
      },
      { id: 2, parentId: 0, childIds: [], depth: 1, tag: 'p', rect: { x: 0, y: 0, width: 0, height: 0 }, inShadow: false, styleId: null, hidden: 'zero-size' },
    ],
    styleTable: [{}, { display: 'block' }],
    placeholders: [{ nodeId: 1, tag: 'iframe', src: 'https://x.test/', rect: { x: 0, y: 0, width: 5, height: 5 }, sameOrigin: false }],
    warnings: [{ code: 'w', message: 'm' }],
  };
}
