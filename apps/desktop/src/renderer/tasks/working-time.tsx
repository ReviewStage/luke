import { useAtomValue } from "@effect/atom-react/Hooks";
import type { TurnRecord } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { Shimmer } from "@luke/panel/ai-elements/shimmer";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
import { callHeading, useMinute } from "@luke/panel/tasks/task-time";
import { Tooltip } from "@luke/panel/tooltip";
import { cn } from "@luke/ui";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { ReactNode } from "react";
import { TurnCard } from "./turn-card";

/**
 * working-time.tsx -- how long an agent has been working: the compact duration a working line counts in, the clock it counts on once a second, and the line a finished turn ends on.
 *
 * The count is the line's, never a row of its own: a transcript's
 * shimmering "Working…" says it after the word, the Call tab's running
 * turn says it after its state, and a running subagent's row says it
 * beside its spinner. The clock is one atom every count reads, run only
 * while some count stands on screen, so a run that ended, a tab that
 * closed, or a line that knows no start leaves nothing ticking. Once a
 * turn has finished, the count gives way to one quiet line at its end
 * saying how long it worked and when it ended, as Codex and Cursor end a
 * turn: "Worked for 1m 18s · Today, 3:42 PM", the day worded as a call's
 * header words it, and the turn's card on hover (`turn-card.tsx`). The two
 * read as one line in two states, so they share a type, a colour, and the
 * room above them, the finished line only without the shimmer. Both lines
 * are selectable, as the transcript around them is.
 */

/** How often a count moves: the finest unit it says. */
const WORKING_TICK = Duration.seconds(1);

const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;

/** What a transcript's last line says while its agent works. */
const WORKING_LINE = "Working…";

/** What a finished turn's last line says before how long it worked. */
const WORKED_WORDS = "Worked for ";

/** How a working line and the line a finished turn ends on are both set: the transcript's quiet status type, in the muted colour (`.status-line`, tasks.css). */
export const STATUS_LINE_CLASS = "status-line";

/** What separates how long a finished turn worked from when it ended. */
export const WORKED_SEPARATOR = " · ";

/** How long a run has gone, as devtools count it: "42s" under a minute, "1m 12s" under an hour, and "1h 3m" past it. */
export function workingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return `${minutes}m ${seconds % MINUTE_SECONDS}s`;
  return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
}

/** What a finished turn's last line says: how long it worked, and the day and time it ended, as a call's header says it from `now`. */
function workedForText(startedAt: number, endedAt: number, now: number): string {
  const ended = callHeading(endedAt, now);
  return `${WORKED_WORDS}${workingTime(endedAt - startedAt)}${WORKED_SEPARATOR}${ended}`;
}

/** The time now, and again each second: what a count is read against. */
const workingClock: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(WORKING_TICK),
);

/** The clock as the window reads it, running for as long as a count is mounted to read it. */
const workingNowAtom = rendererRuntime.atom(workingClock);

/** The time now, moved on each second while a count reads it; none until the clock's first reading lands. */
export function useWorkingNow(): number | undefined {
  return Option.getOrUndefined(AsyncResult.value(useAtomValue(workingNowAtom)));
}

/**
 * How long a run has gone since it began, said after its working word and
 * moving each second. Note that it is a timer to a reader rather than a
 * live region, because a count announced each second drowns everything else.
 */
export function WorkingTime({
  startedAt,
  className = "working-time-after",
}: {
  startedAt: number;
  /** Where it stands off the word before it: a word's breadth after a working word (`.working-time-after`), unless said otherwise. */
  className?: string;
}): ReactNode {
  const now = useWorkingNow();
  if (now === undefined) return null;
  return (
    <span className={cn("working-time", className)} role="timer" aria-live="off">
      {workingTime(now - startedAt)}
    </span>
  );
}

/**
 * The quiet line a finished turn ends on: how long it worked and when it
 * ended, hanging the turn's card while the pointer rests anywhere on it
 * (`turn-card.tsx`): what it ran on, when it began and ended in full, how
 * it ended, and its tokens, as far as its row recorded them. Note that the
 * line is only as wide as its words, so the card answers the words and not
 * the empty column beside them, and that it stands inside its message, so
 * its margin and the message's gap together are the room a working line
 * has above it. A narrow column breaks it between its two parts, never
 * inside either (planning.css).
 */
export function WorkedFor({
  startedAt,
  endedAt,
  record = {},
  models = [],
}: {
  startedAt: number;
  endedAt: number;
  /** What the turn ran on and spent, as the service said; nothing from a service older than it. */
  record?: TurnRecord | undefined;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  models?: readonly CatalogModel[] | undefined;
}): ReactNode {
  const now = useMinute();
  const text = workedForText(startedAt, endedAt, now);
  return (
    <Tooltip
      label={text}
      card={<TurnCard startedAt={startedAt} endedAt={endedAt} record={record} models={models} />}
    >
      <p className={STATUS_LINE_CLASS} data-worked="">
        <span data-worked-length="">
          {WORKED_WORDS}
          {workingTime(endedAt - startedAt)}
        </span>
        {WORKED_SEPARATOR}
        <time dateTime={new Date(endedAt).toISOString()}>{callHeading(endedAt, now)}</time>
      </p>
    </Tooltip>
  );
}

/** The shimmering line a transcript ends on while its agent works, saying what it is doing and counting how long where the run's start is known. */
export function WorkingLine({
  startedAt,
  words = WORKING_LINE,
  action,
}: {
  startedAt: number | undefined;
  /** What the agent is doing, as far as its transcript shows it: "Working…" unless said otherwise. */
  words?: string;
  /** A control the line ends on, such as the Call tab's Stop; none where the line only reports. */
  action?: ReactNode;
}): ReactNode {
  // Note that only its top margin is cleared, because the conversation's gap below it is a bottom margin a cleared one would override, leaving what is said next touching it.
  return (
    <p className={STATUS_LINE_CLASS} data-working="" aria-live="polite">
      <Shimmer>{words}</Shimmer>
      {startedAt === undefined ? null : <WorkingTime startedAt={startedAt} />}
      {action}
    </p>
  );
}
