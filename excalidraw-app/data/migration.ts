import { STORAGE_KEYS } from "../app_constants";

import { DiagramStore } from "./DiagramStore";

const MIGRATION_DONE_KEY = "excalidraw-plus-migrated";

export const migrateLocalStorageToIDB = async (): Promise<string | null> => {
  // Check if already migrated
  if (localStorage.getItem(MIGRATION_DONE_KEY)) {
    return null;
  }

  const savedElements = localStorage.getItem(
    STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
  );
  const savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);

  if (!savedElements && !savedState) {
    // Nothing to migrate, mark as done
    localStorage.setItem(MIGRATION_DONE_KEY, "true");
    return null;
  }

  let elements = [];
  let appState = {};

  try {
    if (savedElements) {
      elements = JSON.parse(savedElements);
    }
    if (savedState) {
      appState = JSON.parse(savedState);
    }
  } catch (err) {
    console.warn("Failed to parse legacy localStorage data:", err);
    localStorage.setItem(MIGRATION_DONE_KEY, "true");
    return null;
  }

  // Only migrate if there are actual elements
  if (!elements.length) {
    localStorage.setItem(MIGRATION_DONE_KEY, "true");
    return null;
  }

  try {
    const diagram = await DiagramStore.create("Untitled");
    await DiagramStore.saveImmediate(diagram.id, {
      elements,
      appState,
      files: {},
    });

    // Clear old localStorage keys
    localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);

    localStorage.setItem(MIGRATION_DONE_KEY, "true");
    return diagram.id;
  } catch (err) {
    console.error("Migration failed:", err);
    return null;
  }
};
