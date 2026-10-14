import { FAILURE_REASON, type Failure, remedyLabel } from "./failure-remedy";
import { CONNECTED_ACCOUNTS_LINK, useOpenSettings } from "./open-settings";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * GitHub not connected is mended in Settings, where the account's own GitHub
 * is connected, so its press opens Settings at the account's connected
 * accounts. Any other remedy is the surface's own (`onRemedy`).
 */
export function FailureNote({
  failure,
  className,
  onRetry,
  onRemedy,
}: {
  failure: Failure;
  className: string;
  /** Retry's press, where trying again is all that mends the failure. */
  onRetry?: (() => void) | undefined;
  /** Opens the API keys or reconnects the integration, as the reason says. */
  onRemedy?: (() => void) | undefined;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const label = remedyLabel(failure);
  const remedy =
    failure.reason === FAILURE_REASON.GITHUB_SIGN_IN
      ? () => openSettings(CONNECTED_ACCOUNTS_LINK)
      : onRemedy;
  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">{failure.text}</span>
      {label === undefined ? null : (
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy"
          onClick={remedy}
        >
          {label}
        </button>
      )}
      {label === undefined && onRetry !== undefined ? <RetryButton onRetry={onRetry} /> : null}
    </p>
  );
}
