const REGISTRATION = Symbol.for('designlens.extractor.registration');

interface Registration {
  dispose(): void;
}

export interface MessageEventSource<L> {
  addListener(listener: L): void;
  removeListener(listener: L): void;
}

/**
 * Register `listener` exactly once per page world. Injecting the extractor again (e.g. the user
 * clicks Analyze twice, or the extension was reloaded and left a stale copy behind) replaces the
 * previous registration instead of adding a second listener.
 */
export function installListener<L>(
  host: Record<symbol, unknown>,
  onMessage: MessageEventSource<L>,
  listener: L,
): void {
  const previous = host[REGISTRATION] as Registration | undefined;
  try {
    previous?.dispose();
  } catch {
    // A stale copy from a reloaded extension may no longer be able to unregister; it is inert.
  }
  onMessage.addListener(listener);
  const registration: Registration = { dispose: () => onMessage.removeListener(listener) };
  host[REGISTRATION] = registration;
}
