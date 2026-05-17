import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirmDirtyTransition } from "./app/commands";
import { isTauriRuntime } from "./app/runtime";
import {
  documentReducer,
  initialDocumentState,
  type DocumentState,
} from "./app/useDocumentState";
import { ErrorBanner } from "./components/ErrorBanner";
import { EmptyState } from "./components/EmptyState";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { getInitialFilePath } from "./features/cli/initialFile";
import { preservesPlanCycleNotes } from "./features/editor/editorSerialization";
import { MarkdownEditor } from "./features/editor/MarkdownEditor";
import {
  createMarkdownDocument,
  fileFailure,
  isFileFailure,
  loadMarkdownFile,
  pickMarkdownFile,
  saveMarkdownFile,
  saveMarkdownFileAs,
} from "./features/files/markdownFiles";
import type { FileFailure } from "./features/files/types";
import { SourceEditor } from "./features/source/SourceEditor";
import { useReducer } from "react";

const SCREENSHOT_SOURCE_SAMPLE = `# Plan: Screenshot

## Task Breakdown

- [ ] Capture source mode

> **NOTE**: screenshot notes stay grep-detectable

\`\`\`ts
export const value = 1;
\`\`\`
`;

const SCREENSHOT_WYSIWYG_SAMPLE = `# Draft Notes

## Today

This document shows **rich Markdown** with \`inline code\`, blockquotes, and lists.

> A compact editor for local Markdown files.

- Fast startup
- Native file dialogs
- Source mode when exact Markdown matters

- [ ] Review draft
- [x] Save locally
`;

export default function App() {
  const [state, dispatch] = useReducer(documentReducer, initialDocumentState);
  const stateRef = useRef<DocumentState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fail = useCallback((error: unknown, fallback: FileFailure) => {
    dispatch({ type: "failed", error: isFileFailure(error) ? error : fallback });
  }, []);

  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!canSaveCurrentDraft(current)) {
      dispatch({
        type: "failed",
        error: fileFailure(
          "write-failed",
          "Plan-cycle note markers must be preserved before saving.",
        ),
      });
      return false;
    }

    dispatch({ type: "saving" });
    try {
      const document = await saveMarkdownFileAs(current.draftMarkdown, {
        defaultPath: current.active?.path,
        lineEnding: current.active?.lineEnding ?? "lf",
      });
      if (!document) {
        dispatch({ type: "idle" });
        return false;
      }
      dispatch({ type: "saved", document });
      return true;
    } catch (error) {
      fail(error, fileFailure("write-failed", "The file could not be saved."));
      return false;
    }
  }, [fail]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!canSaveCurrentDraft(current)) {
      dispatch({
        type: "failed",
        error: fileFailure(
          "write-failed",
          "Plan-cycle note markers must be preserved before saving.",
        ),
      });
      return false;
    }

    if (!current.active) {
      return handleSaveAs();
    }

    dispatch({ type: "saving" });
    try {
      const document = await saveMarkdownFile(current.active, current.draftMarkdown);
      dispatch({ type: "saved", document });
      return true;
    } catch (error) {
      fail(error, fileFailure("write-failed", "The file could not be saved."));
      return false;
    }
  }, [fail, handleSaveAs]);

  const runDirtyTransition = useCallback(
    async (next: () => Promise<void> | void) => {
      const choice = await confirmDirtyTransition(stateRef.current);
      if (choice === "cancel") return;
      if (choice === "save") {
        const saved = await handleSave();
        if (!saved) return;
      }
      await next();
    },
    [handleSave],
  );

  const openPath = useCallback(
    async (path: string, warning?: FileFailure | null) => {
      dispatch({ type: "opening" });
      try {
        const document = await loadMarkdownFile(path);
        dispatch({ type: "opened", document, warning });
      } catch (error) {
        fail(error, fileFailure("read-failed", "The file could not be read."));
      }
    },
    [fail],
  );

  const handleOpen = useCallback(async () => {
    await runDirtyTransition(async () => {
      const selected = await pickMarkdownFile();
      if (!selected) return;
      await openPath(selected);
    });
  }, [openPath, runDirtyTransition]);

  const handleNew = useCallback(async () => {
    await runDirtyTransition(() => {
      dispatch({ type: "new" });
    });
  }, [runDirtyTransition]);

  useEffect(() => {
    const screenshotMode = new URLSearchParams(window.location.search).get(
      "screenshot",
    );
    if (screenshotMode === "source" || screenshotMode === "wysiwyg") {
      const contents =
        screenshotMode === "source"
          ? SCREENSHOT_SOURCE_SAMPLE
          : SCREENSHOT_WYSIWYG_SAMPLE;
      const document = createMarkdownDocument(
        `/tmp/${screenshotMode}-demo.md`,
        contents,
        null,
      );
      dispatch({ type: "opened", document });
      if (screenshotMode === "wysiwyg") {
        dispatch({ type: "mode", viewMode: "wysiwyg" });
      }
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;

    getInitialFilePath()
      .then(async ({ path, warning }) => {
        if (!path || cancelled) return;
        await openPath(path, warning);
      })
      .catch((error) => {
        if (!cancelled) {
          fail(error, fileFailure("read-failed", "The file could not be read."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fail, openPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (!command) return;

      if (event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void handleSaveAs();
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handleOpen();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpen, handleSave, handleSaveAs]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!stateRef.current.dirty) return;

        event.preventDefault();
        const choice = await confirmDirtyTransition(stateRef.current);
        if (choice === "cancel") return;
        if (choice === "save") {
          const saved = await handleSave();
          if (!saved) return;
        }
        await getCurrentWindow().destroy();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {
        dispatch({
          type: "failed",
          error: fileFailure("read-failed", "The file operation failed."),
        });
      });

    return () => {
      unlisten?.();
    };
  }, [handleSave]);

  const hasEditor = state.active !== null || state.dirty;

  return (
    <div className="app-shell">
      <Toolbar
        busy={state.busy !== "idle"}
        dirty={state.dirty}
        viewMode={state.viewMode}
        canSave={hasEditor}
        onOpen={handleOpen}
        onSave={() => void handleSave()}
        onSaveAs={() => void handleSaveAs()}
        onNew={handleNew}
        onToggleSource={() =>
          dispatch({
            type: "mode",
            viewMode: state.viewMode === "source" ? "wysiwyg" : "source",
          })
        }
      />

      {state.lastError ? (
        <ErrorBanner
          error={state.lastError}
          onDismiss={() => dispatch({ type: "dismiss-error" })}
        />
      ) : null}

      <section className="workspace">
        {hasEditor ? (
          state.viewMode === "source" ? (
            <SourceEditor
              markdown={state.draftMarkdown}
              onMarkdownChange={(markdown) =>
                dispatch({ type: "draft", markdown })
              }
            />
          ) : (
            <MarkdownEditor
              key={`${state.active?.path ?? "untitled"}:${state.active?.loadedAt ?? 0}`}
              markdown={state.draftMarkdown}
              onMarkdownChange={(markdown) =>
                dispatch({ type: "draft", markdown })
              }
            />
          )
        ) : (
          <EmptyState onOpen={handleOpen} onNew={handleNew} />
        )}
      </section>

      <StatusBar
        active={state.active}
        dirty={state.dirty}
        busy={state.busy}
        draftMarkdown={state.draftMarkdown}
        viewMode={state.viewMode}
      />
    </div>
  );
}

function canSaveCurrentDraft(state: DocumentState): boolean {
  if (!state.active?.hasPlanCycleNotes || state.viewMode === "source") {
    return true;
  }

  return preservesPlanCycleNotes(state.active.contents, state.draftMarkdown);
}
