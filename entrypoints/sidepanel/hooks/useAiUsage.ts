import { useEffect, useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import { storage } from '@/src/shared/storage';
import { getAiUsageToday, msUntilNextLocalMidnight } from '@/src/shared/usage';

export type AiUsageState =
  | { status: 'loading' }
  | { status: 'ready'; used: number }
  | { status: 'error'; message: string };

/**
 * Today's AI request count. Re-reads when storage changes, at local midnight, and when the
 * panel becomes visible again (timers can be late after the machine sleeps).
 */
export function useAiUsageToday(): AiUsageState {
  const [state, setState] = useState<AiUsageState>({ status: 'loading' });

  useEffect(() => {
    let disposed = false;
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      getAiUsageToday().then(
        (used) => {
          if (!disposed) setState({ status: 'ready', used });
        },
        (error: unknown) => {
          if (!disposed) {
            setState({ status: 'error', message: `Could not read AI usage: ${toErrorMessage(error)}` });
          }
        },
      );
    };

    const scheduleMidnightRefresh = () => {
      // +1s so we land safely on the new day even if the timer fires a touch early.
      midnightTimer = setTimeout(() => {
        refresh();
        scheduleMidnightRefresh();
      }, msUntilNextLocalMidnight() + 1000);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    const unsubscribe = storage.subscribe('aiUsage', refresh);
    document.addEventListener('visibilitychange', onVisible);
    scheduleMidnightRefresh();
    refresh();

    return () => {
      disposed = true;
      clearTimeout(midnightTimer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
