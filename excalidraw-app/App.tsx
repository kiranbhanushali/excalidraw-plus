import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  THEME,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { useCallbackRefState } from "@excalidraw/excalidraw/hooks/useCallbackRefState";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useSetAtom,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { ExcalidrawPlusPromoBanner } from "./components/ExcalidrawPlusPromoBanner";
import { AppSidebar } from "./components/AppSidebar";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { EditorWithTabs } from "./components/EditorWithTabs";
import {
  viewModeAtom,
  openTabsAtom,
  activeTabIdAtom,
  tabCacheAtom,
  diagramIndexAtom,
  filesystemEnabledAtom,
} from "./atoms/diagramAtoms";
import { DiagramStore } from "./data/DiagramStore";
import { FilesystemSync } from "./data/FilesystemSync";
import { generateThumbnail } from "./data/thumbnailGenerator";
import { migrateLocalStorageToIDB } from "./data/migration";
import { AppModalRenderer, appPrompt, appConfirm } from "./components/AppModal";

import type { DiagramData } from "./data/DiagramStore";
import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // --- Diagram tab state ---
  const setViewMode = useSetAtom(viewModeAtom);
  const [openTabs, setOpenTabs] = useAtom(openTabsAtom);
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom);
  const setTabCache = useSetAtom(tabCacheAtom);
  const setDiagramIndex = useSetAtom(diagramIndexAtom);
  const prevActiveTabRef = useRef<string | null>(null);
  // Tracks which tab's content is actually loaded in the Excalidraw canvas.
  // This prevents onChange from saving stale content to the wrong tab during switches.
  const loadedTabRef = useRef<string | null>(null);
  const tabCacheRef = useRef<Map<string, DiagramData>>(new Map());
  const dirtyTabsRef = useRef(new Set<string>());
  const initialDataResolvedRef = useRef(false);

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  // --- Save current tab state to cache + IDB ---
  const saveCurrentTabState = useCallback(async () => {
    if (!excalidrawAPI || !activeTabId) {
      return;
    }
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const { collaborators: _, ...appState } = excalidrawAPI.getAppState();
    const files = excalidrawAPI.getFiles();
    const data: DiagramData = {
      elements: [...elements],
      appState,
      files: { ...files },
    };

    // Update in-memory cache (both ref and atom)
    tabCacheRef.current.set(activeTabId, data);
    setTabCache((prev) => {
      const next = new Map(prev);
      next.set(activeTabId, data);
      return next;
    });

    // Cancel any pending debounced save to prevent it from overwriting
    // our immediate save with stale data.
    DiagramStore.cancelPendingSave(activeTabId);

    // Save to IDB immediately — this runs at transition points (tab switches,
    // dashboard navigation) where data must be persisted before continuing.
    await DiagramStore.saveImmediate(activeTabId, data);

    // Generate and save thumbnail for the dashboard index
    try {
      const thumbnail = await generateThumbnail(data.elements, data.files);
      if (thumbnail) {
        await DiagramStore.updateThumbnail(activeTabId, thumbnail);
      }
    } catch {
      // non-critical
    }
  }, [excalidrawAPI, activeTabId, setTabCache]);

  // --- Tab switching: load new tab data into Excalidraw ---
  useEffect(() => {
    if (!excalidrawAPI || !activeTabId) {
      return;
    }
    if (prevActiveTabRef.current === activeTabId) {
      return;
    }
    prevActiveTabRef.current = activeTabId;

    // Prevent onChange from saving stale content to the new tab
    // while we're loading it. It will be re-enabled after the scene loads.
    loadedTabRef.current = null;

    const loadTab = async () => {
      // Try ref cache first, then atom cache (populated by Dashboard)
      let data =
        tabCacheRef.current.get(activeTabId) ||
        appJotaiStore.get(tabCacheAtom).get(activeTabId);
      if (!data) {
        // Load from IDB
        const diagram = await DiagramStore.get(activeTabId);
        if (diagram) {
          data = diagram.data;
        }
      }
      if (data) {
        tabCacheRef.current.set(activeTabId, data);
      }

      if (data) {
        // Strip collaborators — Maps don't survive JSON round-trips.
        const { collaborators: _, ...cleanAppState } = data.appState as any;
        const restoredElements = restoreElements(data.elements, null, {
          repairBindings: true,
        });
        const restoredAppState = restoreAppState(cleanAppState, null);

        if (!initialDataResolvedRef.current) {
          // First load: resolve the initialData promise with actual data so
          // Excalidraw's internal initializeScene processes it correctly
          // (resolving with null would cause a blank canvas reset).
          initialDataResolvedRef.current = true;
          initialStatePromiseRef.current.promise.resolve({
            elements: restoredElements,
            appState: restoredAppState,
          });
        } else {
          // Subsequent tab switches: update the scene directly
          excalidrawAPI.updateScene({
            elements: restoredElements,
            appState: restoredAppState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          excalidrawAPI.history.clear();
          excalidrawAPI.scrollToContent();
        }

        // Load files
        const fileValues = Object.values(data.files);
        if (fileValues.length) {
          excalidrawAPI.addFiles(fileValues);
        }
      } else {
        // New empty diagram
        if (!initialDataResolvedRef.current) {
          initialDataResolvedRef.current = true;
          initialStatePromiseRef.current.promise.resolve(null);
        } else {
          excalidrawAPI.resetScene();
        }
      }

      // Now that the scene is loaded, enable onChange for this tab
      loadedTabRef.current = activeTabId;
    };

    loadTab();
  }, [excalidrawAPI, activeTabId]);

  // --- Keyboard shortcuts for tabs ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) {
        return;
      }

      if (e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (activeTabId) {
          saveCurrentTabState();
        }
      } else if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        // Create new diagram
        (async () => {
          const name = await appPrompt({
            title: "New Diagram",
            placeholder: "Untitled",
          });
          if (name === null) {
            return;
          }
          await saveCurrentTabState();
          const diagram = await DiagramStore.create(name.trim() || undefined);
          const updatedIndex = await DiagramStore.getIndex();
          setDiagramIndex(updatedIndex);
          setTabCache((prev) => {
            const next = new Map(prev);
            next.set(diagram.id, diagram.data);
            return next;
          });
          setOpenTabs((prev) => [
            ...prev,
            { id: diagram.id, name: diagram.name, isDirty: false },
          ]);
          setActiveTabId(diagram.id);
          setViewMode("editor");
        })();
      } else if (e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        if (activeTabId && openTabs.length > 0) {
          (async () => {
            await saveCurrentTabState();
            const tabIndex = openTabs.findIndex((t) => t.id === activeTabId);
            const newTabs = openTabs.filter((t) => t.id !== activeTabId);
            setOpenTabs(newTabs);
            setTabCache((prev) => {
              const next = new Map(prev);
              next.delete(activeTabId);
              return next;
            });
            if (newTabs.length > 0) {
              const nextIndex = Math.min(tabIndex, newTabs.length - 1);
              setActiveTabId(newTabs[nextIndex].id);
            } else {
              setActiveTabId(null);
              setViewMode("dashboard");
            }
          })();
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (openTabs.length > 1 && activeTabId) {
          const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + openTabs.length) % openTabs.length
            : (currentIndex + 1) % openTabs.length;
          (async () => {
            await saveCurrentTabState();
            setActiveTabId(openTabs[nextIndex].id);
          })();
        }
      } else if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < openTabs.length) {
          (async () => {
            await saveCurrentTabState();
            setActiveTabId(openTabs[index].id);
          })();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTabId,
    openTabs,
    saveCurrentTabState,
    setActiveTabId,
    setDiagramIndex,
    setOpenTabs,
    setTabCache,
    setViewMode,
  ]);

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    const loadImages = (
      data: ResolutionType<typeof initializeScene>,
      isInitialLoad = false,
    ) => {
      if (!data.scene) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
        }
      }
    };

    // Skip initializeScene when tabs are active (initialData already resolved).
    if (!activeTabId) {
      initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
        loadImages(data, /* isInitialLoad */ true);
        initialStatePromiseRef.current.promise.resolve(data.scene);
      });
    }

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      // Skip hash-based scene reloading when tab content is managed by IndexedDB.
      if (loadedTabRef.current) {
        return;
      }
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      // Skip localStorage sync when tab content is managed by IndexedDB.
      if (loadedTabRef.current) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
      // Use the ref to get the latest activeTabId
      if (prevActiveTabRef.current) {
        DiagramStore.flushSave(prevActiveTabRef.current);
      }
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();
      if (prevActiveTabRef.current) {
        DiagramStore.flushSave(prevActiveTabRef.current);
      }

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // Save to DiagramStore if a diagram tab is active.
    // Use loadedTabRef (not activeTabId) to avoid saving stale content
    // to the wrong tab during tab switches.
    const currentLoadedTab = loadedTabRef.current;
    if (currentLoadedTab) {
      // Strip collaborators before storing — Maps don't survive JSON
      // round-trips (become plain objects) and collaborators are transient.
      const { collaborators: _, ...storedAppState } = appState;
      const data: DiagramData = {
        elements: [...elements],
        appState: storedAppState,
        files: { ...files },
      };
      // Update ref directly — no state update to avoid re-render loops
      tabCacheRef.current.set(currentLoadedTab, data);
      // Save to IDB (debounced)
      DiagramStore.save(currentLoadedTab, data);

      // Mark tab as dirty (only once to avoid re-render loops)
      if (!dirtyTabsRef.current.has(currentLoadedTab)) {
        dirtyTabsRef.current.add(currentLoadedTab);
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.id === currentLoadedTab ? { ...t, isDirty: true } : t,
          ),
        );
      }
    }

    // Save to localStorage for backward compat / collab (only when tab is loaded).
    if (currentLoadedTab && !LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  const editorContent = (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        excalidrawAPI={excalidrawRefCallback}
        onChange={onChange}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        name={openTabs.find((t) => t.id === activeTabId)?.name}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              {excalidrawAPI?.getEditorInterface().formFactor === "desktop" && (
                <ExcalidrawPlusPromoBanner
                  isSignedIn={isExcalidrawPlusSignedUser}
                />
              )}

              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
          hasDiagramContext={!!activeTabId}
          onDashboard={async () => {
            await saveCurrentTabState();
            setViewMode("dashboard");
          }}
          onNewDiagram={async () => {
            const name = await appPrompt({
              title: "New Diagram",
              placeholder: "Untitled",
            });
            if (name === null) {
              return;
            }
            await saveCurrentTabState();
            const diagramName = name.trim() || undefined;
            const diagram = await DiagramStore.create(diagramName);
            const updatedIndex = await DiagramStore.getIndex();
            setDiagramIndex(updatedIndex);
            setTabCache((prev) => {
              const next = new Map(prev);
              next.set(diagram.id, diagram.data);
              return next;
            });
            setOpenTabs((prev) => [
              ...prev,
              { id: diagram.id, name: diagram.name, isDirty: false },
            ]);
            setActiveTabId(diagram.id);
            setViewMode("editor");
          }}
          onRenameDiagram={
            activeTabId
              ? async () => {
                  const tab = openTabs.find((t) => t.id === activeTabId);
                  if (!tab) {
                    return;
                  }
                  const newName = await appPrompt({
                    title: "Rename Diagram",
                    defaultValue: tab.name,
                  });
                  if (newName?.trim()) {
                    await DiagramStore.rename(activeTabId, newName.trim());
                    setOpenTabs((prev) =>
                      prev.map((t) =>
                        t.id === activeTabId
                          ? { ...t, name: newName.trim() }
                          : t,
                      ),
                    );
                    const updatedIndex = await DiagramStore.getIndex();
                    setDiagramIndex(updatedIndex);
                  }
                }
              : undefined
          }
          onDuplicateDiagram={
            activeTabId
              ? async () => {
                  await saveCurrentTabState();
                  const dup = await DiagramStore.duplicate(activeTabId);
                  const updatedIndex = await DiagramStore.getIndex();
                  setDiagramIndex(updatedIndex);
                  setTabCache((prev) => {
                    const next = new Map(prev);
                    next.set(dup.id, dup.data);
                    return next;
                  });
                  setOpenTabs((prev) => [
                    ...prev,
                    { id: dup.id, name: dup.name, isDirty: false },
                  ]);
                  setActiveTabId(dup.id);
                }
              : undefined
          }
          onExportDiagram={
            activeTabId
              ? async () => {
                  await saveCurrentTabState();
                  await DiagramStore.exportToFile(activeTabId);
                }
              : undefined
          }
          onImportDiagram={async () => {
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
                setTabCache((prev) => {
                  const next = new Map(prev);
                  next.set(diagram.id, diagram.data);
                  return next;
                });
                setOpenTabs((prev) => [
                  ...prev,
                  { id: diagram.id, name: diagram.name, isDirty: false },
                ]);
                setActiveTabId(diagram.id);
                setViewMode("editor");
              } catch (err) {
                console.error("Failed to import file:", err);
              }
            };
            input.click();
          }}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: "Go to Dashboard",
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              keywords: ["home", "dashboard", "diagrams", "list"],
              perform: async () => {
                await saveCurrentTabState();
                setViewMode("dashboard");
              },
            },
            {
              label: "New Diagram",
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              keywords: ["create", "new", "diagram", "tab"],
              perform: async () => {
                const name = await appPrompt({
                  title: "New Diagram",
                  placeholder: "Untitled",
                });
                if (name === null) {
                  return;
                }
                await saveCurrentTabState();
                const diagramName = name.trim() || undefined;
                const diagram = await DiagramStore.create(diagramName);
                const updatedIndex = await DiagramStore.getIndex();
                setDiagramIndex(updatedIndex);
                setTabCache((prev) => {
                  const next = new Map(prev);
                  next.set(diagram.id, diagram.data);
                  return next;
                });
                setOpenTabs((prev) => [
                  ...prev,
                  { id: diagram.id, name: diagram.name, isDirty: false },
                ]);
                setActiveTabId(diagram.id);
                setViewMode("editor");
              },
            },
            {
              label: "Close Tab",
              category: DEFAULT_CATEGORIES.app,
              predicate: () => openTabs.length > 0,
              keywords: ["close", "tab", "remove"],
              perform: async () => {
                if (!activeTabId) {
                  return;
                }
                await saveCurrentTabState();
                const tabIndex = openTabs.findIndex(
                  (t) => t.id === activeTabId,
                );
                const newTabs = openTabs.filter((t) => t.id !== activeTabId);
                setOpenTabs(newTabs);
                setTabCache((prev) => {
                  const next = new Map(prev);
                  next.delete(activeTabId);
                  return next;
                });
                if (newTabs.length > 0) {
                  const nextIndex = Math.min(tabIndex, newTabs.length - 1);
                  setActiveTabId(newTabs[nextIndex].id);
                } else {
                  setActiveTabId(null);
                  setViewMode("dashboard");
                }
              },
            },
            {
              label: "Close Other Tabs",
              category: DEFAULT_CATEGORIES.app,
              predicate: () => openTabs.length > 1,
              keywords: ["close", "other", "tabs"],
              perform: async () => {
                if (!activeTabId) {
                  return;
                }
                await saveCurrentTabState();
                const currentTab = openTabs.find((t) => t.id === activeTabId);
                if (currentTab) {
                  setOpenTabs([currentTab]);
                  setTabCache((prev) => {
                    const next = new Map();
                    const data = prev.get(activeTabId);
                    if (data) {
                      next.set(activeTabId, data);
                    }
                    return next;
                  });
                }
              },
            },
            {
              label: "Switch to Next Tab",
              category: DEFAULT_CATEGORIES.app,
              predicate: () => openTabs.length > 1,
              keywords: ["next", "tab", "switch"],
              perform: async () => {
                if (!activeTabId || openTabs.length <= 1) {
                  return;
                }
                await saveCurrentTabState();
                const currentIndex = openTabs.findIndex(
                  (t) => t.id === activeTabId,
                );
                const nextIndex = (currentIndex + 1) % openTabs.length;
                setActiveTabId(openTabs[nextIndex].id);
              },
            },
            {
              label: "Switch to Previous Tab",
              category: DEFAULT_CATEGORIES.app,
              predicate: () => openTabs.length > 1,
              keywords: ["previous", "tab", "switch"],
              perform: async () => {
                if (!activeTabId || openTabs.length <= 1) {
                  return;
                }
                await saveCurrentTabState();
                const currentIndex = openTabs.findIndex(
                  (t) => t.id === activeTabId,
                );
                const prevIndex =
                  (currentIndex - 1 + openTabs.length) % openTabs.length;
                setActiveTabId(openTabs[prevIndex].id);
              },
            },
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );

  // Wrap with tabs if we have open tabs
  if (openTabs.length > 0) {
    return (
      <EditorWithTabs
        excalidrawAPI={excalidrawAPI}
        onSaveCurrentTab={saveCurrentTabState}
      >
        {editorContent}
      </EditorWithTabs>
    );
  }

  return editorContent;
};

