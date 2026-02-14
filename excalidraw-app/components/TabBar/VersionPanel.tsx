import React, { useCallback, useEffect, useRef, useState } from "react";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import { restoreAppState } from "@excalidraw/excalidraw/data/restore";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtomValue } from "../../app-jotai";
import { activeTabIdAtom } from "../../atoms/diagramAtoms";
import { DiagramStore } from "../../data/DiagramStore";
import { appConfirm } from "../AppModal";

import type { DiagramData, DiagramVersion } from "../../data/DiagramStore";

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) {
    return `Today ${time}`;
  }
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} ${time}`;
};

const buildAutoLabel = (counter: number, timestamp: number): string => {
  const d = new Date(timestamp);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `v${counter} · ${date} ${time}`;
};

interface VersionPanelProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onSaveCurrentTab: () => Promise<void>;
}

export const VersionPanel: React.FC<VersionPanelProps> = React.memo(
  ({ excalidrawAPI, onSaveCurrentTab }) => {
    const activeTabId = useAtomValue(activeTabIdAtom);
    const [showPanel, setShowPanel] = useState(false);
    const [versions, setVersions] = useState<DiagramVersion[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editNote, setEditNote] = useState("");
    const panelRef = useRef<HTMLDivElement>(null);
    const noteInputRef = useRef<HTMLInputElement>(null);

    // Reset state and load versions when tab changes
    useEffect(() => {
      setShowPanel(false);
      setEditingId(null);
      if (activeTabId) {
        DiagramStore.getVersions(activeTabId).then(setVersions);
      } else {
        setVersions([]);
      }
    }, [activeTabId]);

    // Close panel on outside click
    useEffect(() => {
      if (!showPanel) {
        return;
      }
      const handleClick = (e: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          setShowPanel(false);
          setEditingId(null);
        }
      };
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [showPanel]);

    // Focus note input when editing starts
    useEffect(() => {
      if (editingId) {
        setTimeout(() => noteInputRef.current?.focus(), 0);
      }
    }, [editingId]);

    const handleSaveVersion = useCallback(async () => {
      if (!activeTabId || !excalidrawAPI) {
        return;
      }

      await onSaveCurrentTab();

      const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const { collaborators: _, ...appState } = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      const data: DiagramData = {
        elements: [...elements],
        appState,
        files: { ...files },
      };

      const counter = versions.length + 1;
      const now = Date.now();
      const label = buildAutoLabel(counter, now);

      const version = await DiagramStore.saveVersion(
        activeTabId,
        label,
        data,
      );
      setVersions((prev) => [...prev, version]);
      setShowPanel(true);
    }, [activeTabId, excalidrawAPI, onSaveCurrentTab, versions.length]);

    const handleRestore = useCallback(
      async (versionId: string) => {
        if (!activeTabId) {
          return;
        }
        const confirmed = await appConfirm({
          title: "Restore Version",
          message:
            "Restore this version? Current changes will be overwritten.",
          confirmText: "Restore",
          confirmStyle: "danger",
        });
        if (!confirmed) {
          return;
        }
        const data = await DiagramStore.restoreVersion(activeTabId, versionId);
        if (data && excalidrawAPI) {
          const { collaborators: _, ...cleanAppState } = data.appState as any;
          excalidrawAPI.updateScene({
            elements: restoreElements(data.elements, null, {
              repairBindings: true,
            }),
            appState: restoreAppState(cleanAppState, null),
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          const fileValues = Object.values(data.files);
          if (fileValues.length) {
            excalidrawAPI.addFiles(fileValues);
          }
          excalidrawAPI.history.clear();
          excalidrawAPI.scrollToContent();
        }
        setShowPanel(false);
      },
      [activeTabId, excalidrawAPI],
    );

    const handleDelete = useCallback(
      async (versionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!activeTabId) {
          return;
        }
        await DiagramStore.deleteVersion(activeTabId, versionId);
        setVersions((prev) => prev.filter((v) => v.id !== versionId));
      },
      [activeTabId],
    );

    const handleStartEditNote = useCallback(
      (versionId: string, currentLabel: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(versionId);
        // Extract existing note (after the auto-label part)
        const noteMatch = currentLabel.match(/^v\d+\s*·\s*.*?\s*·\s*(.+)$/);
        setEditNote(noteMatch ? noteMatch[1] : "");
      },
      [],
    );

    const handleFinishEditNote = useCallback(async () => {
      if (!editingId || !activeTabId) {
        setEditingId(null);
        return;
      }
      const version = versions.find((v) => v.id === editingId);
      if (!version) {
        setEditingId(null);
        return;
      }
      const trimmed = editNote.trim();
      // Rebuild label: base auto-label + optional note
      const baseMatch = version.label.match(/^(v\d+\s*·\s*\S+\s+\S+)/);
      const base = baseMatch ? baseMatch[1] : version.label;
      const newLabel = trimmed ? `${base} · ${trimmed}` : base;

      await DiagramStore.updateVersionLabel(activeTabId, editingId, newLabel);

      setVersions((prev) =>
        prev.map((v) => (v.id === editingId ? { ...v, label: newLabel } : v)),
      );
      setEditingId(null);
    }, [editingId, editNote, activeTabId, versions]);

    if (!activeTabId) {
      return null;
    }

    return (
      <div className="version-panel-container" ref={panelRef}>
        <button
          className="tab-bar__version-btn"
          onClick={handleSaveVersion}
          title="Save version"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        </button>
        <button
          className="tab-bar__history-btn"
          onClick={() => setShowPanel(!showPanel)}
          title="Version history"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {versions.length > 0 && (
            <span className="version-panel__badge">{versions.length}</span>
          )}
        </button>

        {showPanel && (
          <div className="version-panel">
            <div className="version-panel__header">
              <span>Version History</span>
              <button
                className="version-panel__close"
                onClick={() => setShowPanel(false)}
              >
                &times;
              </button>
            </div>
            {versions.length === 0 ? (
              <div className="version-panel__empty">
                No saved versions yet.
                <br />
                Click the save icon to create one.
              </div>
            ) : (
              <div className="version-panel__list">
                {[...versions].reverse().map((v) => (
                  <div
                    key={v.id}
                    className="version-panel__item"
                    onClick={() => handleRestore(v.id)}
                  >
                    <div className="version-panel__item-info">
                      <span className="version-panel__item-label">
                        {v.label}
                      </span>
                      <span className="version-panel__item-time">
                        {formatTimestamp(v.timestamp)}
                      </span>
                    </div>
                    <div className="version-panel__item-actions">
                      <button
                        className="version-panel__item-edit"
                        onClick={(e) => handleStartEditNote(v.id, v.label, e)}
                        title="Add note"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        className="version-panel__item-delete"
                        onClick={(e) => handleDelete(v.id, e)}
                        title="Delete version"
                      >
                        &times;
                      </button>
                    </div>
                    {editingId === v.id && (
                      <div
                        className="version-panel__note-edit"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={noteInputRef}
                          className="version-panel__note-input"
                          placeholder="Add a note..."
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          onBlur={handleFinishEditNote}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleFinishEditNote();
                            } else if (e.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

VersionPanel.displayName = "VersionPanel";
