import { vi } from 'vitest';

type Change = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, Change>, areaName: string) => void;

export interface ChromeStorageMock {
  /** Backing data; inspect or seed it directly in tests. */
  data: Record<string, unknown>;
  local: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  listeners: Set<ChangeListener>;
}

/** Install a minimal in-memory chrome.storage on globalThis.chrome. */
export function installChromeStorageMock(initial: Record<string, unknown> = {}): ChromeStorageMock {
  const data: Record<string, unknown> = { ...initial };
  const listeners = new Set<ChangeListener>();

  const emit = (changes: Record<string, Change>) => {
    for (const listener of [...listeners]) listener(changes, 'local');
  };

  const local = {
    get: vi.fn(async (keys?: string | string[] | null) => {
      const wanted = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of wanted) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, Change> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
        data[key] = structuredClone(value);
      }
      emit(changes);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, Change> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in data) changes[key] = { oldValue: data[key] };
        delete data[key];
      }
      emit(changes);
    }),
  };

  vi.stubGlobal('chrome', {
    storage: {
      local,
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
      },
    },
  });

  return { data, local, listeners };
}
