/**
 * error-state.tsx -- something that did not land: its sentence in the fault's red, then Retry, where what it would have drawn stands.
 *
 * Every place that fails says so the same way: one sentence, "The inbox
 * could not be read.", in the danger text colour, because a failure is a
 * fault rather than a state of the account, then, where trying again can
 * mend it, Retry as a quiet button with its turning glyph. The sentence and
 * its Retry are one alert, so a reader hears the failure land where the
 * rows or the region would have stood, and Retry is the next stop of the
 * keyboard after it.
 *
 * Only where it stands differs. Among rows, in a card, or under a
 * transcript it is a line, Retry beside the sentence, at a caption's size;
 * alone in a region it would have filled, a tab or a page, it is centred,
 * Retry under the sentence, at the body's size, as an empty place's line
 * and its way on stand (`EmptyState`). The container places it and lends
 * it no colour of its own.
 */

import type { ReactNode } from "react";
import { RetryIcon } from "../../face/glyphs.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";

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
  return (
    <p className="luke-error-state" data-placement={placement} role="alert">
      <span className="luke-error-state-words">{children}</span>
      {onRetry === undefined ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} icon={<RetryIcon />} onClick={onRetry}>
          {RETRY_WORD}
        </Button>
      )}
    </p>
  );
}
