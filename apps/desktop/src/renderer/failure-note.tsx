import { type Failure, remedyLabel, retriesBesideRemedy } from "@luke/features/failure-remedy";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * A remedy is the surface's own (`onRemedy`). One finished where Luke
 * cannot watch, on GitHub or in Settings, keeps Retry beside it
 * (`retriesBesideRemedy`), since the same send is what goes once it is done.
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
  /** Opens the API keys, reconnects the integration, or mends the task's repository, as the reason says. */
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
      {onRetry !== undefined && (label === undefined || retriesBesideRemedy(failure)) ? (
        <RetryButton onRetry={onRetry} />
      ) : null}
    </p>
  );
}
