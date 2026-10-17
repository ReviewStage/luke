/**
 * error-state.tsx -- something that did not land: its sentence and Retry, as a quiet line among the rows or as the empty state of the region it would have filled.
 *
 * Every place that fails says so the same way: one sentence, "The inbox
 * could not be read.", then, where trying again can mend it, Retry as a
 * quiet button with its turning glyph. The sentence is in the muted ink of
 * the words around it, and the fault's red marks only the glyph before it,
 * because a read that did not land is most often a passing fault the next
 * try mends, and a line of red reads as something broken for good. The
 * sentence and its Retry are one alert, so a reader hears the failure land
 * where the rows or the region would have stood, and Retry is the next stop
 * of the keyboard after it.
 *
 * Only where it stands differs. Among rows, in a card, or under a
 * transcript it is a row of its own at a caption's size, laid out as a row
 * is: the glyph where a row's glyph stands, the sentence where a row's words
 * stand, and Retry at the row's end, where a row's own buttons stand. Where
 * the row is narrow, a sidebar's or a list pane's, Retry is its glyph alone,
 * still named Retry, so the sentence keeps the room. Alone in a region it would have
 * filled, a tab or a page, it is that region's empty state (`EmptyState`):
 * the glyph large and faint over the sentence, and Retry under it, standing
 * a little above the room's middle. The container places it and lends it no
 * colour of its own.
 */

import type { ReactNode } from "react";
import { AlertIcon, RetryIcon } from "../../face/glyphs.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { EmptyState } from "../empty-state/empty-state.js";

/** Where a failure stands: among the rows it failed to draw, or alone in the region it would have filled. */
export const ERROR_STATE_PLACEMENT = {
  INLINE: "inline",
  CENTRED: "centred",
} as const;

export type ErrorStatePlacement =
  (typeof ERROR_STATE_PLACEMENT)[keyof typeof ERROR_STATE_PLACEMENT];

const RETRY_WORD = "Retry";

/**
 * A failure's sentence, `children`, and, where `onRetry` is given, the
 * Retry that tries again, said together as an alert and drawn at
 * `placement`.
 */
export function ErrorState({
  placement = ERROR_STATE_PLACEMENT.INLINE,
  onRetry,
  children,
}: {
  placement?: ErrorStatePlacement;
  /** Retry's press; with none, the failure says its sentence alone. */
  onRetry?: (() => void) | undefined;
  /** What did not land, as "The inbox could not be read." */
  children: ReactNode;
}): React.JSX.Element {
  if (placement === ERROR_STATE_PLACEMENT.CENTRED) {
    return (
      <EmptyState
        icon={<AlertIcon />}
        alert
        action={
          onRetry === undefined
            ? undefined
            : { label: RETRY_WORD, icon: <RetryIcon />, onClick: onRetry }
        }
      >
        {children}
      </EmptyState>
    );
  }
  return (
    <p className="luke-error-state" role="alert">
      <span className="luke-error-state-glyph">
        <AlertIcon />
      </span>
      <span className="luke-error-state-words">{children}</span>
      {onRetry === undefined ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} icon={<RetryIcon />} onClick={onRetry}>
          {RETRY_WORD}
        </Button>
      )}
    </p>
  );
}
