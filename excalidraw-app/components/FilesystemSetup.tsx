import React, { useCallback, useEffect, useState } from "react";

import { useAtom, useSetAtom } from "../app-jotai";
import { diagramIndexAtom, filesystemEnabledAtom } from "../atoms/diagramAtoms";
import { DiagramStore } from "../data/DiagramStore";
import { FilesystemSync } from "../data/FilesystemSync";

import "./FilesystemSetup.scss";

const DISMISSED_KEY = "excalidraw-fs-setup-dismissed";

export const FilesystemSetup: React.FC = () => {
  const [fsEnabled, setFsEnabled] = useAtom(filesystemEnabledAtom);
  const setDiagramIndex = useSetAtom(diagramIndexAtom);
  const [directoryName, setDirectoryName] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "true",
  );

  useEffect(() => {
    FilesystemSync.getDirectoryName().then(setDirectoryName);
  }, [fsEnabled]);

  const handleChooseFolder = useCallback(async () => {
    const handle = await FilesystemSync.pickDirectory();
    if (handle) {
      setFsEnabled(true);
      setDirectoryName(handle.name);
    }
  }, [setFsEnabled]);

  const handleChangeFolder = useCallback(async () => {
    const handle = await FilesystemSync.pickDirectory();
    if (handle) {
      setDirectoryName(handle.name);
    }
  }, []);

  const handleDisable = useCallback(async () => {
    await FilesystemSync.disable();
    setFsEnabled(false);
    setDirectoryName(null);
  }, [setFsEnabled]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  }, []);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    setRestoreResult(null);
    try {
      const files = await FilesystemSync.scanDirectory();
      if (files.length === 0) {
        setRestoreResult("No .excalidraw files found in folder.");
        setRestoring(false);
        return;
      }

      // Get existing diagram names to avoid duplicates
      const existingIndex = await DiagramStore.getIndex();
      const existingNames = new Set(existingIndex.map((d) => d.name));

      let imported = 0;
      for (const file of files) {
        const name =
          file.name.replace(/\.excalidraw$/, "").replace(/\.json$/, "") ||
          "Imported";
        // Skip if a diagram with the same name already exists
        if (existingNames.has(name)) {
          continue;
        }
        try {
          await DiagramStore.importFromFile(file);
          existingNames.add(name);
          imported++;
        } catch {
          // skip invalid files
        }
      }

      const updatedIndex = await DiagramStore.getIndex();
      setDiagramIndex(updatedIndex);

      if (imported === 0) {
        setRestoreResult("All diagrams already exist. Nothing to restore.");
      } else {
        setRestoreResult(`Restored ${imported} diagram${imported !== 1 ? "s" : ""}.`);
      }
    } catch (err) {
      console.error("Restore failed:", err);
      setRestoreResult("Restore failed. Check folder permissions.");
    }
    setRestoring(false);
  }, [setDiagramIndex]);

  if (!FilesystemSync.isSupported()) {
    return null;
  }

  // Already configured — show status bar
  if (fsEnabled && directoryName) {
    return (
      <div className="fs-setup fs-setup--configured">
        <div className="fs-setup__status">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="fs-setup__icon"
          >
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span>
            Syncing to <strong>{directoryName}</strong>
          </span>
          {restoreResult && (
            <span className="fs-setup__result">{restoreResult}</span>
          )}
        </div>
        <div className="fs-setup__actions">
          <button
            className="fs-setup__link-btn"
            onClick={handleRestore}
            disabled={restoring}
          >
            {restoring ? "Restoring..." : "Restore"}
          </button>
          <button className="fs-setup__link-btn" onClick={handleChangeFolder}>
            Change
          </button>
          <button className="fs-setup__link-btn" onClick={handleDisable}>
            Disable
          </button>
        </div>
      </div>
    );
  }

  // Dismissed — don't show
  if (dismissed) {
    return null;
  }

  // First-run prompt
  return (
    <div className="fs-setup fs-setup--prompt">
      <div className="fs-setup__content">
        <div className="fs-setup__text">
          <strong>Save diagrams to a folder?</strong>
          <span>
            Diagrams are saved in the browser. You can also sync them as
            .excalidraw files to a folder on your computer. If your browser data
            is cleared, you can restore diagrams from the folder.
          </span>
        </div>
        <div className="fs-setup__actions">
          <button
            className="fs-setup__btn fs-setup__btn--primary"
            onClick={handleChooseFolder}
          >
            Choose Folder
          </button>
          <button
            className="fs-setup__btn fs-setup__btn--secondary"
            onClick={handleDismiss}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
};
