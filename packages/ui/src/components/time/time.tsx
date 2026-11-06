import {
  agoText,
  callHeading,
  dueText,
  momentText,
  provenanceText,
  sinceText,
  workingTime,
} from "@repo/features/time-format";
import { Tooltip } from "../tooltip/hint.js";
import { useMinute, useSecond } from "./time-clock.js";

export const TIME_LOOK = {
  SINCE: "since",
  AGO: "ago",
  PROVENANCE: "provenance",
  DAY: "day",
  DUE: "due",
  MOMENT: "moment",
  DURATION: "duration",
} as const;

export type TimeLook = (typeof TIME_LOOK)[keyof typeof TIME_LOOK];

const HINTED_LOOKS: readonly TimeLook[] = [TIME_LOOK.SINCE, TIME_LOOK.AGO];

interface TimeProps {
  at: number;
  look?: TimeLook | undefined;
  now?: number | undefined;
  className?: string | undefined;
  hint?: boolean | undefined;
}

function wordsOf(look: TimeLook, at: number, now: number): string {
  switch (look) {
    case TIME_LOOK.SINCE:
      return sinceText(at, now);
    case TIME_LOOK.AGO:
      return agoText(at, now);
    case TIME_LOOK.PROVENANCE:
      return provenanceText(at, now);
    case TIME_LOOK.DAY:
      return callHeading(at, now);
    case TIME_LOOK.DUE:
      return dueText(at, now);
    case TIME_LOOK.MOMENT:
      return momentText(at);
    case TIME_LOOK.DURATION:
      return workingTime(now - at);
  }
}

export function Time(props: TimeProps): React.JSX.Element {
  const { now, look = TIME_LOOK.SINCE } = props;
  if (now !== undefined) return <TimeAt {...props} look={look} now={now} />;
  return look === TIME_LOOK.DURATION ? (
    <SecondTime {...props} look={look} />
  ) : (
    <MinuteTime {...props} look={look} />
  );
}

function MinuteTime(props: Omit<TimeAtProps, "now">): React.JSX.Element {
  return <TimeAt {...props} now={useMinute()} />;
}

function SecondTime(props: Omit<TimeAtProps, "now">): React.JSX.Element {
  return <TimeAt {...props} now={useSecond()} />;
}

type TimeAtProps = TimeProps & { look: TimeLook; now: number };

function TimeAt({ at, look, now, className, hint }: TimeAtProps): React.JSX.Element {
  const duration = look === TIME_LOOK.DURATION;
  const time = (
    <time
      className={className === undefined ? "ui-time" : `ui-time ${className}`}
      dateTime={duration ? durationDateTime(now - at) : new Date(at).toISOString()}
      role={duration ? "timer" : undefined}
      aria-live={duration ? "off" : undefined}
    >
      {wordsOf(look, at, now)}
    </time>
  );
  return (hint ?? HINTED_LOOKS.includes(look)) ? (
    <Tooltip label={momentText(at)}>{time}</Tooltip>
  ) : (
    time
  );
}

function durationDateTime(elapsedMs: number): string {
  return `PT${Math.floor(Math.max(0, elapsedMs) / 1_000)}S`;
}
