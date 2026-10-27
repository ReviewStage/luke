import type { PlanEditor } from "@luke/features/task-wire";
import { callHeading, WORKED_SEPARATOR, workingTime } from "@luke/features/time-format";
import { LIVE_CLOSE_REASON, type LiveCloseReason } from "@luke/live";
import {
  Badge,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useMinute,
  WaveformIcon,
} from "@luke/ui";
import type { CallRecord } from "@luke/voice/transcript-model";
import { PhoneOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref.js";
import { usePerson } from "../member-directory.js";
import { RUN_CARD, RunCard } from "./turn-card.js";

/**
 * call-card.tsx -- a call's span in a task's logs, an agent's transcript and the Code tab's feed alike: the labelled rule it begins at, and the one it closes with once it has ended, hanging its card.
 *
 * A call is marked at each end by a rule across the log carrying a pill, on
 * no band of its own. It begins at "Call started" beside the voice's
 * waveform and the day and time it started, with a Live mark while it
 * stands, and it closes at "Call ended" beside a hang-up glyph, how long it
 * ran, and the day and time it ended: "Call ended · 12m 34s · Today, 3:04
 * PM". It begins and ends the same in an agent's transcript and in the Code
 * tab's feed of what was shown on it. The closing pill hangs the call's card
 * while the pointer rests on it, which is the turn's card (`turn-card.tsx`'s
 * `RunCard`): the voice model at its head wearing its provider's mark as a
 * turn's model does, when it began and ended, in full, under it, and at the
 * head's right how the call ended where it did not simply hang up; and under
 * a hairline, the seconds the Live API metered it for, where they differ
 * from the time it ran, marked estimated where the call's close never
 * confirmed them. The Live API meters a call by its seconds alone, so the
 * card has no tokens, and no price is said. Only what the call's record
 * holds is said, so a call recorded before a field was has no row for it,
 * and a call whose end is not on record yet closes with the bare words.
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

/** What a call's markers say. */
const CALL_MARKER_WORDS = {
  STARTED: "Call started",
  LIVE: "Live",
} as const;

/** Which end of a call a marker stands at. */
const CALL_MARKER_END = {
  START: "start",
  END: "end",
} as const;

type CallMarkerEnd = (typeof CALL_MARKER_END)[keyof typeof CALL_MARKER_END];

/**
 * A rule across the log with a pill in its middle, which is how a call is
 * marked at each end: the rule says where the call's lines begin or end, and
 * the pill says what happened and when, on no band of its own.
 */
function CallMarker({
  end,
  live = false,
  children,
}: {
  end: CallMarkerEnd;
  live?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="call-marker" data-call-marker={end} data-live={live ? "" : undefined}>
      <span className="call-marker-rule" aria-hidden="true" />
      {children}
      <span className="call-marker-rule" aria-hidden="true" />
    </div>
  );
}

/**
 * A teammate's call as its start names it: "Charles Pan’s call started",
 * their face and name one target hanging their card. Note that the words
 * keep their spaces inside them and the line keeps every space, because a
 * flex row drops a run of whitespace standing alone.
 */
function CallerStarted({ caller }: { caller: PlanEditor }): React.JSX.Element {
  const actor = usePerson(caller);
  return (
    <span className="call-caller">
      <ActorRef actor={actor} possessive />
      {" call started"}
    </span>
  );
}

/**
 * Where a call begins: a rule carrying a pill with the voice's waveform,
 * "Call started", and the day and time it started, and while it stands, a
 * Live mark, which keeps the marker pinned to the log's top while the
 * developer scrolls among the call's lines (tasks.css).
 */
export function CallStartMarker({
  startedAt,
  live,
  now,
  caller,
}: {
  startedAt: number;
  live: boolean;
  /** The moment the log was drawn, which the day is said against. */
  now: number;
  /** The teammate whose call it was, named in place of "Call"; none for the reader's own. */
  caller?: PlanEditor | undefined;
}): React.JSX.Element {
  return (
    <CallMarker end={CALL_MARKER_END.START} live={live}>
      <span className="call-marker-pill">
        <Badge
          tone={live ? STATUS_TONE.COMPLETE : STATUS_TONE.NEUTRAL}
          icon={
            <span className="call-marker-icon" aria-hidden="true">
              <WaveformIcon />
            </span>
          }
        >
          <span className="call-marker-line">
            <Text
              as={TEXT_ELEMENT.SPAN}
              variant={TEXT_VARIANT.INHERIT}
              truncate
              className="call-marker-text"
            >
              <span className="call-marker-words">
                {caller === undefined ? (
                  CALL_MARKER_WORDS.STARTED
                ) : (
                  <CallerStarted caller={caller} />
                )}
              </span>
              <span className="call-marker-detail">
                {WORKED_SEPARATOR}
                <time dateTime={new Date(startedAt).toISOString()}>
                  {callHeading(startedAt, now)}
                </time>
              </span>
            </Text>
            {live ? <span className="call-marker-live">{CALL_MARKER_WORDS.LIVE}</span> : null}
          </span>
        </Badge>
      </span>
    </CallMarker>
  );
}

/**
 * Where a call that ended closes: a rule carrying a pill with a hang-up
 * glyph, who ended the call as far as this window saw, then, where the
 * record holds its end, how long it ran and when it ended, the pill hanging
 * the call's card. Note that the pill is only as wide as its words, so the
 * card answers the words and not the rules beside them.
 */
export function CallEndMarker({
  line,
  startedAt,
  record,
}: {
  /** Who ended the call, as the tab says it: "Call ended" or "Luke ended the call". */
  line: string;
  startedAt: number;
  record: CallRecord | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const endedAt = record?.endedAt;
  const icon = (
    <span className="call-marker-icon" aria-hidden="true">
      <PhoneOffIcon />
    </span>
  );
  if (record === undefined || endedAt === undefined) {
    return (
      <CallMarker end={CALL_MARKER_END.END}>
        <p className="call-marker-pill" data-call-ended="">
          <Badge icon={icon}>
            <span className="call-marker-line">
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="call-marker-text"
              >
                <span className="call-marker-words">{line}</span>
              </Text>
            </span>
          </Badge>
        </p>
      </CallMarker>
    );
  }
  const length = workingTime(endedAt - startedAt);
  const ended = callHeading(endedAt, now);
  return (
    <CallMarker end={CALL_MARKER_END.END}>
      <Tooltip
        label={`${line}${WORKED_SEPARATOR}${length}${WORKED_SEPARATOR}${ended}`}
        card={<CallCard startedAt={startedAt} endedAt={endedAt} record={record} />}
      >
        <p className="call-marker-pill" data-call-ended="">
          <Badge icon={icon}>
            <span className="call-marker-line">
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="call-marker-text"
              >
                <span className="call-marker-words" data-call-length="">
                  {line}
                  <span className="call-marker-detail">
                    {WORKED_SEPARATOR}
                    {length}
                  </span>
                </span>
                <span className="call-marker-detail">
                  {WORKED_SEPARATOR}
                  <time dateTime={new Date(endedAt).toISOString()}>{ended}</time>
                </span>
              </Text>
            </span>
          </Badge>
        </p>
      </Tooltip>
    </CallMarker>
  );
}
