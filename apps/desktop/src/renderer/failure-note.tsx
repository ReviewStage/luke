import { type Failure, remedyLabel } from "./failure-remedy";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * A remedy is the surface's own (`onRemedy`).
 */
export function FailureNote({
  failure,
  className,
  onRetry,
  onRemedy,
}: {
  failure: Failure;
  className: string;
  /** Retry's press. */
  onRetry?: (() => void) | undefined;
  /** Opens the API keys or reconnects the integration, as the reason says. */
  onRemedy?: (() => void) | undefined;
}): React.JSX.Element {
  const label = remedyLabel(failure);
  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">{failure.text}</span>
      {label === undefined ? null : (
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy"
          onClick={onRemedy}
        >
          {label}
        </button>
      )}
      {label === undefined && onRetry !== undefined ? <RetryButton onRetry={onRetry} /> : null}
    </p>
  );
}
