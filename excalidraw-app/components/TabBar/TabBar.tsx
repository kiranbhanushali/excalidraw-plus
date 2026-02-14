import React, { useCallback, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useSetAtom } from "../../app-jotai";
import {
  viewModeAtom,
  openTabsAtom,
  activeTabIdAtom,
  tabCacheAtom,
} from "../../atoms/diagramAtoms";
import { DiagramStore } from "../../data/DiagramStore";
import { appConfirm, appPrompt } from "../AppModal";

import { VersionPanel } from "./VersionPanel";

import "./TabBar.scss";

interface TabBarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onSaveCurrentTab: () => Promise<void>;
}

export const TabBar: React.FC<TabBarProps> = React.memo(
  ({ excalidrawAPI, onSaveCurrentTab }) => {
    const [openTabs, setOpenTabs] = useAtom(openTabsAtom);
    const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom);
    const setViewMode = useSetAtom(viewModeAtom);
    const setTabCache = useSetAtom(tabCacheAtom);
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const switchTab = useCallback(
      async (id: string) => {
        if (id === activeTabId) {
          return;
        }

        // Save current tab state before switching
        await onSaveCurrentTab();

        setActiveTabId(id);
      },
      [activeTabId, onSaveCurrentTab, setActiveTabId],
    );

    const closeTab = useCallback(
      async (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        e?.preventDefault();

        const tab = openTabs.find((t) => t.id === id);
        if (tab?.isDirty) {
          const shouldSave = await appConfirm({
            title: "Unsaved Changes",
            message: `"${tab.name}" has unsaved changes. Save before closing?`,
            confirmText: "Save",
            confirmStyle: "primary",
          });
          if (shouldSave) {
            await onSaveCurrentTab();
          }
        }

        const tabIndex = openTabs.findIndex((t) => t.id === id);
        const newTabs = openTabs.filter((t) => t.id !== id);

        setOpenTabs(newTabs);
        setTabCache((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });

        if (id === activeTabId) {
          if (newTabs.length > 0) {
            // Activate adjacent tab
            const nextIndex = Math.min(tabIndex, newTabs.length - 1);
            setActiveTabId(newTabs[nextIndex].id);
          } else {
            setActiveTabId(null);
            setViewMode("dashboard");
          }
        }
      },
      [
        activeTabId,
        onSaveCurrentTab,
        openTabs,
        setActiveTabId,
        setOpenTabs,
        setTabCache,
        setViewMode,
      ],
    );

    const handleMiddleClick = useCallback(
      (id: string, e: React.MouseEvent) => {
        if (e.button === 1) {
          closeTab(id, e);
        }
      },
      [closeTab],
    );

    const startRename = useCallback(
      (id: string, name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTabId(id);
        setEditName(name);
        setTimeout(() => inputRef.current?.select(), 0);
      },
      [],
    );

    const finishRename = useCallback(async () => {
      if (!editingTabId) {
        return;
      }
      const trimmed = editName.trim();
      if (trimmed) {
        await DiagramStore.rename(editingTabId, trimmed);
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.id === editingTabId ? { ...t, name: trimmed } : t,
          ),
        );
      }
      setEditingTabId(null);
    }, [editingTabId, editName, setOpenTabs]);

    const handleNewTab = useCallback(async () => {
      const name = await appPrompt({
        title: "New Diagram",
        placeholder: "Untitled",
      });
      if (name === null) {
        return;
      }
      await onSaveCurrentTab();
      const diagram = await DiagramStore.create(name.trim() || undefined);
      setOpenTabs((prev) => [
        ...prev,
        { id: diagram.id, name: diagram.name, isDirty: false },
      ]);
      setActiveTabId(diagram.id);
    }, [onSaveCurrentTab, setOpenTabs, setActiveTabId]);

    const handleHome = useCallback(async () => {
      await onSaveCurrentTab();
      setViewMode("dashboard");
    }, [onSaveCurrentTab, setViewMode]);

    return (
      <div className="tab-bar">
        <div className="tab-bar__tabs">
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-bar__tab ${
                tab.id === activeTabId ? "tab-bar__tab--active" : ""
              }`}
              onClick={() => switchTab(tab.id)}
              onMouseDown={(e) => handleMiddleClick(tab.id, e)}
              title={tab.name}
            >
              {tab.isDirty && <span className="tab-bar__dirty-dot" />}
              {editingTabId === tab.id ? (
                <input
                  ref={inputRef}
                  className="tab-bar__rename-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      finishRename();
                    } else if (e.key === "Escape") {
                      setEditingTabId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="tab-bar__tab-name"
                  onDoubleClick={(e) => startRename(tab.id, tab.name, e)}
                >
                  {tab.name}
                </span>
              )}
              <button
                className="tab-bar__close-btn"
                onClick={(e) => closeTab(tab.id, e)}
                aria-label={`Close ${tab.name}`}
              >
                &times;
              </button>
            </div>
          ))}
          <button
            className="tab-bar__new-btn"
            onClick={handleNewTab}
            title="New diagram"
          >
            +
          </button>
        </div>
        <VersionPanel
          excalidrawAPI={excalidrawAPI}
          onSaveCurrentTab={onSaveCurrentTab}
        />
        <button
          className="tab-bar__home-btn"
          onClick={handleHome}
          title="Dashboard"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
      </div>
    );
  },
);

TabBar.displayName = "TabBar";
