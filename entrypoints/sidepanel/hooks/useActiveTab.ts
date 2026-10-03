import { useEffect, useState } from 'react';
import { toErrorMessage } from '@/src/shared/errors';
import type { ActiveTabInfo } from '@/src/shared/types';

export type ActiveTabState =
  | { status: 'loading' }
  | { status: 'ready'; tab: ActiveTabInfo | null }
  | { status: 'error'; message: string };

/** Tracks the active tab of this side panel's window: switches, navigations, title changes. */
export function useActiveTab(): ActiveTabState {
  const [state, setState] = useState<ActiveTabState>({ status: 'loading' });

  useEffect(() => {
    let disposed = false;
    let latestRequest = 0;
    let windowId: number | undefined;

    const refresh = async () => {
      const request = ++latestRequest;
      try {
        windowId ??= (await chrome.windows.getCurrent()).id;
        const [tab] = await chrome.tabs.query(
          windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId },
        );
        // Ignore out-of-order results from rapid tab switching.
        if (disposed || request !== latestRequest) return;
        setState({
          status: 'ready',
          tab:
            tab?.id === undefined
              ? null
              : { id: tab.id, title: tab.title ?? '', url: tab.url ?? tab.pendingUrl ?? '' },
        });
      } catch (error) {
        if (disposed || request !== latestRequest) return;
        setState({ status: 'error', message: `Could not read the active tab: ${toErrorMessage(error)}` });
      }
    };

    const onActivated = () => void refresh();
    const onReplaced = () => void refresh();
    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status)) void refresh();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onReplaced.addListener(onReplaced);
    void refresh();

    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onReplaced.removeListener(onReplaced);
    };
  }, []);

  return state;
}
