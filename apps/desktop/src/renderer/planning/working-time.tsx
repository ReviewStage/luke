import { useAtomValue } from "@effect/atom-react/Hooks";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ReactNode } from "react";
import { Shimmer } from "../ai-elements/shimmer";
import { rendererRuntime } from "../renderer-runtime";

/**
 * working-time.tsx -- how long an agent has been working: the compact duration a working line counts in, and the clock it counts on once a second.
 *
 * The count is the line's, never a row of its own: a transcript's
 * shimmering "Working…" says it after the word, and the Work tab's running
 * turn says it after its state. The clock is one atom every count reads,
 * run only while some count stands on screen, so a run that ended, a tab
 * that closed, or a line that knows no start leaves nothing ticking.
 */

/** How often a count moves: the finest unit it says. */
const WORKING_TICK = Duration.seconds(1);

const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;

/** What a transcript's last line says while its agent works. */
const WORKING_LINE = "Working…";

/** How long a run has gone, as devtools count it: "42s" under a minute, "1m 12s" under an hour, and "1h 3m" past it. */
export function workingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return `${minutes}m ${seconds % MINUTE_SECONDS}s`;
  return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
}

/** The time now, and again each second: what a count is read against. */
export const workingClock: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(WORKING_TICK),
);

/** The clock as the window reads it, running for as long as a count is mounted to read it. */
const workingNowAtom = rendererRuntime.atom(workingClock);

/**
 * How long a run has gone since it began, said after its working word and
 * moving each second. Note that it is a timer to a reader rather than a
 * live region, because a count announced each second drowns everything else.
 */
export function WorkingTime({ startedAt }: { startedAt: number }): ReactNode {
  const now = AsyncResult.value(useAtomValue(workingNowAtom));
  if (Option.isNone(now)) return null;
  return (
    <span className="ml-1.5 text-muted-foreground tabular-nums" role="timer" aria-live="off">
      {workingTime(now.value - startedAt)}
    </span>
  );
}

/** The shimmering line a transcript ends on while its agent works, counting how long where the run's start is known. */
export function WorkingLine({ startedAt }: { startedAt: number | undefined }): ReactNode {
  return (
    <p className="m-0 text-[12.5px]" data-working="" aria-live="polite">
      <Shimmer>{WORKING_LINE}</Shimmer>
      {startedAt === undefined ? null : <WorkingTime startedAt={startedAt} />}
    </p>
  );
}
