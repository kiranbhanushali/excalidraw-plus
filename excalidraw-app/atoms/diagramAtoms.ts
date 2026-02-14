import { atom } from "excalidraw-app/app-jotai";

import type { DiagramData, DiagramIndexEntry } from "../data/DiagramStore";

// --- localStorage-backed atom helper ---

const STORAGE_PREFIX = "excalidraw-plus-";

function atomWithLocalStorage<T>(key: string, defaultValue: T) {
  const fullKey = STORAGE_PREFIX + key;

  const storedValue = (() => {
    try {
      const item = localStorage.getItem(fullKey);
      return item ? (JSON.parse(item) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  })();

  const baseAtom = atom<T>(storedValue);

  const derivedAtom = atom(
    (get) => get(baseAtom),
    (_get, set, update: T | ((prev: T) => T)) => {
      const prev = _get(baseAtom);
      const next =
        typeof update === "function"
          ? (update as (prev: T) => T)(prev)
          : update;
      set(baseAtom, next);
      try {
        localStorage.setItem(fullKey, JSON.stringify(next));
      } catch {
        // quota exceeded — silently ignore
      }
    },
  );

  return derivedAtom;
}

// --- Persisted atoms (survive refresh) ---

// Current view: dashboard or editor
export const viewModeAtom = atomWithLocalStorage<"dashboard" | "editor">(
  "viewMode",
  "dashboard",
);

// Tab state for each open diagram
export interface TabState {
  id: string;
  name: string;
  isDirty: boolean;
}

// All open tabs
export const openTabsAtom = atomWithLocalStorage<TabState[]>("openTabs", []);

// Currently active tab ID
export const activeTabIdAtom = atomWithLocalStorage<string | null>(
  "activeTabId",
  null,
);

// --- Non-persisted atoms (loaded from IndexedDB on demand) ---

// Dashboard diagram list (from index)
export const diagramIndexAtom = atom<DiagramIndexEntry[]>([]);

// In-memory cache for open tab diagram data (fast switching)
export const tabCacheAtom = atom<Map<string, DiagramData>>(new Map());

// Filesystem sync state
export const filesystemEnabledAtom = atom<boolean>(false);
export const filesystemErrorAtom = atom<string | null>(null);
