import type { MarkdownDocument } from "../features/files/types";

interface StatusBarProps {
  active: MarkdownDocument | null;
  dirty: boolean;
  busy: "idle" | "opening" | "saving";
  draftMarkdown: string;
  viewMode: "wysiwyg" | "source";
}

const encoder = new TextEncoder();

export function StatusBar({
  active,
  dirty,
  busy,
  draftMarkdown,
  viewMode,
}: StatusBarProps) {
  const byteCount = active?.byteLength ?? encoder.encode(draftMarkdown).byteLength;
  const fileName = active?.name ?? (draftMarkdown ? "Untitled" : "No file");
  const savedAt = active?.savedAt
    ? new Date(active.savedAt).toLocaleTimeString()
    : "Not saved";
  const planWarning =
    active?.hasPlanCycleNotes && viewMode === "source"
      ? "Source mode is required to preserve plan-cycle notes"
      : "";

  return (
    <footer className="status-bar">
      <span className="status-name" title={active?.path ?? fileName}>
        {fileName}
      </span>
      <span>{busy === "idle" ? (dirty ? "Modified" : "Saved") : busy}</span>
      <span>{byteCount.toLocaleString()} bytes</span>
      <span>{savedAt}</span>
      {planWarning ? <span className="status-warning">{planWarning}</span> : null}
    </footer>
  );
}
