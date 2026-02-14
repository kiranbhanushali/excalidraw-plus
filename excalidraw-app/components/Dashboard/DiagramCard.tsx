import React, { useCallback, useRef, useState } from "react";

import type { DiagramIndexEntry } from "../../data/DiagramStore";

const getRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
};

interface DiagramCardProps {
  entry: DiagramIndexEntry;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}

export const DiagramCard: React.FC<DiagramCardProps> = React.memo(
  ({ entry, onOpen, onRename, onDuplicate, onDelete, onExport }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(entry.name);
    const [showMenu, setShowMenu] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const handleOpen = useCallback(() => {
      if (!isEditing) {
        onOpen(entry.id);
      }
    }, [entry.id, onOpen, isEditing]);

    const handleStartRename = useCallback(() => {
      setEditName(entry.name);
      setIsEditing(true);
      setShowMenu(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }, [entry.name]);

    const handleFinishRename = useCallback(() => {
      setIsEditing(false);
      const trimmed = editName.trim();
      if (trimmed && trimmed !== entry.name) {
        onRename(entry.id, trimmed);
      }
    }, [editName, entry.id, entry.name, onRename]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          handleFinishRename();
        } else if (e.key === "Escape") {
          setIsEditing(false);
          setEditName(entry.name);
        }
      },
      [handleFinishRename, entry.name],
    );

    const handleMenuClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMenu(!showMenu);
      },
      [showMenu],
    );

    return (
      <div className="diagram-card" onClick={handleOpen}>
        <div className="diagram-card__thumbnail">
          {entry.thumbnail ? (
            <img src={entry.thumbnail} alt={entry.name} />
          ) : (
            <div className="diagram-card__placeholder">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="12" y1="8" x2="12" y2="16" />
              </svg>
            </div>
          )}
        </div>
        <div className="diagram-card__info">
          <div className="diagram-card__name-row">
            {isEditing ? (
              <input
                ref={inputRef}
                className="diagram-card__name-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="diagram-card__name"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleStartRename();
                }}
              >
                {entry.name}
              </span>
            )}
          </div>
          <div className="diagram-card__meta">
            <span className="diagram-card__time">
              {getRelativeTime(entry.updatedAt)}
            </span>
            <span className="diagram-card__count">
              {entry.elementCount} element{entry.elementCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="diagram-card__menu-container">
          <button
            className="diagram-card__menu-btn"
            onClick={handleMenuClick}
            aria-label="Diagram options"
          >
            ...
          </button>
          {showMenu && (
            <div
              ref={menuRef}
              className="diagram-card__context-menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  handleStartRename();
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  onDuplicate(entry.id);
                  setShowMenu(false);
                }}
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  onExport(entry.id);
                  setShowMenu(false);
                }}
              >
                Export
              </button>
              <button
                className="diagram-card__delete-btn"
                onClick={() => {
                  onDelete(entry.id);
                  setShowMenu(false);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  },
);

DiagramCard.displayName = "DiagramCard";
