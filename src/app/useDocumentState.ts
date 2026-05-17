import { useReducer } from "react";
import type { FileFailure, MarkdownDocument } from "../features/files/types";

export interface DocumentState {
  active: MarkdownDocument | null;
  draftMarkdown: string;
  dirty: boolean;
  viewMode: "wysiwyg" | "source";
  busy: "idle" | "opening" | "saving";
  lastError: FileFailure | null;
}

type Action =
  | { type: "opening" }
  | { type: "saving" }
  | { type: "opened"; document: MarkdownDocument; warning?: FileFailure | null }
  | { type: "saved"; document: MarkdownDocument }
  | { type: "new" }
  | { type: "draft"; markdown: string }
  | { type: "mode"; viewMode: DocumentState["viewMode"] }
  | { type: "failed"; error: FileFailure }
  | { type: "dismiss-error" }
  | { type: "idle" };

export const initialDocumentState: DocumentState = {
  active: null,
  draftMarkdown: "",
  dirty: false,
  viewMode: "source",
  busy: "idle",
  lastError: null,
};

export function documentReducer(
  state: DocumentState,
  action: Action,
): DocumentState {
  switch (action.type) {
    case "opening":
      return { ...state, busy: "opening" };
    case "saving":
      return { ...state, busy: "saving" };
    case "opened":
      return {
        active: action.document,
        draftMarkdown: action.document.contents,
        dirty: false,
        viewMode: action.document.hasPlanCycleNotes ? "source" : "wysiwyg",
        busy: "idle",
        lastError: action.warning ?? null,
      };
    case "saved":
      return {
        ...state,
        active: action.document,
        draftMarkdown: action.document.contents,
        dirty: false,
        viewMode: action.document.hasPlanCycleNotes ? "source" : state.viewMode,
        busy: "idle",
        lastError: null,
      };
    case "new":
      return {
        active: null,
        draftMarkdown: "# Untitled\n",
        dirty: true,
        viewMode: "source",
        busy: "idle",
        lastError: null,
      };
    case "draft":
      return {
        ...state,
        draftMarkdown: action.markdown,
        dirty: state.active
          ? action.markdown !== state.active.contents
          : action.markdown.length > 0,
      };
    case "mode":
      return { ...state, viewMode: action.viewMode };
    case "failed":
      return { ...state, busy: "idle", lastError: action.error };
    case "dismiss-error":
      return { ...state, lastError: null };
    case "idle":
      return { ...state, busy: "idle" };
    default:
      return state;
  }
}

export function useDocumentState() {
  return useReducer(documentReducer, initialDocumentState);
}
