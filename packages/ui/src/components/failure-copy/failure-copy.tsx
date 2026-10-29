/**
 * failure-copy.tsx -- a failure's Copy details: says the failure was shown as it first stands, which reports it, and offers the details that answers through the window's one Copy, its glyph alone, named "Copy details".
 *
 * Every component that says a failure of the app's in place draws this
 * beside its words, so a person can paste what failed to an agent and ask
 * why, as a failure toast offers it. It is the copy glyph alone, after the
 * failure's own presses, so the words keep their room; it answers on
 * itself, as every copy button does, and leaves the failure standing.
 *
 * It says the failure was shown as it is drawn for a failure, and hidden as
 * it goes, never on every render: the failure's `shown` answers the same
 * details for as long as the app holds it to be the same failure, and
 * reports only the first time, which is the app's to keep
 * (`../../reported-failure.ts`). Until it has answered, the button stands
 * disabled in its place, so nothing beside it moves. Words that are no
 * failure of the app's (`UNREPORTED`) offer nothing to copy, and draw
 * nothing.
 */

import { useEffect, useState } from "react";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import type { ButtonSize } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";

/** What Copy details copies, as "Copy details" names it. */
const DETAILS_WHAT = "details";

/**
 * The details of `failure` as it stands on screen, said shown once it
 * stands and anew only for another failure, or nothing until they are read.
 */
function useFailureDetails(failure: ReportedFailure | undefined): string | undefined {
  const [read, setRead] = useState<{
    readonly of: ReportedFailure;
    readonly details: string | undefined;
  }>();
  useEffect(() => {
    if (failure === undefined) return undefined;
    setRead({ of: failure, details: failure.shown() });
    return () => failure.hidden();
  }, [failure]);
  return read !== undefined && read.of === failure ? read.details : undefined;
}

/** Copy details for `failure`, where it is a failure of the app's; nothing for words that are none. */
export function FailureCopy({
  failure,
  size,
}: {
  failure: ReportedFailure | Unreported | undefined;
  size?: ButtonSize | undefined;
}): React.JSX.Element | null {
  const reported = isReported(failure) ? failure : undefined;
  const details = useFailureDetails(reported);
  if (reported === undefined) return null;
  return (
    <CopyButton
      text={details ?? ""}
      what={DETAILS_WHAT}
      copy={reported.copy}
      disabled={details === undefined}
      {...(size === undefined ? {} : { size })}
    />
  );
}
