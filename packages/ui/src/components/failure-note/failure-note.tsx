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
 *
 * A failure may carry one act beside Retry, `also`, such as Discard on a post
 * that did not go; it stands after Retry in the same row, and holds the
 * line's control-tall first row on its own where there is no Retry.
 *
 * It is drawn in Tailwind utilities over the theme with no shadcn base:
 * shadcn's alert is a block of its own, a titled card or strip (Luke's
 * `Banner`), where a failure note is one line among the words of what it
 * failed in. The line's first row is a caption's leading tall, or a
 * control's where a press stands in it, and the mark and the words' first
 * line are centred in that row, so a failure of several lines keeps its
 * mark by its first.
 */

import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { STATUS_TONE } from "../../status-tone.js";
import { RetryButton } from "../retry-button/retry-button.js";

/** The line: the mark, the words, and the presses on one row, in the danger tone's ink at a caption's size. */
const LINE =
  "luke-failure-note m-0 flex min-w-0 items-start gap-icon-gap font-ui text-caption text-tone-ink";

/**
 * Each part, by whether a press stands in the first row, which is then a
 * control tall. Note that a tool's error keeps its own line breaks, wraps
 * where it must, and can be selected to copy.
 */
const PART = {
  ROW: {
    mark: "luke-failure-note-mark flex h-control flex-none items-center [&_svg]:size-control-icon",
    words:
      "luke-failure-note-words min-w-0 flex-[1_1_0] py-state-row-inset wrap-anywhere whitespace-pre-wrap select-text",
  },
  LINE: {
    mark: "luke-failure-note-mark flex h-failure-note-row flex-none items-center [&_svg]:size-control-icon",
    words:
      "luke-failure-note-words min-w-0 flex-[1_1_0] py-0 wrap-anywhere whitespace-pre-wrap select-text",
  },
} as const;

/** The presses after the words, Retry then `also`. */
const ACTS = "luke-failure-note-retry flex flex-none items-center gap-icon-gap";

/** A failure's words, `children`, behind the failed mark in the danger tone, and Retry after them where `onRetry` is given, then `also`. */
export function FailureNote({
  onRetry,
  also,
  children,
}: {
  /** Retry's press; with none, the line says its words alone, and any `also`. */
  onRetry?: (() => void) | undefined;
  /** A second act after Retry, drawn by the caller as a `@luke/ui` control; with neither, the line says its words alone. */
  also?: ReactNode;
  /** What failed, as "The answer could not be sent." */
  children: ReactNode;
}): React.JSX.Element {
  const Mark = GLYPH.FAILED;
  const acts = onRetry !== undefined || also !== undefined;
  const part = acts ? PART.ROW : PART.LINE;
  return (
    <p
      className={LINE}
      data-tone={STATUS_TONE.DANGER}
      data-retry={acts ? "" : undefined}
      role="alert"
    >
      <span className={part.mark} aria-hidden="true">
        <Mark />
      </span>
      <span className={part.words}>{children}</span>
      {acts ? (
        <span className={ACTS}>
          {onRetry === undefined ? null : <RetryButton onRetry={onRetry} />}
          {also}
        </span>
      ) : null}
    </p>
  );
}
