import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import { STATUS_TONE } from "../../status-tone.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";
import { RetryButton } from "../retry-button/retry-button.js";

export const FAILURE_NOTE_LOOK = {
  LINE: "line",
  LIST: "list",
} as const;

export type FailureNoteLook = (typeof FAILURE_NOTE_LOOK)[keyof typeof FAILURE_NOTE_LOOK];

export const FAILURE_NOTE_TIME = {
  NOW: "now",
  PAST: "past",
} as const;

export type FailureNoteTime = (typeof FAILURE_NOTE_TIME)[keyof typeof FAILURE_NOTE_TIME];

const LINE =
  "ui-failure-note m-0 flex min-w-0 flex-wrap items-start gap-icon-gap font-ui text-caption text-tone-ink data-[look=list]:px-list-inset data-[look=list]:py-row-inset";

const PART = {
  ROW: {
    mark: "ui-failure-note-mark flex h-control flex-none items-center [&_svg]:size-control-icon",
    words:
      "ui-failure-note-words min-w-1/2 flex-[1_1_0] py-state-row-inset wrap-anywhere whitespace-pre-wrap select-text",
  },
  LINE: {
    mark: "ui-failure-note-mark flex h-failure-note-row flex-none items-center [&_svg]:size-control-icon",
    words:
      "ui-failure-note-words min-w-0 flex-[1_1_0] py-0 wrap-anywhere whitespace-pre-wrap select-text",
  },
} as const;

const ACTS = "ui-failure-note-retry ms-auto flex max-w-full flex-none items-center gap-icon-gap";

export function FailureNote({
  look = FAILURE_NOTE_LOOK.LINE,
  time = FAILURE_NOTE_TIME.NOW,
  onRetry,
  also,
  failure,
  children,
}: {
  look?: FailureNoteLook;
  time?: FailureNoteTime;
  onRetry?: (() => void) | undefined;
  also?: ReactNode;
  failure: ReportedFailure | Unreported;
  children: ReactNode;
}): React.JSX.Element {
  const Mark = GLYPH.FAILED;
  const acts = onRetry !== undefined || also !== undefined || isReported(failure);
  const part = acts ? PART.ROW : PART.LINE;
  return (
    <p
      className={LINE}
      data-look={look}
      data-tone={STATUS_TONE.DANGER}
      data-retry={acts ? "" : undefined}
      role={time === FAILURE_NOTE_TIME.NOW ? "alert" : undefined}
    >
      <span className={part.mark} aria-hidden="true">
        <Mark />
      </span>
      <span className={part.words}>{children}</span>
      {acts ? (
        <span className={ACTS}>
          {onRetry === undefined ? null : <RetryButton onRetry={onRetry} />}
          {also}
          <FailureCopy failure={failure} />
        </span>
      ) : null}
    </p>
  );
}
