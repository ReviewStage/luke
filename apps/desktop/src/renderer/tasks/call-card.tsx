import type { PlanEditor } from "@luke/features/task-wire";
import { LIVE_CLOSE_REASON, type LiveCloseReason } from "@luke/live";
import { Checkpoint } from "@luke/panel/ai-elements/checkpoint";
import { usePerson } from "@luke/panel/member-directory";
import { callHeading, useMinute } from "@luke/panel/tasks/task-time";
import { Tooltip } from "@luke/panel/tooltip";
import type { CallRecord } from "@luke/voice/transcript-model";
import { AudioLinesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref";
import { RUN_CARD, RunCard } from "./turn-card";
import { STATUS_LINE_CLASS, WORKED_SEPARATOR, workingTime } from "./working-time";

/**
 * call-card.tsx -- a call's span in a task's logs, the Call tab's and the Code tab's alike: the divider it begins at, and the quiet line it closes with once it has ended, hanging its card.
 *
 * A call begins at a Checkpoint saying the day and time it started, marked
 * live at its right while it stands, in the developer's colour beside the
 * voice mark, and it begins and ends the same in the Call tab's thread and
 * in the Code tab's feed of what was shown on it. It closes the way a
 * finished turn does (`working-time.tsx`'s
 * WorkedFor): one line saying it ended, how long it ran, and the day and
 * time it ended, worded as a call's header words it: "Call ended · 12m 34s
 * · Today, 3:04 PM", set at the column's start in the type and colour a
 * turn's line is. The whole line hangs the call's card while the pointer
 * rests on it, which is the turn's card (`turn-card.tsx`'s `RunCard`): the
 * voice model at its head wearing its provider's mark as a turn's model
 * does, when it began and ended, in full, under it, and at the head's right
 * how the call ended where it did not simply hang up; and under a hairline,
 * the seconds the Live API metered it for, where they differ from the time
 * it ran, marked estimated where the call's close never confirmed them. The Live API meters a call by its seconds alone, so
 * the card has no tokens, and no price is said. Only what the call's record
 * holds is said, so a call recorded before a field was has no row for it,
 * and a call whose end is not on record yet closes with the bare line.
 */

const SECOND_MS = 1_000;

/** What a call's checkpoint says at its right while the call stands. */
const LIVE_LABEL = "Live";

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

/** What the card's figures are, for a reader. */
const USAGE_LABEL = "Usage";

/** The effort a call says, which the label leaves unsaid: a voice model has none. */
const NO_EFFORT = "";

/** The card: the voice model and how the call ended, when it ran, and its metered time where that is not the time it ran. */
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
  const figures =
    usage === undefined || metered === undefined || metered === workingTime(endedAt - startedAt)
      ? undefined
      : {
          label: USAGE_LABEL,
          rows: [
            [usage.confirmed ? METERED_LABEL.CONFIRMED : METERED_LABEL.ESTIMATED, metered],
          ] as const,
        };
  return (
    <RunCard
      kind={RUN_CARD.CALL}
      model={model === undefined ? undefined : { id: model, effort: NO_EFFORT, models: [] }}
      startedAt={startedAt}
      endedAt={endedAt}
      ending={
        ending === undefined || endingWord === undefined
          ? undefined
          : { reason: ending, word: endingWord }
      }
      note={undefined}
      figures={figures}
    />
  );
}

/**
 * A teammate's call as its divider names it: "Charles Pan’s call · Today,
 * 3:42 PM", their face and name one target hanging their card. Note that
 * the words keep their spaces inside them and the line keeps every space,
 * because a flex row drops a run of whitespace standing alone.
 */
function CallerHeading({
  caller,
  heading,
}: {
  caller: PlanEditor;
  heading: string;
}): React.JSX.Element {
  const actor = usePerson(caller);
  return (
    <span className="call-caller">
      <ActorRef actor={actor} possessive />
      {` call${WORKED_SEPARATOR}${heading}`}
    </span>
  );
}

/** The divider a call begins at: the day and time it started, and while it stands, that it is live. */
export function CallCheckpoint({
  startedAt,
  live,
  now,
  caller,
}: {
  startedAt: number;
  live: boolean;
  /** The moment the log was drawn, which the day is said against. */
  now: number;
  /** The teammate whose call it was, named before when it started; none for the reader's own. */
  caller?: PlanEditor | undefined;
}): React.JSX.Element {
  return (
    <Checkpoint
      trailing={
        live ? (
          <span className="checkpoint-live">
            <AudioLinesIcon aria-hidden="true" />
            {LIVE_LABEL}
          </span>
        ) : null
      }
    >
      {caller === undefined ? (
        callHeading(startedAt, now)
      ) : (
        <CallerHeading caller={caller} heading={callHeading(startedAt, now)} />
      )}
    </Checkpoint>
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
      <p className={STATUS_LINE_CLASS} data-call-ended="">
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
