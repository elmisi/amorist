interface ToolbarProps {
  busy: boolean;
  dirty: boolean;
  viewMode: "wysiwyg" | "source";
  canSave: boolean;
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onNew(): void;
  onToggleSource(): void;
}

export function Toolbar({
  busy,
  dirty,
  viewMode,
  canSave,
  onOpen,
  onSave,
  onSaveAs,
  onNew,
  onToggleSource,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={onOpen} disabled={busy}>
          Open
        </button>
        <button type="button" onClick={onSave} disabled={busy || !canSave}>
          Save{dirty ? "*" : ""}
        </button>
        <button type="button" onClick={onSaveAs} disabled={busy || !canSave}>
          Save As
        </button>
        <button type="button" onClick={onNew} disabled={busy}>
          New
        </button>
      </div>
      <button type="button" onClick={onToggleSource} disabled={busy}>
        {viewMode === "source" ? "WYSIWYG" : "Source"}
      </button>
    </header>
  );
}
