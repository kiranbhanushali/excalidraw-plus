import { createStore, get, set, del } from "idb-keyval";
import { debounce } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  DIAGRAM_SAVE_DEBOUNCE_TIMEOUT,
  THUMBNAIL_DEBOUNCE_TIMEOUT,
} from "../app_constants";

import { generateWordId } from "./wordId";
import { generateThumbnail } from "./thumbnailGenerator";
import { FilesystemSync } from "./FilesystemSync";

// --- Types ---

export interface DiagramData {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export interface StoredDiagram {
  id: string;
  name: string;
  data: DiagramData;
  createdAt: number;
  updatedAt: number;
}

export interface DiagramIndexEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
  elementCount: number;
}

export interface DiagramVersion {
  id: string;
  label: string;
  timestamp: number;
  data: DiagramData;
}

// --- IndexedDB Stores ---

const diagramsStore = createStore("excalidraw-diagrams-db", "diagrams-store");
const indexStore = createStore("excalidraw-diagrams-index-db", "index-store");
const versionsStore = createStore("excalidraw-versions-db", "versions-store");

const INDEX_KEY = "diagrams-index";

// --- Internal helpers ---

const getIndexInternal = async (): Promise<DiagramIndexEntry[]> => {
  const index = await get<DiagramIndexEntry[]>(INDEX_KEY, indexStore);
  return index || [];
};

const setIndex = async (index: DiagramIndexEntry[]): Promise<void> => {
  await set(INDEX_KEY, index, indexStore);
};

// --- Debounced save & thumbnail functions keyed by diagram ID ---

type DebouncedFn = ((...args: any[]) => void) & {
  flush: () => void;
  cancel: () => void;
};

const debouncedSaves = new Map<string, DebouncedFn>();

const debouncedThumbnails = new Map<string, DebouncedFn>();

const getDebouncedSave = (id: string) => {
  if (!debouncedSaves.has(id)) {
    debouncedSaves.set(
      id,
      debounce((data: DiagramData) => {
        (async () => {
          const diagram = await get<StoredDiagram>(id, diagramsStore);
          if (!diagram) {
            return;
          }
          const updated: StoredDiagram = {
            ...diagram,
            data,
            updatedAt: Date.now(),
          };
          await set(id, updated, diagramsStore);

          // Update index
          const index = await getIndexInternal();
          const idx = index.findIndex((e) => e.id === id);
          if (idx !== -1) {
            index[idx] = {
              ...index[idx],
              updatedAt: updated.updatedAt,
              elementCount: data.elements.length,
            };
            await setIndex(index);
          }

          // Sync to filesystem
          FilesystemSync.save(id, updated.name, data);
        })();
      }, DIAGRAM_SAVE_DEBOUNCE_TIMEOUT),
    );
  }
  return debouncedSaves.get(id)!;
};

const getDebouncedThumbnail = (id: string) => {
  if (!debouncedThumbnails.has(id)) {
    debouncedThumbnails.set(
      id,
      debounce((elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
        (async () => {
          try {
            const thumbnail = await generateThumbnail(elements, files);
            await DiagramStore.updateThumbnail(id, thumbnail);
          } catch (err) {
            console.warn("Failed to generate thumbnail:", err);
          }
        })();
      }, THUMBNAIL_DEBOUNCE_TIMEOUT),
    );
  }
  return debouncedThumbnails.get(id)!;
};

// --- Public API ---

export class DiagramStore {
  static async create(name?: string): Promise<StoredDiagram> {
    const index = await getIndexInternal();
    const existingIds = new Set(index.map((e) => e.id));
    const id = generateWordId(existingIds);
    const now = Date.now();

    const diagram: StoredDiagram = {
      id,
      name: name || "Untitled",
      data: {
        elements: [],
        appState: {},
        files: {},
      },
      createdAt: now,
      updatedAt: now,
    };

    await set(id, diagram, diagramsStore);

    const entry: DiagramIndexEntry = {
      id,
      name: diagram.name,
      createdAt: now,
      updatedAt: now,
      thumbnail: null,
      elementCount: 0,
    };

    index.push(entry);
    await setIndex(index);

    return diagram;
  }

