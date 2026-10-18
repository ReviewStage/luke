/**
 * error-state.tsx -- something that did not land: its sentence, Retry, and the few other presses a failure offers, as a quiet line among the rows or as the empty state of the region it would have filled.
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
 * still named Retry, so the sentence keeps the room.
 *
 * A failure among rows may offer a few presses beside Retry, always in one
 * order: the remedy that mends it where trying again alone cannot ("Connect
 * GitHub"), outlined since it is the act the line is there for, then Retry,
 * then Remove, which lets go of what failed, then Dismiss, a cross at the
 * row's end, which puts the line away. Where they would take more than half
 * the row they go onto the line under the sentence, at its end, whole.
 * Alone in a region it would have
 * filled, a tab or a page, it is that region's empty state (`EmptyState`):
 * the glyph large and faint over the sentence, and Retry under it, standing
 * a little above the room's middle. The container places it and lends it no
 * colour of its own.
 */

import type { ReactNode } from "react";
import { AlertIcon, CloseIcon, RetryIcon } from "../../face/glyphs.js";
import { BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { EmptyState } from "../empty-state/empty-state.js";

/** Where a failure stands: among the rows it failed to draw, or alone in the region it would have filled. */
export const ERROR_STATE_PLACEMENT = {
  INLINE: "inline",
  CENTRED: "centred",
} as const;

export type ErrorStatePlacement =
  (typeof ERROR_STATE_PLACEMENT)[keyof typeof ERROR_STATE_PLACEMENT];

/** The press that mends a failure where trying again alone cannot: its words and what it does. */
export interface ErrorStateRemedy {
  /** What it does, as "Connect GitHub". */
  readonly label: string;
  readonly onClick: () => void;
}

/** The presses only a failure among rows offers, since a region's empty state has room for one. */
interface InlineActions {
  placement?: typeof ERROR_STATE_PLACEMENT.INLINE;
  /** The remedy, drawn first. */
  remedy?: ErrorStateRemedy | undefined;
  /** Remove's press, which lets go of what failed. */
  onRemove?: (() => void) | undefined;
  /** Dismiss's press, which puts the line away. */
  onDismiss?: (() => void) | undefined;
}

interface CentredActions {
  placement: typeof ERROR_STATE_PLACEMENT.CENTRED;
  remedy?: undefined;
  onRemove?: undefined;
  onDismiss?: undefined;
}

const WORDS = {
  RETRY: "Retry",
  REMOVE: "Remove",
  DISMISS: "Dismiss",
} as const;

/**
 * A failure's sentence, `children`, and, where `onRetry` is given, the
 * Retry that tries again, said together as an alert and drawn at
 * `placement`; among rows, with the remedy, Remove, and Dismiss where each
 * is given.
 */
export function ErrorState({
  placement = ERROR_STATE_PLACEMENT.INLINE,
  onRetry,
  remedy,
  onRemove,
  onDismiss,
  children,
}: {
  /** Retry's press; with none, the failure says its sentence alone. */
  onRetry?: (() => void) | undefined;
  /** What did not land, as "The inbox could not be read." */
  children: ReactNode;
} & (InlineActions | CentredActions)): React.JSX.Element {
  if (placement === ERROR_STATE_PLACEMENT.CENTRED) {
    return (
      <EmptyState
        icon={<AlertIcon />}
        alert
        action={
          onRetry === undefined
            ? undefined
            : { label: WORDS.RETRY, icon: <RetryIcon />, onClick: onRetry }
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
      {remedy === undefined &&
      onRetry === undefined &&
      onRemove === undefined &&
      onDismiss === undefined ? null : (
        <span className="luke-error-state-actions">
          {remedy === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={remedy.onClick}>
              {remedy.label}
            </Button>
          )}
          {onRetry === undefined ? null : (
            <span className="luke-error-state-retry">
              <Button variant={BUTTON_VARIANT.QUIET} icon={<RetryIcon />} onClick={onRetry}>
                {WORDS.RETRY}
              </Button>
            </span>
          )}
          {onRemove === undefined ? null : (
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onRemove}>
              {WORDS.REMOVE}
            </Button>
          )}
          {onDismiss === undefined ? null : (
            <IconButton icon={<CloseIcon />} label={WORDS.DISMISS} onClick={onDismiss} />
          )}
        </span>
      )}
    </p>
  );
}
