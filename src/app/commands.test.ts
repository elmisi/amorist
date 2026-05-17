import { describe, expect, it } from "vitest";
import { mapDirtyDialogResult } from "./commands";

describe("mapDirtyDialogResult", () => {
  it("maps Tauri custom button values", () => {
    expect(mapDirtyDialogResult("Save")).toBe("save");
    expect(mapDirtyDialogResult("Discard")).toBe("discard");
    expect(mapDirtyDialogResult("Cancel")).toBe("cancel");
  });

  it("maps Tauri button keys when returned instead of labels", () => {
    expect(mapDirtyDialogResult("yes")).toBe("save");
    expect(mapDirtyDialogResult("no")).toBe("discard");
    expect(mapDirtyDialogResult("cancel")).toBe("cancel");
  });
});
