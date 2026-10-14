import { Cron, DateTime, Option, Result } from "effect";

/**
 * automation-schedule.ts -- when a scheduled automation is next due: its cron read in its time zone, held to a floor on how often it fires.
 *
 * A schedule is five-field cron (minute, hour, day of month, month, day of
 * week) read in the IANA zone the automation names, so "nine every weekday"
 * in New York is nine there in January and in July alike, and a time a
 * daylight-saving change skips or repeats is Effect's `Cron` to settle. A
 * schedule that would fire more often than `MIN_INTERVAL_MS` anywhere in
 * its next `INTERVAL_SAMPLE` firings is refused, because every firing starts
 * a coding agent and a minute's cron is a runaway, not a schedule. It is
 * declared here, beside the wire, so the service that fires a schedule and
 * the window that shows its next run read it the same way.
 */

export const AUTOMATION_SCHEDULE = {
  /** The shortest gap a schedule may leave between two firings. */
  MIN_INTERVAL_MS: 15 * 60_000,
  /** How many firings ahead the floor is checked over. */
  INTERVAL_SAMPLE: 64,
  /**
   * How late past its due instant a firing may still run: a sweep that
   * missed a schedule by more, a deployment or the cron itself down, moves
   * it on to its next instant rather than starting a stale run.
   */
  MISFIRE_GRACE_MS: 60 * 60_000,
} as const;

/** The schedules a picker offers before anyone writes cron, each read in the automation's zone. */
export const SCHEDULE_PRESET = {
  HOURLY: "0 * * * *",
  DAILY: "0 9 * * *",
  WEEKDAYS: "0 9 * * 1-5",
  WEEKLY: "0 9 * * 1",
} as const;

/** Why a schedule was refused. */
export const SCHEDULE_REFUSAL = {
  /** The expression is not five-field cron. */
  CRON: "cron",
  /** The zone is not one the IANA database names. */
  TIMEZONE: "timezone",
  /** It fires more often than the floor allows. */
  TOO_FREQUENT: "too-frequent",
} as const;

export type ScheduleRefusal = (typeof SCHEDULE_REFUSAL)[keyof typeof SCHEDULE_REFUSAL];

/** A schedule as a trigger names it: the cron and the zone it is read in. */
interface Schedule {
  readonly cron: string;
  readonly timezone: string;
}

/** The number of fields five-field cron spells. */
const CRON_FIELDS = 5;

/** Whether any two firings of the next sample fall closer than the floor. */
function firesTooOften(cron: Cron.Cron, from: Date): boolean {
  let previous: Date | undefined;
  let taken = 0;
  for (const at of Cron.sequence(cron, from)) {
    if (
      previous !== undefined &&
      at.getTime() - previous.getTime() < AUTOMATION_SCHEDULE.MIN_INTERVAL_MS
    ) {
      return true;
    }
    previous = at;
    taken += 1;
    if (taken >= AUTOMATION_SCHEDULE.INTERVAL_SAMPLE) return false;
  }
  return false;
}

/** The schedule read for firing, or why it cannot be, with the floor checked from `from`. */
export function readSchedule(
  schedule: Schedule,
  from: Date,
): Result.Result<Cron.Cron, ScheduleRefusal> {
  if (schedule.cron.trim().split(/\s+/u).length !== CRON_FIELDS) {
    return Result.fail(SCHEDULE_REFUSAL.CRON);
  }
  const zone = DateTime.zoneMakeNamed(schedule.timezone);
  if (Option.isNone(zone)) return Result.fail(SCHEDULE_REFUSAL.TIMEZONE);
  const parsed = Cron.parse(schedule.cron, zone.value);
  if (Result.isFailure(parsed)) return Result.fail(SCHEDULE_REFUSAL.CRON);
  if (firesTooOften(parsed.success, from)) return Result.fail(SCHEDULE_REFUSAL.TOO_FREQUENT);
  return Result.succeed(parsed.success);
}

/** The first instant strictly after `after` the schedule is due; nothing for a schedule that cannot be read. */
export function nextScheduledRun(schedule: Schedule, after: Date): Date | undefined {
  const read = readSchedule(schedule, after);
  return Result.isSuccess(read) ? Cron.next(read.success, after) : undefined;
}