const AppContent = () => {
  const viewMode = useAtomValue(viewModeAtom);
  const openTabs = useAtomValue(openTabsAtom);
  const isCollaborating = useAtomValue(isCollaboratingAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const setOpenTabs = useSetAtom(openTabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);
  const setTabCache = useSetAtom(tabCacheAtom);
  const setDiagramIndex = useSetAtom(diagramIndexAtom);
  const setFilesystemEnabled = useSetAtom(filesystemEnabledAtom);

  const isInitialRender = useRef(true);

  // URL → viewMode: resolve initial route on mount
  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/dashboard") {
      setViewMode("dashboard");
    } else if (path === "/" || path === "") {
      // If persisted tabs exist, show editor; otherwise dashboard
      if (openTabs.length === 0) {
        setViewMode("dashboard");
      } else {
        setViewMode("editor");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // viewMode → URL: sync URL when view changes
  useEffect(() => {
    const targetPath = viewMode === "dashboard" ? "/dashboard" : "/";
    if (window.location.pathname !== targetPath) {
      if (isInitialRender.current) {
        window.history.replaceState({ viewMode }, "", targetPath);
      } else {
        window.history.pushState({ viewMode }, "", targetPath);
      }
    }
    isInitialRender.current = false;
  }, [viewMode]);

  // popstate: handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/dashboard") {
        setViewMode("dashboard");
      } else {
        setViewMode("editor");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setViewMode]);

  // Migration + filesystem init: run on first mount
  useEffect(() => {
    const runInit = async () => {
      const migratedId = await migrateLocalStorageToIDB();
      if (migratedId) {
        const diagram = await DiagramStore.get(migratedId);
        if (diagram) {
          setTabCache((prev) => {
            const next = new Map(prev);
            next.set(migratedId, diagram.data);
            return next;
          });
          setOpenTabs([{ id: migratedId, name: diagram.name, isDirty: false }]);
          setActiveTabId(migratedId);
          setViewMode("editor");
        }
      }
      const index = await DiagramStore.getIndex();
      setDiagramIndex(index);

      // Check if filesystem sync is configured
      const fsEnabled = await FilesystemSync.isEnabled();
      setFilesystemEnabled(fsEnabled);
    };
    runInit();
  }, [
    setTabCache,
    setOpenTabs,
    setActiveTabId,
    setViewMode,
    setDiagramIndex,
    setFilesystemEnabled,
  ]);

  // Show dashboard when in dashboard mode and not collaborating
  const isCollabLink = isCollaborationLink(window.location.href);
  if (viewMode === "dashboard" && !isCollaborating && !isCollabLink) {
    return (
      <div style={{ height: "100%" }} className="excalidraw-app">
        <Dashboard />
      </div>
    );
  }

  return <ExcalidrawWrapper />;
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <AppContent />
        <AppModalRenderer />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
