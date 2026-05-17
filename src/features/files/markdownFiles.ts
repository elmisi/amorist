import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  MAX_MARKDOWN_BYTES,
  type FileFailure,
  type MarkdownDocument,
} from "./types";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown"]);
const TEXT_ENCODER = new TextEncoder();
const NOTE_PATTERN = /^> \*\*NOTE\*\*:/m;

export async function pickMarkdownFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown", "mdown"],
      },
    ],
  });

  if (typeof selected !== "string") {
    return null;
  }

  return selected;
}

export async function loadMarkdownFile(path: string): Promise<MarkdownDocument> {
  validateMarkdownPath(path);

  try {
    const info = await stat(path);
    if (info.size > MAX_MARKDOWN_BYTES) {
      throw fileFailure("too-large", "File is larger than 10 MB.");
    }
  } catch (error) {
    if (isFileFailure(error)) {
      throw error;
    }
    throw mapFailure(error, "read-failed");
  }

  try {
    const contents = await readTextFile(path);
    return createMarkdownDocument(path, contents, null);
  } catch (error) {
    throw mapFailure(error, "read-failed");
  }
}

export async function saveMarkdownFile(
  document: MarkdownDocument,
  markdown: string,
): Promise<MarkdownDocument> {
  const normalized = normalizeLineEnding(markdown, document.lineEnding);

  try {
    await writeTextFile(document.path, normalized);
    return createMarkdownDocument(document.path, normalized, Date.now());
  } catch (error) {
    throw mapFailure(error, "write-failed");
  }
}

export async function saveMarkdownFileAs(
  markdown: string,
  options?: { defaultPath?: string; lineEnding?: "lf" | "crlf" },
): Promise<MarkdownDocument | null> {
  const selected = await save({
    defaultPath: options?.defaultPath,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown", "mdown"],
      },
    ],
  });

  if (!selected) {
    return null;
  }

  validateMarkdownPath(selected);
  const normalized = normalizeLineEnding(markdown, options?.lineEnding ?? "lf");

  try {
    await writeTextFile(selected, normalized);
    return createMarkdownDocument(selected, normalized, Date.now());
  } catch (error) {
    throw mapFailure(error, "write-failed");
  }
}

export function detectLineEnding(markdown: string): "lf" | "crlf" {
  return markdown.includes("\r\n") ? "crlf" : "lf";
}

export function normalizeLineEnding(
  markdown: string,
  lineEnding: "lf" | "crlf",
): string {
  const lf = markdown.replace(/\r\n/g, "\n");
  return lineEnding === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
}

export function hasPlanCycleNotes(markdown: string): boolean {
  return NOTE_PATTERN.test(markdown);
}

export function createMarkdownDocument(
  path: string,
  contents: string,
  savedAt: number | null,
): MarkdownDocument {
  const lineEnding = detectLineEnding(contents);

  return {
    path,
    name: fileNameFromPath(path),
    contents,
    byteLength: TEXT_ENCODER.encode(contents).byteLength,
    lineEnding,
    hasPlanCycleNotes: hasPlanCycleNotes(contents),
    loadedAt: Date.now(),
    savedAt,
  };
}

export function validateMarkdownPath(path: string): void {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  if (!ext || !MARKDOWN_EXTENSIONS.has(ext)) {
    throw fileFailure(
      "unsupported-extension",
      "Only .md, .markdown, and .mdown files are supported.",
    );
  }
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "Untitled";
}

export function fileFailure(
  code: FileFailure["code"],
  message: string,
  cause?: unknown,
): FileFailure {
  return { code, message, cause };
}

export function isFileFailure(value: unknown): value is FileFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

function mapFailure(
  error: unknown,
  fallbackCode: "read-failed" | "write-failed",
): FileFailure {
  if (isFileFailure(error)) {
    return error;
  }

  const text = String(error);
  if (/permission|denied|forbidden|scope/i.test(text)) {
    return fileFailure(
      "permission-denied",
      "The app does not have permission to access this file.",
      error,
    );
  }

  return fileFailure(
    fallbackCode,
    fallbackCode === "read-failed"
      ? "The file could not be read."
      : "The file could not be saved.",
    error,
  );
}
