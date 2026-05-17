import { describe, expect, it } from "vitest";
import { documentReducer, initialDocumentState } from "./useDocumentState";
import { createMarkdownDocument, fileFailure } from "../features/files/markdownFiles";

describe("documentReducer", () => {
  it("keeps the previous document after a failed open", () => {
    const document = createMarkdownDocument("/tmp/a.md", "# A\n", null);
    const opened = documentReducer(initialDocumentState, {
      type: "opened",
      document,
    });

    const failed = documentReducer(opened, {
      type: "failed",
      error: fileFailure("unsupported-extension", "No"),
    });

    expect(failed.active).toBe(document);
    expect(failed.draftMarkdown).toBe("# A\n");
    expect(failed.lastError?.code).toBe("unsupported-extension");
  });

  it("keeps dirty edits after a failed save", () => {
    const document = createMarkdownDocument("/tmp/a.md", "# A\n", null);
    const dirty = documentReducer(
      documentReducer(initialDocumentState, { type: "opened", document }),
      { type: "draft", markdown: "# B\n" },
    );

    const failed = documentReducer(dirty, {
      type: "failed",
      error: fileFailure("write-failed", "No"),
    });

    expect(failed.dirty).toBe(true);
    expect(failed.draftMarkdown).toBe("# B\n");
  });

  it("stores invalid startup and too-many-file warnings", () => {
    const document = createMarkdownDocument("/tmp/a.md", "# A\n", null);
    const warning = fileFailure(
      "too-many-startup-files",
      "Only one file can be opened at startup.",
    );
    const opened = documentReducer(initialDocumentState, {
      type: "opened",
      document,
      warning,
    });

    expect(opened.lastError).toBe(warning);
  });
});
