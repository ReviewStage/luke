import { Cron, DateTime, Option, Result } from "effect";

export const AUTOMATION_SCHEDULE = {
  MIN_INTERVAL_MS: 15 * 60_000,
  INTERVAL_SAMPLE: 64,
  MISFIRE_GRACE_MS: 60 * 60_000,
} as const;

export const SCHEDULE_PRESET = {
  HOURLY: "0 * * * *",
  DAILY: "0 9 * * *",
  WEEKDAYS: "0 9 * * 1-5",
  WEEKLY: "0 9 * * 1",
} as const;

export const SCHEDULE_REFUSAL = {
  CRON: "cron",
  TIMEZONE: "timezone",
  TOO_FREQUENT: "too-frequent",
} as const;

export type ScheduleRefusal = (typeof SCHEDULE_REFUSAL)[keyof typeof SCHEDULE_REFUSAL];

interface Schedule {
  readonly cron: string;
  readonly timezone: string;
}

const CRON_FIELDS = 5;

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

export function nextScheduledRun(schedule: Schedule, after: Date): Date | undefined {
  const read = readSchedule(schedule, after);
  return Result.isSuccess(read) ? Cron.next(read.success, after) : undefined;
}
