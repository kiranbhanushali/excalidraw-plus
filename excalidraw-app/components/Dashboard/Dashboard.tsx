import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAtom, useSetAtom } from "../../app-jotai";
import {
  viewModeAtom,
  openTabsAtom,
  activeTabIdAtom,
  diagramIndexAtom,
  tabCacheAtom,
} from "../../atoms/diagramAtoms";
import { DiagramStore } from "../../data/DiagramStore";
import { appConfirm, appPrompt } from "../AppModal";

import { FilesystemSetup } from "../FilesystemSetup";

import { DiagramCard } from "./DiagramCard";

import "./Dashboard.scss";

export const Dashboard: React.FC = () => {
  const [diagramIndex, setDiagramIndex] = useAtom(diagramIndexAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const [openTabs, setOpenTabs] = useAtom(openTabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);
  const setTabCache = useSetAtom(tabCacheAtom);
  const [searchQuery, setSearchQuery] = useState("");

  // Load diagram index on mount
  useEffect(() => {
    DiagramStore.getIndex().then(setDiagramIndex);
  }, [setDiagramIndex]);

  const filteredDiagrams = useMemo(() => {
    const sorted = [...diagramIndex].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!searchQuery.trim()) {
      return sorted;
    }
    const q = searchQuery.toLowerCase();
    return sorted.filter((d) => d.name.toLowerCase().includes(q));
  }, [diagramIndex, searchQuery]);

  const openDiagram = useCallback(
    async (id: string) => {
      const diagram = await DiagramStore.get(id);
      if (!diagram) {
        return;
      }

      // Check if already open in a tab
      const existingTab = openTabs.find((t) => t.id === id);
      if (existingTab) {
        setActiveTabId(id);
        setViewMode("editor");
        return;
      }

      // Add to tab cache
      setTabCache((prev) => {
        const next = new Map(prev);
        next.set(id, diagram.data);
        return next;
      });

      // Add new tab
      setOpenTabs((prev) => [
        ...prev,
        { id, name: diagram.name, isDirty: false },
      ]);
      setActiveTabId(id);
      setViewMode("editor");
    },
    [openTabs, setActiveTabId, setOpenTabs, setTabCache, setViewMode],
  );

  const handleCreate = useCallback(async () => {
    const name = await appPrompt({
      title: "New Diagram",
      placeholder: "Untitled",
    });
    if (name === null) {
      return;
    }
    const diagram = await DiagramStore.create(name.trim() || undefined);
    setDiagramIndex((prev) => [
      ...prev,
      {
        id: diagram.id,
        name: diagram.name,
        createdAt: diagram.createdAt,
        updatedAt: diagram.updatedAt,
        thumbnail: null,
        elementCount: 0,
      },
    ]);
    openDiagram(diagram.id);
  }, [setDiagramIndex, openDiagram]);

  const handleImport = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".excalidraw,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        return;
      }
      try {
        const diagram = await DiagramStore.importFromFile(file);
        const updatedIndex = await DiagramStore.getIndex();
        setDiagramIndex(updatedIndex);
        openDiagram(diagram.id);
      } catch (err) {
        console.error("Failed to import file:", err);
      }
    };
    input.click();
  }, [setDiagramIndex, openDiagram]);

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await DiagramStore.rename(id, name);
      setDiagramIndex((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name } : d)),
      );
      // Also update tab name if open
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name } : t)),
      );
    },
    [setDiagramIndex, setOpenTabs],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const duplicate = await DiagramStore.duplicate(id);
      const updatedIndex = await DiagramStore.getIndex();
      setDiagramIndex(updatedIndex);
      openDiagram(duplicate.id);
    },
    [setDiagramIndex, openDiagram],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = await appConfirm({
        title: "Delete Diagram",
        message: "Delete this diagram? This cannot be undone.",
        confirmText: "Delete",
        confirmStyle: "danger",
      });
      if (!confirmed) {
        return;
      }
      await DiagramStore.delete(id);
      setDiagramIndex((prev) => prev.filter((d) => d.id !== id));

      // Close tab if open
      setOpenTabs((prev) => prev.filter((t) => t.id !== id));
      setTabCache((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [setDiagramIndex, setOpenTabs, setTabCache],
  );

  const handleExport = useCallback(async (id: string) => {
    try {
      await DiagramStore.exportToFile(id);
    } catch (err) {
      console.error("Failed to export:", err);
    }
  }, []);

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <div className="dashboard__title">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="dashboard__logo"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h1>Excalidraw Plus</h1>
        </div>
        <div className="dashboard__actions">
          <button
            className="dashboard__btn dashboard__btn--primary"
            onClick={handleCreate}
          >
            + Create New Diagram
          </button>
          <button
            className="dashboard__btn dashboard__btn--secondary"
            onClick={handleImport}
          >
            Import .excalidraw
          </button>
        </div>
      </div>

      <FilesystemSetup />

      <div className="dashboard__search">
        <input
          type="text"
          placeholder="Search diagrams..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="dashboard__search-input"
        />
      </div>

      {filteredDiagrams.length === 0 ? (
        <div className="dashboard__empty">
          {diagramIndex.length === 0 ? (
            <>
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="dashboard__empty-icon"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="12" y1="8" x2="12" y2="16" />
              </svg>
              <h2>No diagrams yet</h2>
              <p>
                Create your first diagram or import an existing .excalidraw
                file.
              </p>
              <button
                className="dashboard__btn dashboard__btn--primary"
                onClick={handleCreate}
              >
                Create your first diagram
              </button>
            </>
          ) : (
            <>
              <p>No diagrams match "{searchQuery}"</p>
            </>
          )}
        </div>
      ) : (
        <div className="dashboard__grid">
          {filteredDiagrams.map((entry) => (
            <DiagramCard
              key={entry.id}
              entry={entry}
              onOpen={openDiagram}
              onRename={handleRename}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onExport={handleExport}
            />
          ))}
        </div>
      )}
    </div>
  );
};
