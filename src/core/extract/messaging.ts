import { SCHEMA_VERSION } from '../../shared/types';
import type {
  AssetLimits,
  CaptureOptions,
  CaptureResult,
  CssLimits,
  MotionData,
  MotionLimits,
  ExtractorProgressMessage,
  ExtractorRequest,
  ExtractorResponse,
  ProgressStep,
  RawAssetCollection,
  RawCssCollection,
  SelectorMatches,
  SelectorMatchLimits,
} from '../../shared/types';
import { isAbortError } from './abort';

export interface ExtractorDeps {
  run(
    options: CaptureOptions,
    onProgress: (step: ProgressStep) => void,
    signal: AbortSignal,
  ): Promise<CaptureResult>;
  /** Read the page's stylesheets (synchronous: it only touches the DOM). */
  collectCss(limits: CssLimits): RawCssCollection;
  /** Which nodes of the LAST capture each selector matches. */
  matchSelectors(selectors: string[], limits: SelectorMatchLimits): SelectorMatches;
  /** Images, inline SVGs and favicons of the LAST capture's nodes. */
  collectAssets(limits: AssetLimits): RawAssetCollection;
  /** Sample the page's motion (scrolls and restores). Run before the animation-pause CSS is applied. */
  collectMotion(limits: MotionLimits, signal: AbortSignal): Promise<MotionData>;
  /** Node ids of the LAST capture for the motion scan's targets (null = not captured). */
  resolveMotion(): Array<number | null>;
  sendProgress(message: ExtractorProgressMessage): void;
  /** `chrome.runtime.id`; messages from other extensions are ignored. */
  extensionId: string | undefined;
}

export type ExtractorListener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: ExtractorResponse) => void,
) => boolean;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isExtractorRequest(message: unknown): message is ExtractorRequest {
  if (!isObject(message) || typeof message.type !== 'string') return false;
  switch (message.type) {
    case 'designlens/ping':
      return true;
    case 'designlens/abort':
      return typeof message.requestId === 'string';
    case 'designlens/collect-css':
    case 'designlens/collect-assets':
      return isObject(message.limits);
    case 'designlens/collect-motion':
      return typeof message.requestId === 'string' && isObject(message.limits);
    case 'designlens/resolve-motion':
      return true;
    case 'designlens/match-selectors':
      return (
        isObject(message.limits) &&
        Array.isArray(message.selectors) &&
        message.selectors.every((selector) => typeof selector === 'string')
      );
    case 'designlens/extract':
      return (
        typeof message.requestId === 'string' &&
        isObject(message.options) &&
        typeof message.options.autoScroll === 'boolean' &&
        isObject(message.options.budgets) &&
        isObject(message.options.tuning)
      );
    default:
      return false;
  }
}

/**
 * The chrome.runtime.onMessage handler for the injected extractor. Messages it does not
 * recognise are ignored (returns false, no response). An "extract" request is answered
 * asynchronously (returns true) and only one runs at a time.
 */
export function createExtractorListener(deps: ExtractorDeps): ExtractorListener {
  let active: { requestId: string; controller: AbortController } | null = null;

  return (message, sender, sendResponse) => {
    if (deps.extensionId !== undefined && sender.id !== deps.extensionId) return false;
    if (!isExtractorRequest(message)) return false;

    const respond = (response: ExtractorResponse) => {
      try {
        sendResponse(response);
      } catch {
        // The side panel went away; there is nobody left to tell.
      }
    };

    switch (message.type) {
      case 'designlens/ping':
        respond({ ok: true, kind: 'pong', schemaVersion: SCHEMA_VERSION });
        return false;

      case 'designlens/collect-css':
        try {
          respond({ ok: true, kind: 'css', css: deps.collectCss(message.limits) });
        } catch (error) {
          respond({
            ok: false,
            error: {
              code: 'EXTRACTION_FAILED',
              message: error instanceof Error && error.message ? error.message : 'Could not read the stylesheets.',
            },
          });
        }
        return false;

      case 'designlens/match-selectors':
        try {
          respond({ ok: true, kind: 'selector-matches', matches: deps.matchSelectors(message.selectors, message.limits) });
        } catch (error) {
          respond({ ok: false, error: { code: 'EXTRACTION_FAILED', message: errorText(error, 'Could not match the selectors.') } });
        }
        return false;

      case 'designlens/collect-assets':
        try {
          respond({ ok: true, kind: 'assets', assets: deps.collectAssets(message.limits) });
        } catch (error) {
          respond({ ok: false, error: { code: 'EXTRACTION_FAILED', message: errorText(error, 'Could not read the page assets.') } });
        }
        return false;

      case 'designlens/resolve-motion':
        try {
          respond({ ok: true, kind: 'motion-ids', ids: deps.resolveMotion() });
        } catch (error) {
          respond({ ok: false, error: { code: 'EXTRACTION_FAILED', message: errorText(error, 'Could not match the motion targets.') } });
        }
        return false;

      case 'designlens/collect-motion': {
        if (active) {
          respond({ ok: false, error: { code: 'BUSY', message: 'A capture is already running on this page.' } });
          return false;
        }
        const controller = new AbortController();
        const mine = { requestId: message.requestId, controller };
        active = mine;
        deps.collectMotion(message.limits, controller.signal).then(
          (motion) => {
            if (active === mine) active = null;
            respond({ ok: true, kind: 'motion', motion });
          },
          (error: unknown) => {
            if (active === mine) active = null;
            respond({
              ok: false,
              error: isAbortError(error)
                ? { code: 'ABORTED', message: 'The motion scan was cancelled.' }
                : { code: 'EXTRACTION_FAILED', message: errorText(error, 'The motion scan failed.') },
            });
          },
        );
        return true;
      }

      case 'designlens/abort':
        if (active?.requestId === message.requestId) active.controller.abort();
        respond({ ok: true, kind: 'abort-ack' });
        return false;

      case 'designlens/extract': {
        if (active) {
          respond({ ok: false, error: { code: 'BUSY', message: 'A capture is already running on this page.' } });
          return false;
        }
        const { requestId } = message;
        const controller = new AbortController();
        const mine = { requestId, controller };
        active = mine;
        // Free the slot BEFORE answering, so a follow-up request sent from the response callback
        // is never refused as BUSY.
        const release = () => {
          if (active === mine) active = null;
        };
        deps
          .run(
            message.options,
            (step) => deps.sendProgress({ type: 'designlens/progress', requestId, step }),
            controller.signal,
          )
          .then(
            (result) => {
              release();
              respond({ ok: true, kind: 'result', result });
            },
            (error: unknown) => {
              release();
              respond({
                ok: false,
                error: isAbortError(error)
                  ? { code: 'ABORTED', message: 'The capture was cancelled.' }
                  : {
                      code: 'EXTRACTION_FAILED',
                      message: error instanceof Error && error.message ? error.message : 'Unknown extraction error.',
                    },
              });
            },
          );
        return true;
      }
    }
  };
}
