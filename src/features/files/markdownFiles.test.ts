import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownDocument,
  detectLineEnding,
  fileFailure,
  hasPlanCycleNotes,
  isFileFailure,
  loadMarkdownFile,
  normalizeLineEnding,
  saveMarkdownFile,
  validateMarkdownPath,
} from "./markdownFiles";

const fsMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => fsMocks);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

describe("markdown file helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts supported markdown extensions", () => {
    expect(() => validateMarkdownPath("/tmp/a.md")).not.toThrow();
    expect(() => validateMarkdownPath("/tmp/a.markdown")).not.toThrow();
    expect(() => validateMarkdownPath("/tmp/a.mdown")).not.toThrow();
  });

  it("rejects unsupported extensions before reading", async () => {
    await expect(loadMarkdownFile("/tmp/a.txt")).rejects.toMatchObject({
      code: "unsupported-extension",
    });
    expect(fsMocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects files above 10 MB", async () => {
    fsMocks.invoke.mockResolvedValueOnce({ size: 10 * 1024 * 1024 + 1 });

    await expect(loadMarkdownFile("/tmp/a.md")).rejects.toMatchObject({
      code: "too-large",
    });
    expect(fsMocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("detects and preserves line endings", () => {
    expect(detectLineEnding("a\nb\n")).toBe("lf");
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
    expect(normalizeLineEnding("a\r\nb\n", "lf")).toBe("a\nb\n");
    expect(normalizeLineEnding("a\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });

  it("detects plan-cycle notes", () => {
    expect(hasPlanCycleNotes("> **NOTE**: keep this\n")).toBe(true);
    expect(hasPlanCycleNotes("> **TODO**: not this\n")).toBe(false);
  });

  it("loads metadata and text into a document", async () => {
    fsMocks.invoke
      .mockResolvedValueOnce({ size: 12 })
      .mockResolvedValueOnce("# Title\r\n");

    const document = await loadMarkdownFile("/tmp/plan.md");

    expect(document).toMatchObject({
      name: "plan.md",
      contents: "# Title\r\n",
      lineEnding: "crlf",
      byteLength: 9,
    });
  });

  it("normalizes line endings and recomputes bytes on save", async () => {
    fsMocks.invoke.mockResolvedValueOnce(undefined);
    const document = createMarkdownDocument("/tmp/a.md", "old\r\n", null);

    const saved = await saveMarkdownFile(document, "new\ntext\n");

    expect(fsMocks.invoke).toHaveBeenCalledWith("write_markdown_file", {
      path: "/tmp/a.md",
      contents: "new\r\ntext\r\n",
    });
    expect(saved.byteLength).toBe(new TextEncoder().encode("new\r\ntext\r\n").byteLength);
    expect(saved.savedAt).toEqual(expect.any(Number));
  });

  it("maps permission failures", async () => {
    fsMocks.invoke.mockRejectedValue(new Error("permission denied"));

    await expect(loadMarkdownFile("/tmp/a.md")).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("identifies typed file failures", () => {
    expect(isFileFailure(fileFailure("cancelled", "Cancelled"))).toBe(true);
    expect(isFileFailure(new Error("no"))).toBe(false);
  });
});
