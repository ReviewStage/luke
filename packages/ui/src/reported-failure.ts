/**
 * reported-failure.ts -- a failure of the app's as a component is handed it: reported by the app that caught it the first time it stands on screen, answering the details a person may copy; or words that are no failure of the app's, which nothing reports.
 *
 * Every component that says a failure in place (`ErrorState`,
 * `FailureNote`, `ErrorLine` and the rows and dialogs that draw one) takes
 * what it says with the failure beneath it, so none can say a failure the
 * app's logs never hear of. This package reaches no reporter of its own:
 * the app hands a `ReportedFailure` it built over its own (the panel's
 * `failureShown`), and the component says it was shown once it stands,
 * which reports it where it was not yet reported, and offers the details
 * that answers to copy (`FailureCopy`).
 *
 * Two kinds of words are drawn the same way and are no failure of the
 * app's, so each names itself as such rather than passing for one
 * (`UNREPORTED`): the person's own input checked ("Required", "Too long"),
 * and a tool's error an agent met, which its transcript keeps as the
 * agent's own record. A place that failed to draw is reported by the root
 * whose error boundary caught it, so it names that too, rather than being
 * reported twice; and a failure on a page that loads nothing to report it
 * through, the site's standalone sign-in, connection, and admin pages, says
 * so rather than passing for reported.
 */

import type { ReactNode } from "react";

/** A failure of the app's a component shows, as the app that caught it hands it on. */
export interface ReportedFailure {
  /**
   * Says the failure stands on screen: reports it where it was not yet
   * reported, and answers the details a person may copy of it, or nothing
   * where they could not be read. Note that it is called each time a
   * component showing it is drawn anew, so the app keeps whether it was
   * reported, not the component.
   */
  readonly shown: () => string | undefined;
  /** Says a component showing it has gone, so the app may take a later return for a new failure. */
  readonly hidden: () => void;
  /** The app's clipboard, which Copy details writes to; a rejection is a refused copy. */
  readonly copy: (text: string) => Promise<void>;
}

/** Words drawn as a failure's that are no failure of the app's, so nothing reports them and none offers its details. */
export const UNREPORTED = {
  /** The person's own input checked, as "Required" or "Too long". */
  INPUT: "input",
  /** A tool's error an agent met, kept in its transcript as the agent's record. */
  TOOL: "tool",
  /** A place that failed to draw, which the error boundary's root reports itself. */
  BOUNDARY: "boundary",
  /** A failure on a page that loads no reporter: the site's standalone sign-in, connection, and admin pages. */
  NO_REPORTER: "no-reporter",
} as const;

export type Unreported = (typeof UNREPORTED)[keyof typeof UNREPORTED];

/** A line's words and what they say: a failure of the app's, or words that are none. */
export interface ShownError {
  readonly words: ReactNode;
  readonly failure: ReportedFailure | Unreported;
}

/** Whether words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** The person's input checked, as a line says it, or nothing while `words` say nothing. */
export function inputProblem(words: ReactNode): ShownError | undefined {
  return said(words) ? { words, failure: UNREPORTED.INPUT } : undefined;
}

/** Whether what a line says is a failure of the app's, reported and offered to copy. */
export function isReported(
  failure: ReportedFailure | Unreported | undefined,
): failure is ReportedFailure {
  return typeof failure === "object";
}