  static async get(id: string): Promise<StoredDiagram | null> {
    const diagram = await get<StoredDiagram>(id, diagramsStore);
    return diagram || null;
  }

  static save(id: string, data: DiagramData): void {
    getDebouncedSave(id)(data);
    getDebouncedThumbnail(id)(data.elements, data.files);
  }

  static async saveImmediate(id: string, data: DiagramData): Promise<void> {
    const diagram = await get<StoredDiagram>(id, diagramsStore);
    if (!diagram) {
      return;
    }
    const updated: StoredDiagram = {
      ...diagram,
      data,
      updatedAt: Date.now(),
    };
    await set(id, updated, diagramsStore);

    const index = await getIndexInternal();
    const idx = index.findIndex((e) => e.id === id);
    if (idx !== -1) {
      index[idx] = {
        ...index[idx],
        updatedAt: updated.updatedAt,
        elementCount: data.elements.length,
      };
      await setIndex(index);
    }
  }

  static flushSave(id: string): void {
    debouncedSaves.get(id)?.flush();
    debouncedThumbnails.get(id)?.flush();
  }

  static cancelPendingSave(id: string): void {
    debouncedSaves.get(id)?.cancel();
    debouncedThumbnails.get(id)?.cancel();
  }

  static async delete(id: string): Promise<void> {
    // Get name before deleting (needed for filesystem cleanup)
    const diagram = await get<StoredDiagram>(id, diagramsStore);
    const name = diagram?.name || "Untitled";

    await del(id, diagramsStore);
    debouncedSaves.delete(id);
    debouncedThumbnails.delete(id);

    const index = await getIndexInternal();
    const filtered = index.filter((e) => e.id !== id);
    await setIndex(filtered);

    // Remove versions
    await del(id, versionsStore);

    // Remove from filesystem
    FilesystemSync.deleteDiagramFile(id, name);
  }

  static async rename(id: string, name: string): Promise<void> {
    const diagram = await get<StoredDiagram>(id, diagramsStore);
    if (!diagram) {
      return;
    }
    const oldName = diagram.name;
    diagram.name = name;
    diagram.updatedAt = Date.now();
    await set(id, diagram, diagramsStore);

    const index = await getIndexInternal();
    const idx = index.findIndex((e) => e.id === id);
    if (idx !== -1) {
      index[idx].name = name;
      index[idx].updatedAt = diagram.updatedAt;
      await setIndex(index);
    }

    // Rename on filesystem
    FilesystemSync.renameDiagramFile(id, oldName, name);
  }

  static async duplicate(id: string): Promise<StoredDiagram> {
    const original = await get<StoredDiagram>(id, diagramsStore);
    if (!original) {
      throw new Error(`Diagram ${id} not found`);
    }

    const index = await getIndexInternal();
    const existingIds = new Set(index.map((e) => e.id));
    const newId = generateWordId(existingIds);
    const now = Date.now();

    const duplicate: StoredDiagram = {
      id: newId,
      name: `${original.name} (copy)`,
      data: {
        elements: [...original.data.elements],
        appState: { ...original.data.appState },
        files: { ...original.data.files },
      },
      createdAt: now,
      updatedAt: now,
    };

    await set(newId, duplicate, diagramsStore);

    const originalEntry = index.find((e) => e.id === id);
    const entry: DiagramIndexEntry = {
      id: newId,
      name: duplicate.name,
      createdAt: now,
      updatedAt: now,
      thumbnail: originalEntry?.thumbnail || null,
      elementCount: original.data.elements.length,
    };

    index.push(entry);
    await setIndex(index);

    return duplicate;
  }

