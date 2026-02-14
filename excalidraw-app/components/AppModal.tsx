import React, { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { atom, useAtom, appJotaiStore } from "../app-jotai";

import "./AppModal.scss";

// --- Types ---

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: "primary" | "danger";
}

interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

type ModalState =
  | {
      type: "confirm";
      options: ConfirmOptions;
      resolve: (result: boolean) => void;
    }
  | {
      type: "prompt";
      options: PromptOptions;
      resolve: (result: string | null) => void;
    };

// --- Atom ---

export const appModalAtom = atom<ModalState | null>(null);

// --- Imperative API ---

export function appConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    appJotaiStore.set(appModalAtom, {
      type: "confirm",
      options,
      resolve,
    });
  });
}

export function appPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    appJotaiStore.set(appModalAtom, {
      type: "prompt",
      options,
      resolve,
    });
  });
}

// --- Confirm Dialog ---

const AppConfirmDialog: React.FC<{
  options: ConfirmOptions;
  onResult: (result: boolean) => void;
}> = ({ options, onResult }) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onResult(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onResult]);

  return (
    <div className="app-modal__overlay" onClick={() => onResult(false)}>
      <div
        className="app-modal__content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
      >
        <h2 className="app-modal__title" id="app-modal-title">
          {options.title}
        </h2>
        <p className="app-modal__message">{options.message}</p>
        <div className="app-modal__buttons">
          <button
            className="app-modal__btn app-modal__btn--cancel"
            onClick={() => onResult(false)}
            type="button"
          >
            {options.cancelText || "Cancel"}
          </button>
          <button
            ref={confirmRef}
            className={`app-modal__btn app-modal__btn--${options.confirmStyle || "danger"}`}
            onClick={() => onResult(true)}
            type="button"
          >
            {options.confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Prompt Dialog ---

const AppPromptDialog: React.FC<{
  options: PromptOptions;
  onResult: (result: string | null) => void;
}> = ({ options, onResult }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onResult(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onResult]);

  const handleSubmit = useCallback(() => {
    const value = inputRef.current?.value.trim() || "";
    onResult(value);
  }, [onResult]);

  return (
    <div className="app-modal__overlay" onClick={() => onResult(null)}>
      <div
        className="app-modal__content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
      >
        <h2 className="app-modal__title" id="app-modal-title">
          {options.title}
        </h2>
        {options.message && (
          <p className="app-modal__message">{options.message}</p>
        )}
        <input
          ref={inputRef}
          className="app-modal__input"
          defaultValue={options.defaultValue || ""}
          placeholder={options.placeholder || ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            }
          }}
        />
        <div className="app-modal__buttons">
          <button
            className="app-modal__btn app-modal__btn--cancel"
            onClick={() => onResult(null)}
            type="button"
          >
            {options.cancelText || "Cancel"}
          </button>
          <button
            className="app-modal__btn app-modal__btn--primary"
            onClick={handleSubmit}
            type="button"
          >
            {options.confirmText || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Renderer (mount once at app root) ---

export const AppModalRenderer: React.FC = () => {
  const [modalState, setModalState] = useAtom(appModalAtom);

  const handleResult = useCallback(
    (result: boolean | string | null) => {
      if (modalState) {
        (modalState.resolve as (result: boolean | string | null) => void)(
          result,
        );
      }
      setModalState(null);
    },
    [modalState, setModalState],
  );

  if (!modalState) {
    return null;
  }

  return createPortal(
    modalState.type === "confirm" ? (
      <AppConfirmDialog options={modalState.options} onResult={handleResult} />
    ) : (
      <AppPromptDialog options={modalState.options} onResult={handleResult} />
    ),
    document.body,
  );
};
