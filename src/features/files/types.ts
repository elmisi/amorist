export type MarkdownFilePath = string;

export interface MarkdownDocument {
  path: MarkdownFilePath;
  name: string;
  contents: string;
  byteLength: number;
  lineEnding: "lf" | "crlf";
  hasPlanCycleNotes: boolean;
  loadedAt: number;
  savedAt: number | null;
}

export type FileFailureCode =
  | "cancelled"
  | "too-many-startup-files"
  | "unsupported-extension"
  | "too-large"
  | "read-failed"
  | "write-failed"
  | "permission-denied";

export interface FileFailure {
  code: FileFailureCode;
  message: string;
  cause?: unknown;
}

export interface SaveMarkdownOptions {
  lineEnding: "lf" | "crlf";
  sourceHasPlanCycleNotes: boolean;
}

export const MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;
