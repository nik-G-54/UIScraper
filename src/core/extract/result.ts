import { SCHEMA_VERSION } from '../../shared/types';
import type {
  CaptureMeta,
  CaptureResult,
  CaptureWarning,
  PipelineStep,
  TruncationReason,
} from '../../shared/types';
import type { ScrollRunOutcome } from './scrollTarget';
import type { StabilizeOutcome } from './stabilize';
import type { DomCapture } from './walker';

export interface MetaWindow {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

export function collectMeta(doc: Document, win: MetaWindow, now: Date = new Date()): CaptureMeta {
  const root = doc.documentElement;
  const body = doc.body;
  const computedDirection = doc.defaultView?.getComputedStyle(root).direction;
  return {
    url: doc.location?.href ?? doc.URL,
    title: doc.title,
    lang: root.getAttribute('lang') ?? '',
    dir: root.getAttribute('dir') || computedDirection || 'ltr',
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    devicePixelRatio: win.devicePixelRatio,
    documentWidth: Math.max(root.scrollWidth, root.offsetWidth, body ? body.scrollWidth : 0),
    documentHeight: Math.max(root.scrollHeight, root.offsetHeight, body ? body.scrollHeight : 0),
    colorSchemeMeta: doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null,
    timestamp: now.toISOString(),
  };
}

export interface AssembleInput {
  meta: CaptureMeta;
  dom: DomCapture;
  scroll: ScrollRunOutcome;
  stabilize: StabilizeOutcome;
  durationsMs: Record<PipelineStep, number>;
  extraWarnings?: CaptureWarning[];
}

export function assembleResult(input: AssembleInput): CaptureResult {
  const { meta, dom, scroll, stabilize, durationsMs } = input;
  const { counts } = dom;

  // Truncated = data may be missing. Not settling is a warning instead (see below).
  const truncatedReasons: TruncationReason[] = [];
  if (scroll.stoppedBy === 'maxScrollHeightPx' || scroll.stoppedBy === 'maxScrollTimeMs') {
    truncatedReasons.push(scroll.stoppedBy);
  }
  if (dom.truncated) truncatedReasons.push(dom.truncated);

  const warnings: CaptureWarning[] = [...dom.warnings, ...(input.extraWarnings ?? [])];
  if (!stabilize.settled) {
    warnings.push({
      code: 'page-not-stable',
      message:
        'Page kept changing (carousel or animation). Capture is complete but may show a mid-animation state.',
    });
  }
  if (scroll.stoppedBy === 'stuck') {
    warnings.push({
      code: 'scroll-stuck',
      message:
        'The page did not scroll with the window (it may use an inner scroll container), so lazy-loaded content may be missing.',
    });
  }
  if (counts.closedShadowHosts > 0) {
    warnings.push({
      code: 'closed-shadow-roots',
      message: `${counts.closedShadowHosts} closed shadow root(s) are opaque: their contents were not captured.`,
    });
  }
  const iframes = dom.placeholders.filter((placeholder) => placeholder.tag === 'iframe');
  if (iframes.length > 0) {
    const crossOrigin = iframes.filter((placeholder) => placeholder.sameOrigin === false).length;
    warnings.push({
      code: 'iframes-not-traversed',
      message: `${iframes.length} iframe(s) were recorded as placeholders (${crossOrigin} cross-origin); their contents are not captured.`,
    });
  }

  const total = Object.values(durationsMs).reduce((sum, ms) => sum + ms, 0);
  const result: CaptureResult = {
    schemaVersion: SCHEMA_VERSION,
    meta,
    stats: {
      nodesVisited: counts.visited,
      nodesCaptured: dom.nodes.length,
      nodesSkipped: counts.skipped,
      hiddenNodes: counts.hidden,
      uniqueStyles: dom.styleTable.length,
      pseudoElements: counts.pseudoElements,
      placeholders: dom.placeholders.length,
      overlays: counts.overlays,
      shadowRoots: counts.shadowRoots,
      closedShadowHosts: counts.closedShadowHosts,
      truncated: truncatedReasons.length > 0,
      truncatedReasons,
      scroll: { steps: scroll.steps, stoppedBy: scroll.stoppedBy, target: scroll.target, container: scroll.container },
      stabilize: { settled: stabilize.settled },
      durationsMs: { ...durationsMs, total },
      resultBytes: 0,
    },
    nodes: dom.nodes,
    styleTable: dom.styleTable,
    placeholders: dom.placeholders,
    warnings,
  };
  result.stats.resultBytes = new TextEncoder().encode(JSON.stringify(result)).length;
  return result;
}
