import { createStore, get, set, del } from "idb-keyval";
import { debounce } from "@excalidraw/common";

import { FILESYSTEM_SYNC_DEBOUNCE_TIMEOUT } from "../app_constants";

import type { DiagramData } from "./DiagramStore";

// --- File System Access API type augmentations ---
// These APIs are available in Chromium browsers but not in TypeScript's DOM lib.

interface FileSystemPermissionDescriptor {
  mode: "read" | "readwrite";
}

interface FileSystemHandleWithPermissions extends FileSystemDirectoryHandle {
  queryPermission(
    descriptor: FileSystemPermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor: FileSystemPermissionDescriptor,
  ): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}

// --- Config store (separate from diagram data) ---

const configStore = createStore("excalidraw-config-db", "config-store");

const CONFIG_KEYS = {
  DIRECTORY_HANDLE: "filesystem-directory-handle",
} as const;

// --- File name helpers ---

const sanitizeFileName = (name: string): string => {
  // Remove characters invalid in most filesystems
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Untitled";
};

const getFileName = (name: string): string => {
  return `${sanitizeFileName(name)}.excalidraw`;
};

// --- Debounced file writes keyed by diagram ID ---

type DebouncedFn = ((...args: any[]) => void) & {
  flush: () => void;
  cancel: () => void;
};

const debouncedWrites = new Map<string, DebouncedFn>();

// Track which file name each diagram ID maps to (for rename/delete)
const idToFileName = new Map<string, string>();

// --- Permission helpers ---

const verifyPermission = async (
  handle: FileSystemDirectoryHandle,
): Promise<boolean> => {
  try {
    const h = handle as FileSystemHandleWithPermissions;
    const opts: FileSystemPermissionDescriptor = { mode: "readwrite" };
    if ((await h.queryPermission(opts)) === "granted") {
      return true;
    }
    if ((await h.requestPermission(opts)) === "granted") {
      return true;
    }
  } catch {
    // Permission request failed
  }
  return false;
};

// --- Serialize diagram data to .excalidraw JSON ---

const serializeDiagram = (data: DiagramData): string => {
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: window.location.origin,
      elements: data.elements,
      appState: data.appState,
      files: data.files,
    },
    null,
    2,
  );
};

// --- Write a file to the directory ---

const writeFile = async (
  handle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> => {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
};

// --- Get debounced write for a diagram ---

const getDebouncedWrite = (id: string) => {
  if (!debouncedWrites.has(id)) {
    debouncedWrites.set(
      id,
      debounce((name: string, data: DiagramData) => {
        (async () => {
          try {
            const handle = await FilesystemSync.getStoredHandle();
            if (!handle || !(await verifyPermission(handle))) {
              return;
            }

            const fileName = getFileName(name);

            // If the name changed, remove the old file
            const oldFileName = idToFileName.get(id);
            if (oldFileName && oldFileName !== fileName) {
              try {
                await handle.removeEntry(oldFileName);
              } catch {
                // Old file may not exist
              }
            }

            idToFileName.set(id, fileName);
            await writeFile(handle, fileName, serializeDiagram(data));
          } catch (err) {
            console.warn("FilesystemSync: failed to write file:", err);
          }
        })();
      }, FILESYSTEM_SYNC_DEBOUNCE_TIMEOUT),
    );
  }
  return debouncedWrites.get(id)!;
};

// --- Public API ---

export class FilesystemSync {
  static async pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
    try {
      if (!window.showDirectoryPicker) {
        return null;
      }
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      await set(CONFIG_KEYS.DIRECTORY_HANDLE, handle, configStore);
      return handle;
    } catch {
      // User cancelled or API not supported
      return null;
    }
  }

  static async getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const handle = await get<FileSystemDirectoryHandle>(
        CONFIG_KEYS.DIRECTORY_HANDLE,
        configStore,
      );
      return handle || null;
    } catch {
      return null;
    }
  }

  static async verifyPermission(): Promise<boolean> {
    const handle = await this.getStoredHandle();
    if (!handle) {
      return false;
    }
    return verifyPermission(handle);
  }

  static async isEnabled(): Promise<boolean> {
    const handle = await this.getStoredHandle();
    return !!handle;
  }

  static async disable(): Promise<void> {
    await del(CONFIG_KEYS.DIRECTORY_HANDLE, configStore);
    debouncedWrites.clear();
    idToFileName.clear();
  }

  static async getDirectoryName(): Promise<string | null> {
    const handle = await this.getStoredHandle();
    return handle?.name || null;
  }

  /**
   * Debounced save of diagram data as a .excalidraw file.
   * Runs in parallel with IndexedDB saves.
   */
  static save(id: string, name: string, data: DiagramData): void {
    getDebouncedWrite(id)(name, data);
  }

  static flush(id: string): void {
    debouncedWrites.get(id)?.flush();
  }

  static async deleteDiagramFile(id: string, name: string): Promise<void> {
    try {
      const handle = await this.getStoredHandle();
      if (!handle || !(await verifyPermission(handle))) {
        return;
      }

      const fileName = idToFileName.get(id) || getFileName(name);
      try {
        await handle.removeEntry(fileName);
      } catch {
        // File may not exist
      }

      debouncedWrites.get(id)?.cancel();
      debouncedWrites.delete(id);
      idToFileName.delete(id);
    } catch (err) {
      console.warn("FilesystemSync: failed to delete file:", err);
    }
  }

  static async renameDiagramFile(
    id: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    try {
      const handle = await this.getStoredHandle();
      if (!handle || !(await verifyPermission(handle))) {
        return;
      }

      const oldFileName = idToFileName.get(id) || getFileName(oldName);
      const newFileName = getFileName(newName);

      if (oldFileName === newFileName) {
        return;
      }

      // Read old file content, write to new name, delete old
      try {
        const oldFileHandle = await handle.getFileHandle(oldFileName);
        const file = await oldFileHandle.getFile();
        const content = await file.text();

        // Update source name in content
        const parsed = JSON.parse(content);
        await writeFile(handle, newFileName, JSON.stringify(parsed, null, 2));
        await handle.removeEntry(oldFileName);
      } catch {
        // Old file may not exist yet (not saved to disk)
      }

      idToFileName.set(id, newFileName);
    } catch (err) {
      console.warn("FilesystemSync: failed to rename file:", err);
    }
  }

  /**
   * Scans the configured directory for .excalidraw files.
   * Returns an array of File objects for each found file.
   */
  static async scanDirectory(): Promise<File[]> {
    const handle = await this.getStoredHandle();
    if (!handle || !(await verifyPermission(handle))) {
      return [];
    }

    const files: File[] = [];
    for await (const [name, entry] of handle as any) {
      if (
        entry.kind === "file" &&
        (name as string).endsWith(".excalidraw")
      ) {
        try {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          files.push(file);
        } catch {
          // skip unreadable files
        }
      }
    }
    return files;
  }

  static isSupported(): boolean {
    return "showDirectoryPicker" in window;
  }
}
