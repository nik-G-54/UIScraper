import { SCHEMA_VERSION } from '../../shared/types';
import type { CaptureResult } from '../../shared/types';

export type ValidationOutcome = { ok: true; result: CaptureResult } | { ok: false; reason: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const fail = (reason: string): ValidationOutcome => ({ ok: false, reason });

function checkFields(obj: unknown, where: string, strings: string[], numbers: string[]): string | null {
  if (!isObj(obj)) return `${where} is missing`;
  for (const key of strings) if (typeof obj[key] !== 'string') return `${where}.${key} must be a string`;
  for (const key of numbers) if (!isNum(obj[key])) return `${where}.${key} must be a number`;
  return null;
}

function isRect(v: unknown): boolean {
  return isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height);
}

/**
 * Check data that crossed a context boundary before the side panel trusts it. Verifies the
 * schema version, field types, and that every id points at something that exists.
 */
export function validateCaptureResult(raw: unknown): ValidationOutcome {
  if (!isObj(raw)) return fail('the result is not an object');
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return fail(`unsupported schemaVersion ${String(raw.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  }

  const metaProblem = checkFields(
    raw.meta,
    'meta',
    ['url', 'title', 'lang', 'dir', 'timestamp'],
    ['viewportWidth', 'viewportHeight', 'devicePixelRatio', 'documentWidth', 'documentHeight'],
  );
  if (metaProblem) return fail(metaProblem);
  const meta = raw.meta as Obj;
  if (meta.colorSchemeMeta !== null && typeof meta.colorSchemeMeta !== 'string') {
    return fail('meta.colorSchemeMeta must be a string or null');
  }

  const statsProblem = checkFields(
    raw.stats,
    'stats',
    [],
    [
      'nodesVisited',
      'nodesCaptured',
      'hiddenNodes',
      'uniqueStyles',
      'pseudoElements',
      'placeholders',
      'overlays',
      'shadowRoots',
      'closedShadowHosts',
      'resultBytes',
    ],
  );
  if (statsProblem) return fail(statsProblem);
  const stats = raw.stats as Obj;
  if (typeof stats.truncated !== 'boolean' || !Array.isArray(stats.truncatedReasons)) {
    return fail('stats.truncated / stats.truncatedReasons are malformed');
  }
  if (checkFields(stats.nodesSkipped, 'stats.nodesSkipped', [], ['ignored-tag', 'display-none', 'budget-truncated'])) {
    return fail('stats.nodesSkipped is malformed');
  }
  if (
    checkFields(stats.scroll, 'stats.scroll', ['stoppedBy', 'target'], ['steps']) ||
    !['window', 'container'].includes((stats.scroll as Obj).target as string) ||
    ((stats.scroll as Obj).container !== null && typeof (stats.scroll as Obj).container !== 'string') ||
    !isObj(stats.stabilize) ||
    typeof stats.stabilize.settled !== 'boolean'
  ) {
    return fail('stats.scroll / stats.stabilize are malformed');
  }
  if (checkFields(stats.durationsMs, 'stats.durationsMs', [], ['prepare', 'scroll', 'stabilize', 'capture', 'cleanup', 'total'])) {
    return fail('stats.durationsMs is malformed');
  }

  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.styleTable)) return fail('nodes or styleTable is not an array');
  if (!Array.isArray(raw.placeholders) || !Array.isArray(raw.warnings)) {
    return fail('placeholders or warnings is not an array');
  }
  const nodeCount = raw.nodes.length;
  const styleCount = raw.styleTable.length;
  if (stats.nodesCaptured !== nodeCount) return fail('stats.nodesCaptured does not match the number of nodes');
  if (stats.uniqueStyles !== styleCount) return fail('stats.uniqueStyles does not match the style table');

  for (let i = 0; i < nodeCount; i++) {
    const node: unknown = raw.nodes[i];
    const at = `nodes[${i}]`;
    if (!isObj(node)) return fail(`${at} is not an object`);
    if (node.id !== i) return fail(`${at}.id must equal its index`);
    if (typeof node.tag !== 'string') return fail(`${at}.tag must be a string`);
    if (!isInt(node.depth)) return fail(`${at}.depth must be an integer`);
    if (typeof node.inShadow !== 'boolean') return fail(`${at}.inShadow must be a boolean`);
    if (!isRect(node.rect)) return fail(`${at}.rect is malformed`);
    if (node.parentId !== null && !(isInt(node.parentId) && node.parentId >= 0 && node.parentId < i)) {
      return fail(`${at}.parentId must be null or an earlier node`);
    }
    if (!Array.isArray(node.childIds) || node.childIds.some((c) => !isInt(c) || c <= i || c >= nodeCount)) {
      return fail(`${at}.childIds must reference later nodes`);
    }
    if (node.styleId !== null && !(isInt(node.styleId) && node.styleId >= 0 && node.styleId < styleCount)) {
      return fail(`${at}.styleId points outside the style table`);
    }
    if ((node.hidden !== undefined) !== (node.styleId === null)) {
      return fail(`${at}: hidden nodes (and only those) must have styleId null`);
    }
    if (node.pseudo !== undefined) {
      if (!isObj(node.pseudo)) return fail(`${at}.pseudo is malformed`);
      for (const side of ['before', 'after'] as const) {
        const pseudo = node.pseudo[side];
        if (pseudo === undefined) continue;
        if (!isObj(pseudo) || typeof pseudo.content !== 'string' || !isInt(pseudo.styleId) || pseudo.styleId < 0 || pseudo.styleId >= styleCount) {
          return fail(`${at}.pseudo.${side} is malformed`);
        }
      }
    }
  }

  for (let i = 0; i < styleCount; i++) {
    const style: unknown = raw.styleTable[i];
    if (!isObj(style) || Object.values(style).some((v) => typeof v !== 'string')) {
      return fail(`styleTable[${i}] must map property names to strings`);
    }
  }
  for (let i = 0; i < raw.placeholders.length; i++) {
    const p: unknown = raw.placeholders[i];
    if (
      !isObj(p) ||
      !isInt(p.nodeId) ||
      p.nodeId < 0 ||
      p.nodeId >= nodeCount ||
      typeof p.tag !== 'string' ||
      !isRect(p.rect) ||
      (p.src !== null && typeof p.src !== 'string') ||
      (p.sameOrigin !== null && typeof p.sameOrigin !== 'boolean')
    ) {
      return fail(`placeholders[${i}] is malformed`);
    }
  }
  for (let i = 0; i < raw.warnings.length; i++) {
    const w: unknown = raw.warnings[i];
    if (!isObj(w) || typeof w.code !== 'string' || typeof w.message !== 'string') {
      return fail(`warnings[${i}] is malformed`);
    }
  }

  return { ok: true, result: raw as unknown as CaptureResult };
}
