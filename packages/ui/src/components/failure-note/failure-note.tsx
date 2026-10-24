/**
 * failure-note.tsx -- one line saying something failed, inside what it failed in: the failed mark, the words in the danger tone, and Retry where trying again can mend it.
 *
 * `ErrorState` stands where rows or a region would have stood, and says its
 * sentence in the muted ink of the words around it, because a read that did
 * not land is most often a passing fault. A failure note is the line under
 * what was already drawn and then went wrong: a tool call that ended in an
 * error, a message that did not go, an answer the Inbox refused. There the
 * words themselves are what a reader must not miss, so they and the mark
 * before them wear the danger tone (`STATUS_TONE.DANGER`). The words keep
 * their own line breaks and wrap anywhere, since a failure's words are often
 * a tool's, and a reader may select them to copy.
 *
 * The line is an alert, so a reader hears the failure land where it
 * happened. Where trying again can mend it, Retry stands after the words
 * (`RetryButton`), and the line's first row is then a control tall, so the
 * mark, the words' first line, and Retry share one middle. A failure that
 * needs a remedy beyond Retry, or that empties the place it stood in, is an
 * `ErrorState`.
 */

import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { STATUS_TONE } from "../../status-tone.js";
import { RetryButton } from "../retry-button/retry-button.js";

/** A failure's words, `children`, behind the failed mark in the danger tone, and Retry after them where `onRetry` is given. */
export function FailureNote({
  onRetry,
  children,
}: {
  /** Retry's press; with none, the line says its words alone. */
  onRetry?: (() => void) | undefined;
  /** What failed, as "The answer could not be sent." */
  children: ReactNode;
}): React.JSX.Element {
  const Mark = GLYPH.FAILED;
  return (
    <p
      className="luke-failure-note"
      data-tone={STATUS_TONE.DANGER}
      data-retry={onRetry === undefined ? undefined : ""}
      role="alert"
    >
      <span className="luke-failure-note-mark" aria-hidden="true">
        <Mark />
      </span>
      <span className="luke-failure-note-words">{children}</span>
      {onRetry === undefined ? null : (
        <span className="luke-failure-note-retry">
          <RetryButton onRetry={onRetry} />
        </span>
      )}
    </p>
  );
}
