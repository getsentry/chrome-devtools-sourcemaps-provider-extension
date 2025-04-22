import { useSyncExternalStore } from "react";

// In-memory cache for storage values
const cache: Record<string, unknown> = {};

/**
 * Create a hook for a specific chrome.storage.sync key
 * @param key storage key
 * @param defaultValue fallback value
 */
export function createChromeStorageSyncStore<T>(key: string, defaultValue: T) {
  const subscribe = (callback: () => void) => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      if (changes[key]) {
        cache[key] = changes[key].newValue;
        callback();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    // load initial value
    chrome.storage.sync.get([key], (result) => {
      const val = result[key] !== undefined ? result[key] : defaultValue;
      if (cache[key] !== val) {
        cache[key] = val;
        callback();
      }
    });
    return () => chrome.storage.onChanged.removeListener(listener);
  };

  const getSnapshot = (): T =>
    (cache[key] !== undefined ? cache[key] : defaultValue) as T;

  // useSyncExternalStore for consistent reads and updates
  return () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Hooks for our storage keys
export const useSentryAuthToken = createChromeStorageSyncStore<string | null>(
  "sentryAuthToken",
  null
);
export const useProjectConfigs = createChromeStorageSyncStore<
  Array<{
    project: string;
    projectName: string;
    organization: string;
    organizationName: string;
    urlPattern: string;
  }>
>("projectConfigs", []);