  static async getIndex(): Promise<DiagramIndexEntry[]> {
    return getIndexInternal();
  }

  static async updateThumbnail(id: string, thumbnail: string): Promise<void> {
    const index = await getIndexInternal();
    const idx = index.findIndex((e) => e.id === id);
    if (idx !== -1) {
      index[idx].thumbnail = thumbnail;
      await setIndex(index);
    }
  }

  static async importFromFile(file: File): Promise<StoredDiagram> {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const elements: ExcalidrawElement[] = parsed.elements || [];
    const appState: Partial<AppState> = parsed.appState || {};
    const files: BinaryFiles = parsed.files || {};

    const name =
      file.name.replace(/\.excalidraw$/, "").replace(/\.json$/, "") ||
      "Imported";

    const index = await getIndexInternal();
    const existingIds = new Set(index.map((e) => e.id));
    const id = generateWordId(existingIds);
    const now = Date.now();

    const diagram: StoredDiagram = {
      id,
      name,
      data: { elements, appState, files },
      createdAt: now,
      updatedAt: now,
    };

    await set(id, diagram, diagramsStore);

    const entry: DiagramIndexEntry = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      thumbnail: null,
      elementCount: elements.length,
    };
    index.push(entry);
    await setIndex(index);

    // Generate thumbnail asynchronously
    try {
      const thumbnail = await generateThumbnail(elements, files);
      await DiagramStore.updateThumbnail(id, thumbnail);
    } catch {
      // non-critical
    }

    return diagram;
  }

  // --- Version control ---

  static async saveVersion(
    diagramId: string,
    label: string,
    data: DiagramData,
  ): Promise<DiagramVersion> {
    const version: DiagramVersion = {
      id: `${diagramId}-v-${Date.now()}`,
      label,
      timestamp: Date.now(),
      data: {
        elements: [...data.elements],
        appState: { ...data.appState },
        files: { ...data.files },
      },
    };

    const versions = await this.getVersions(diagramId);
    versions.push(version);
    await set(diagramId, versions, versionsStore);

    return version;
  }

  static async getVersions(diagramId: string): Promise<DiagramVersion[]> {
    const versions = await get<DiagramVersion[]>(diagramId, versionsStore);
    return versions || [];
  }

  static async restoreVersion(
    diagramId: string,
    versionId: string,
  ): Promise<DiagramData | null> {
    const versions = await this.getVersions(diagramId);
    const version = versions.find((v) => v.id === versionId);
    if (!version) {
      return null;
    }

    // Save the version's data as the current diagram state
    await this.saveImmediate(diagramId, version.data);
    return version.data;
  }

  static async deleteVersion(
    diagramId: string,
    versionId: string,
  ): Promise<void> {
    const versions = await this.getVersions(diagramId);
    const filtered = versions.filter((v) => v.id !== versionId);
    if (filtered.length > 0) {
      await set(diagramId, filtered, versionsStore);
    } else {
      await del(diagramId, versionsStore);
    }
  }

  static async updateVersionLabel(
    diagramId: string,
    versionId: string,
    newLabel: string,
  ): Promise<void> {
    const versions = await this.getVersions(diagramId);
    const idx = versions.findIndex((v) => v.id === versionId);
    if (idx === -1) {
      return;
    }
    versions[idx].label = newLabel;
    await set(diagramId, versions, versionsStore);
  }

  static async deleteAllVersions(diagramId: string): Promise<void> {
    await del(diagramId, versionsStore);
  }

  static async exportToFile(id: string): Promise<void> {
    const diagram = await get<StoredDiagram>(id, diagramsStore);
    if (!diagram) {
      throw new Error(`Diagram ${id} not found`);
    }

    const blob = new Blob(
      [
        JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: window.location.origin,
            elements: diagram.data.elements,
            appState: diagram.data.appState,
            files: diagram.data.files,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${diagram.name}.excalidraw`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
