import React from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TabBar } from "./TabBar/TabBar";

import "./EditorWithTabs.scss";

interface EditorWithTabsProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onSaveCurrentTab: () => Promise<void>;
  children: React.ReactNode;
}

export const EditorWithTabs: React.FC<EditorWithTabsProps> = ({
  excalidrawAPI,
  onSaveCurrentTab,
  children,
}) => {
  return (
    <div className="editor-with-tabs">
      <TabBar
        excalidrawAPI={excalidrawAPI}
        onSaveCurrentTab={onSaveCurrentTab}
      />
      <div className="editor-with-tabs__content">{children}</div>
    </div>
  );
};
