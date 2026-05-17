import { message } from "@tauri-apps/plugin-dialog";
import type { DocumentState } from "./useDocumentState";

export type DirtyChoice = "save" | "discard" | "cancel";

export function mapDirtyDialogResult(result: string): DirtyChoice {
  switch (result) {
    case "Save":
    case "yes":
    case "Yes":
      return "save";
    case "Discard":
    case "no":
    case "No":
      return "discard";
    default:
      return "cancel";
  }
}

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

  return mapDirtyDialogResult(result);
}

export function canShowEditor(state: Pick<DocumentState, "active" | "dirty">) {
  return state.active !== null || state.dirty;
}
