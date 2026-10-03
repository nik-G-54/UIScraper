import { parsePageProbeData, probePage } from '@/src/core/extract';
import { PROBE_TIMEOUT_MS } from '@/src/shared/config';
import { DesignLensError, toErrorMessage } from '@/src/shared/errors';
import { SCHEMA_VERSION } from '@/src/shared/types';
import type { ActiveTabInfo, PageProbeResult } from '@/src/shared/types';
import { getPageRestriction } from '@/src/shared/url';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DesignLensError('TIMEOUT', message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Inject the probe into the tab's top frame (ISOLATED world, on demand) and return
 * its validated result. Throws a DesignLensError with a readable message on any failure.
 */
export async function analyzeTab(tab: ActiveTabInfo): Promise<PageProbeResult> {
  const restriction = getPageRestriction(tab.url);
  if (restriction.restricted) throw new DesignLensError('RESTRICTED_PAGE', restriction.reason);

  let results: chrome.scripting.InjectionResult[];
  try {
    results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: probePage,
      }),
      PROBE_TIMEOUT_MS,
      `The page did not respond within ${PROBE_TIMEOUT_MS / 1000} seconds.`,
    );
  } catch (error) {
    if (error instanceof DesignLensError) throw error;
    throw new DesignLensError('INJECTION_FAILED', `Could not read this page: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }

  const data = parsePageProbeData(results[0]?.result);
  if (!data) {
    throw new DesignLensError('INVALID_RESULT', 'The page returned data in an unexpected format.');
  }
  return { schemaVersion: SCHEMA_VERSION, ...data };
}
