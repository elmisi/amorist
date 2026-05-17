import type { FileFailure } from "../features/files/types";

export function toDisplayMessage(error: FileFailure): string {
  switch (error.code) {
    case "too-large":
      return "File is larger than 10 MB.";
    case "unsupported-extension":
      return "Only .md, .markdown, and .mdown files are supported.";
    case "permission-denied":
      return "The app does not have permission to access this file.";
    case "too-many-startup-files":
      return "Only one file can be opened at startup.";
    case "read-failed":
    case "write-failed":
      return error.message;
    default:
      return "The file operation failed.";
  }
}
