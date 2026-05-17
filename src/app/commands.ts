import { message } from "@tauri-apps/plugin-dialog";
import type { DocumentState } from "./useDocumentState";

export type DirtyChoice = "save" | "discard" | "cancel";

export async function confirmDirtyTransition(
  state: Pick<DocumentState, "dirty">,
): Promise<DirtyChoice> {
  if (!state.dirty) {
    return "discard";
  }

  const result = await message("Save changes before continuing?", {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: "Save", no: "Discard", cancel: "Cancel" },
  });

  if (result === "Save") return "save";
  if (result === "Discard") return "discard";
  return "cancel";
}

export function canShowEditor(state: Pick<DocumentState, "active" | "dirty">) {
  return state.active !== null || state.dirty;
}
