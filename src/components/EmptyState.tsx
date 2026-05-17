interface EmptyStateProps {
  onOpen(): void;
  onNew(): void;
}

export function EmptyState({ onOpen, onNew }: EmptyStateProps) {
  return (
    <main className="empty-state">
      <button type="button" onClick={onOpen}>
        Open
      </button>
      <button type="button" onClick={onNew}>
        New
      </button>
    </main>
  );
}
