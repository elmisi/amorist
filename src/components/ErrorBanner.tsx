import { toDisplayMessage } from "../app/errors";
import type { FileFailure } from "../features/files/types";

interface ErrorBannerProps {
  error: FileFailure;
  onDismiss(): void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <span>{toDisplayMessage(error)}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        Dismiss
      </button>
    </div>
  );
}
