interface SourceEditorProps {
  markdown: string;
  readOnly?: boolean;
  onMarkdownChange(markdown: string): void;
}

export function SourceEditor({
  markdown,
  readOnly,
  onMarkdownChange,
}: SourceEditorProps) {
  return (
    <textarea
      className="source-editor"
      value={markdown}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => onMarkdownChange(event.currentTarget.value)}
    />
  );
}
