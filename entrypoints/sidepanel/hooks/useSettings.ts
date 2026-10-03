import { useCallback, useEffect, useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import { loadSettings, saveSettings } from '@/src/shared/storage';
import type { Settings } from '@/src/shared/types';

export type SettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: Settings }
  | { status: 'error'; message: string };

export function useSettings(): {
  state: SettingsState;
  /** Resolves with the saved settings; rejects with a readable error. */
  save: (next: Settings) => Promise<Settings>;
} {
  const [state, setState] = useState<SettingsState>({ status: 'loading' });

  useEffect(() => {
    let disposed = false;
    loadSettings().then(
      (settings) => {
        if (!disposed) setState({ status: 'ready', settings });
      },
      (error: unknown) => {
        if (!disposed) {
          setState({ status: 'error', message: `Could not load settings: ${toErrorMessage(error)}` });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  const save = useCallback(async (next: Settings) => {
    const saved = await saveSettings(next);
    setState({ status: 'ready', settings: saved });
    return saved;
  }, []);

  return { state, save };
}
