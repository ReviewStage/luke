import { type Failure, remedyLabel, retriesBesideRemedy } from "@luke/features/failure-remedy";
import { BUTTON_VARIANT, Button } from "@luke/ui";
import type { ReactNode } from "react";
import { RetryButton } from "./retry-button";

/**
 * failure-note.tsx -- a failure's sentence, then the press that mends it, or Retry where trying again is all that can.
 *
 * A remedy is the surface's own (`onRemedy`). One finished where Luke
 * cannot watch, on GitHub or in Settings, keeps Retry beside it
 * (`retriesBesideRemedy`), since the same send is what goes once it is done.
 * A surface whose remedy is a press of its own hands it in as `children`,
 * drawn last.
 */
export function FailureNote({
  failure,
  className,
  onRetry,
  onRemedy,
  children,
}: {
  failure: Failure;
  className: string;
  /** Retry's press. */
  onRetry?: (() => void) | undefined;
  /** Opens the API keys, reconnects the integration, or mends the task's repository, as the reason says. */
  onRemedy?: (() => void) | undefined;
  /** A remedy no reason names, drawn after the rest: a closed agent's Continue in new agent. */
  children?: ReactNode;
}): React.JSX.Element {
  const label = remedyLabel(failure);
  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">{failure.text}</span>
      {label === undefined ? null : (
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onRemedy}>
          {label}
        </Button>
      )}
      {onRetry !== undefined && (label === undefined || retriesBesideRemedy(failure)) ? (
        <RetryButton onRetry={onRetry} />
      ) : null}
      {children}
    </p>
  );
}
