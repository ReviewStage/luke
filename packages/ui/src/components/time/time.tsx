import { agoText, callHeading, momentText, sinceText, workingTime } from "../../time-format.js";
import { Tooltip } from "../tooltip/hint.js";
import { useMinute, useSecond } from "./time-clock.js";

/**
 * time.tsx -- the one way a time is drawn: a `<time dateTime>` saying a moment's age, its day, the moment itself, or how long a run has gone, with the moment in full in the window's own tooltip.
 *
 * Every look is `time-format.ts`'s words, so a sidebar row, an Inbox row, a
 * version row, a file note, and a card all say "3h" for the same save. A
 * time counts from the window's minute (`useMinute`), or from the second
 * for a run's length (`useSecond`), so a row drawing one need not be drawn
 * again for its time to move; given a `now` it counts from that and ticks
 * no clock. The full moment hangs in the window's pill rather than the
 * system's `title`, as every other hint here does. Note that a time on a
 * hover card raises no pill (`hint={false}`), because a pill hung from a card
 * stands over the card and covers the words it is read beside; nor does a
 * sidebar or Inbox row's, which steps out of sight while its row is
 * hovered, so no pointer rests on it, and nor does a time inside a tooltip
 * of its own. Its figures are tabular, so a time that ticks or sits in a
 * column shifts nothing beside it, and no parent need ask.
 */

/** How a time is said. */
export const TIME_LOOK = {
  /** A row's few letters: "now", "5m", "3h", and a date once a month old. */
  SINCE: "since",
  /** A line's words: "5m ago". */
  AGO: "ago",
  /** A call's day and clock: "Today, 3:42 PM". */
  DAY: "day",
  /** The moment in full: "Oct 14, 2026, 3:42 PM". */
  MOMENT: "moment",
  /** How long a run has gone since `at`, counted each second: "1m 12s". */
  DURATION: "duration",
} as const;

export type TimeLook = (typeof TIME_LOOK)[keyof typeof TIME_LOOK];

/** The looks whose full moment hangs on hover unless said otherwise: an age alone leaves the day out. */
const HINTED_LOOKS: readonly TimeLook[] = [TIME_LOOK.SINCE, TIME_LOOK.AGO];

interface TimeProps {
  at: number;
  look?: TimeLook | undefined;
  /** What the age counts from; none counts from the window's minute (or second, for `DURATION`). */
  now?: number | undefined;
  className?: string | undefined;
  /** Whether the full moment hangs in the tooltip: on for the ages, off for the rest, unless said otherwise. */
  hint?: boolean | undefined;
}

/** The words of a look, counted from `now`. */
function wordsOf(look: TimeLook, at: number, now: number): string {
  switch (look) {
    case TIME_LOOK.SINCE:
      return sinceText(at, now);
    case TIME_LOOK.AGO:
      return agoText(at, now);
    case TIME_LOOK.DAY:
      return callHeading(at, now);
    case TIME_LOOK.MOMENT:
      return momentText(at);
    case TIME_LOOK.DURATION:
      return workingTime(now - at);
  }
}

/** A time: a `<time>` in `look`'s words, its full moment on hover where the look hints it. */
export function Time(props: TimeProps): React.JSX.Element {
  const { now, look = TIME_LOOK.SINCE } = props;
  if (now !== undefined) return <TimeAt {...props} look={look} now={now} />;
  return look === TIME_LOOK.DURATION ? (
    <SecondTime {...props} look={look} />
  ) : (
    <MinuteTime {...props} look={look} />
  );
}

/** A time counted from the window's minute, which alone is drawn again as the minute moves. */
function MinuteTime(props: Omit<TimeAtProps, "now">): React.JSX.Element {
  return <TimeAt {...props} now={useMinute()} />;
}

/** A run's length counted from the window's second. */
function SecondTime(props: Omit<TimeAtProps, "now">): React.JSX.Element {
  return <TimeAt {...props} now={useSecond()} />;
}

type TimeAtProps = TimeProps & { look: TimeLook; now: number };

function TimeAt({ at, look, now, className, hint }: TimeAtProps): React.JSX.Element {
  const duration = look === TIME_LOOK.DURATION;
  // Note that a count is a timer to a reader rather than a live region, because a count announced each second drowns everything else.
  const time = (
    <time
      className={className === undefined ? "luke-time" : `luke-time ${className}`}
      dateTime={duration ? durationDateTime(now - at) : new Date(at).toISOString()}
      role={duration ? "timer" : undefined}
      aria-live={duration ? "off" : undefined}
    >
      {wordsOf(look, at, now)}
    </time>
  );
  // Note that a time raising no pill is drawn bare, because a sidebar row draws several, and a tooltip saying nothing still costs each its own.
  return (hint ?? HINTED_LOOKS.includes(look)) ? (
    <Tooltip label={momentText(at)}>{time}</Tooltip>
  ) : (
    time
  );
}

/** A length as a `<time>`'s duration: "PT72S". */
function durationDateTime(elapsedMs: number): string {
  return `PT${Math.floor(Math.max(0, elapsedMs) / 1_000)}S`;
}
