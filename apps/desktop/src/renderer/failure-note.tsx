import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { FAILURE_REASON, type Failure, remedyLabel } from "./failure-remedy";
import { useGitHubConnect } from "./github-connect";
import { ProviderMark } from "./provider-marks";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * Connect GitHub connects the account's own GitHub in the browser, as
 * Settings › Connected accounts does, with Cancel beside it while the
 * browser has it; once the window is back with GitHub connected the failed
 * action is asked again by itself (`onRetry`), and a connect withdrawn or
 * outlived by the note leaves nothing retried (`github-connect.tsx`). Any
 * other remedy is the surface's own (`onRemedy`).
 */
export function FailureNote({
  failure,
  className,
  onRetry,
  onRemedy,
}: {
  failure: Failure;
  className: string;
  /** Retry's press, and what follows a GitHub connect that landed. */
  onRetry?: (() => void) | undefined;
  /** Opens the API keys or reconnects the integration, as the reason says. */
  onRemedy?: (() => void) | undefined;
}): React.JSX.Element {
  const connect = useGitHubConnect(() => onRetry?.());
  const github = failure.reason === FAILURE_REASON.GITHUB_SIGN_IN;
  const waiting = github && connect.waiting;
  const label = remedyLabel(failure);
  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">{failure.text}</span>
      {label === undefined ? null : (
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy"
          disabled={waiting}
          onClick={github ? connect.begin : onRemedy}
        >
          {github && !waiting ? <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} /> : null}
          {waiting ? "Waiting for browser…" : label}
        </button>
      )}
      {waiting ? (
        <button type="button" className="toolbar-button quiet-button" onClick={connect.cancel}>
          Cancel
        </button>
      ) : null}
      {label === undefined && onRetry !== undefined ? <RetryButton onRetry={onRetry} /> : null}
    </p>
  );
}
