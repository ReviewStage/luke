import { LIVE_CLOSE_REASON, type LiveCloseReason } from "@sidecar/live";
import type { ReactNode } from "react";
import { cn } from "../ai-elements/utils";
import { Tooltip } from "../tooltip";
import { spanText, useMinute } from "./plan-time";
import { type CallRecord, callHeading } from "./transcript-model";
import { TurnModel } from "./turn-card";
import { STATUS_LINE_CLASS, WORKED_SEPARATOR, workingTime } from "./working-time";

/**
 * call-card.tsx -- the quiet line a call that ended closes with on the Call tab, and the card it hangs: how long the call ran and when it ended, then what it ran on, when, how it ended, and what it metered.
 *
 * A call closes the way a finished turn does (`working-time.tsx`'s
 * WorkedFor): one line saying it ended, how long it ran, and the day and
 * time it ended, worded as a call's header words it: "Call ended · 12m 34s
 * · Today, 3:04 PM", set at the column's start in the type and colour a
 * turn's line is. The whole line hangs the call's card while the pointer
 * rests on it, drawn as the turn's card is (`turn-card.tsx`): the voice
 * model at its head wearing its provider's mark as a turn's model does,
 * and at the head's right how the call ended where it
 * did not simply hang up; under it, when it began and ended, in full; and
 * under a hairline, the seconds the Live API metered it for, where they
 * differ from the time it ran, marked estimated where the call's close
 * never confirmed them. The Live API meters a call by its seconds alone, so
 * the card has no tokens, and no price is said. Only what the call's record
 * holds is said, so a call recorded before a field was has no row for it,
 * and a call whose end is not on record yet closes with the bare line.
 */

const SECOND_MS = 1_000;

/** What the card's corner says for how a call ended; nothing for a hang-up, from either end. */
const ENDING_WORD = {
  [LIVE_CLOSE_REASON.CLOSE_REQUESTED]: undefined,
  [LIVE_CLOSE_REASON.REMOTE_HANGUP]: undefined,
  [LIVE_CLOSE_REASON.CONNECTION_LOST]: "Dropped",
  [LIVE_CLOSE_REASON.EXPIRED]: "Timed out",
  [LIVE_CLOSE_REASON.CONTENT]: "Content filter",
} as const satisfies Record<LiveCloseReason, string | undefined>;

/** What the card's usage row is labelled, by whether the call's close confirmed its seconds. */
const METERED_LABEL = {
  CONFIRMED: "Metered",
  ESTIMATED: "Metered (estimated)",
} as const;

/** The effort a call says, which the label leaves unsaid: a voice model has none. */
const NO_EFFORT = "";

/** The card: the model and how the call ended, when it ran, and its metered time where that is not the time it ran. */
function CallCard({
  startedAt,
  endedAt,
  record,
}: {
  startedAt: number;
  endedAt: number;
  record: CallRecord;
}): React.JSX.Element {
  const { model, ending, usage } = record;
  const endingWord = ending === undefined ? undefined : ENDING_WORD[ending];
  const metered = usage === undefined ? undefined : workingTime(usage.seconds * SECOND_MS);
  // Note that the two are compared as said, because a row reading what the line already reads tells nothing.
  const meteredRow = metered !== undefined && metered !== workingTime(endedAt - startedAt);
  return (
    <div className="turn-card" data-call-card="">
      {model === undefined && endingWord === undefined ? null : (
        <div className="turn-card-head">
          {model === undefined ? null : <TurnModel model={model} effort={NO_EFFORT} models={[]} />}
          {endingWord === undefined ? null : (
            <span className="turn-card-ending" data-ending={ending}>
              {endingWord}
            </span>
          )}
        </div>
      )}
      <p className="turn-card-when">
        <time dateTime={new Date(startedAt).toISOString()}>{spanText(startedAt, endedAt)}</time>
      </p>
      {usage === undefined || !meteredRow ? null : (
        <dl className="turn-card-tokens" aria-label="Usage">
          <div className="turn-card-token">
            <dt>{usage.confirmed ? METERED_LABEL.CONFIRMED : METERED_LABEL.ESTIMATED}</dt>
            <dd>{metered}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * The line a call that ended closes with: who ended it as far as this
 * window saw, then, where the record holds its end, how long it ran and
 * when it ended, hanging the call's card. Note that the line is only as
 * wide as its words, so the card answers the words and not the empty
 * column beside them.
 */
export function CallEnded({
  line,
  startedAt,
  record,
}: {
  /** Who ended the call, as the tab says it: "Call ended" or "Luke ended the call". */
  line: string;
  startedAt: number;
  record: CallRecord | undefined;
}): ReactNode {
  const now = useMinute();
  const endedAt = record?.endedAt;
  if (record === undefined || endedAt === undefined) {
    return <p className={STATUS_LINE_CLASS}>{line}</p>;
  }
  const length = workingTime(endedAt - startedAt);
  const ended = callHeading(endedAt, now);
  return (
    <Tooltip
      label={`${line}${WORKED_SEPARATOR}${length}${WORKED_SEPARATOR}${ended}`}
      card={<CallCard startedAt={startedAt} endedAt={endedAt} record={record} />}
    >
      <p className={cn(STATUS_LINE_CLASS, "w-fit tabular-nums")} data-call-ended="">
        <span data-call-length="">
          {line}
          {WORKED_SEPARATOR}
          {length}
        </span>
        {WORKED_SEPARATOR}
        <time dateTime={new Date(endedAt).toISOString()}>{ended}</time>
      </p>
    </Tooltip>
  );
}
