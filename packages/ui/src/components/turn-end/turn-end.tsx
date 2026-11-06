/**
 * turn-end.tsx -- the line an agent's turn ends on once it failed or was stopped, and the press on its row that goes on from it: "Failed: the sandbox or checkout failed" then Try again.
 *
 * A failure (`failure` given) is a `FailureNote` that is history, never an
 * alert, since a transcript mounts it as it scrolls into view: the failed
 * mark and its words in the danger ink, with Copy details where the failure
 * is the app's. A stop is the developer's own doing, so its words are a
 * quiet inset `NoteLine`.
 *
 * The `press` stands on the line's row, after it, Copy details included:
 * the way on from the turn, as Continue in new agent, Try again, or a
 * refused key's Connect Claude, so every way on stands in one place and
 * centered on the line's first row. The line is one flex item, so a
 * failure too long to share the row takes it whole and the press wraps
 * under it, never between its words. In an empty tab's centered column the
 * row is centered as its column is (`centered`).
 *
 * The line and the row carry `data-ended`, and a failure's `data-failed`,
 * so a caller finds them by those marks.
 */

import type { ReactNode } from "react";
import type { ReportedFailure, Unreported } from "../../reported-failure.js";
import { FAILURE_NOTE_TIME, FailureNote } from "../failure-note/failure-note.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";

/** The row: the line, then the press, wrapping the press under the line only where the column is too narrow for both. */
const ROW =
  "ui-turn-end flex max-w-full flex-wrap items-center gap-control-gap data-[centered]:justify-center";

/** A failure's line: one sentence at a caption's size, so a long failure wraps under its own words. */
const FAILED_LINE = "ui-turn-end-line m-0 text-caption text-muted-foreground";

/** The line a turn ends on, its words `children`, failed where `failure` is given, with a `press` after it on its row. */
export function TurnEnd({
  failure,
  press,
  centered = false,
  children,
}: {
  /** The failure beneath the words, as the app reports it; none for a stop. */
  failure?: ReportedFailure | Unreported | undefined;
  /** A `@repo/ui` control after the line, on its row: the way on from the turn, or what mends it. */
  press?: ReactNode;
  /** Whether the row stands in a centered column, centered as its column is. */
  centered?: boolean;
  /** What ended the turn, as "Failed: the model call failed" or "Stopped". */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={ROW} data-centered={centered ? "" : undefined}>
      {failure === undefined ? (
        <NoteLine look={NOTE_LINE_LOOK.INSET} data-ended="">
          <span className="ui-turn-end-words">{children}</span>
        </NoteLine>
      ) : (
        <div className={FAILED_LINE} data-ended="" data-failed="">
          <FailureNote failure={failure} time={FAILURE_NOTE_TIME.PAST}>
            {children}
          </FailureNote>
        </div>
      )}
      {press}
    </div>
  );
}
