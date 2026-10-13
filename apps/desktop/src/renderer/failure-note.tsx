import { ACCOUNT_PROVIDER } from "@sidecar/credentials/snapshot";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { GitHubMark } from "./account-marks";
import { useAct } from "./act";
import { FAILURE_REASON, type Failure, remedyLabel } from "./failure-remedy";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * Sign in with GitHub runs the sign-in over the session that stands, with
 * Cancel beside it while the browser has it; once a new session lands the
 * failed action is asked again by itself (`onRetry`), and one withdrawn,
 * refused, or outlived by the note leaves nothing retried. Any other remedy
 * is the surface's own (`onRemedy`).
 */
export function FailureNote({
  failure,
  className,
  onRetry,
  onRemedy,
}: {
  failure: Failure;
  className: string;
  /** Retry's press, and what follows a sign-in that landed. */
  onRetry?: (() => void) | undefined;
  /** Opens the API keys or reconnects the integration, as the reason says. */
  onRemedy?: (() => void) | undefined;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const [waiting, setWaiting] = useState(false);
  const attempt = useRef(0);
  const retry = useRef(onRetry);
  retry.current = onRetry;
  useEffect(() => () => void ++attempt.current, []);
  const github = failure.reason === FAILURE_REASON.GITHUB_SIGN_IN;
  const label = remedyLabel(failure);

  const signIn = () => {
    const mine = ++attempt.current;
    setWaiting(true);
    const settle = (signedIn: boolean) => {
      if (attempt.current !== mine) return;
      setWaiting(false);
      tell(ACT_KIND.WINDOW_FOCUS_PANEL);
      if (signedIn) retry.current?.();
    };
    const asked = act(ACT_KIND.ACCOUNT_SIGN_IN_AGAIN, { provider: ACCOUNT_PROVIDER.GITHUB });
    asked.then(settle, () => settle(false));
  };
  const cancel = () => {
    attempt.current += 1;
    setWaiting(false);
    tell(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN);
  };

  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">{failure.text}</span>
      {label === undefined ? null : (
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy"
          disabled={waiting}
          onClick={github ? signIn : onRemedy}
        >
          {github && !waiting ? <GitHubMark /> : null}
          {waiting ? "Waiting for browser…" : label}
        </button>
      )}
      {waiting ? (
        <button type="button" className="toolbar-button quiet-button" onClick={cancel}>
          Cancel
        </button>
      ) : null}
      {label === undefined && onRetry !== undefined ? <RetryButton onRetry={onRetry} /> : null}
    </p>
  );
}
