import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  nextScheduledRun,
  readSchedule,
  SCHEDULE_PRESET,
  SCHEDULE_REFUSAL,
} from "./automation-schedule.js";
import { AUTOMATION_TRIGGER } from "./automation-wire.js";

/**
 * A schedule read in its own zone: due at the wall-clock time it names
 * across a daylight-saving change, refused where its cron or its zone does
 * not read or where it would fire more often than the floor.
 */

const schedule = (cron: string, timezone: string) => ({
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron,
  timezone,
});

const FROM = new Date("2026-10-30T12:00:00Z");

/** The next `count` instants a schedule is due after `from`, as ISO text. */
function upcoming(cron: string, timezone: string, from: Date, count: number): string[] {
  const due: string[] = [];
  let at = from;
  for (let index = 0; index < count; index += 1) {
    const next = nextScheduledRun(schedule(cron, timezone), at);
    if (next === undefined) break;
    due.push(next.toISOString());
    at = next;
  }
  return due;
}

describe("a scheduled automation's next run", () => {
  it("stays at nine on weekdays in New York across the end of daylight saving time", () => {
    expect(upcoming(SCHEDULE_PRESET.WEEKDAYS, "America/New_York", FROM, 3)).toEqual([
      // Friday the 30th, still on daylight time (UTC-4).
      "2026-10-30T13:00:00.000Z",
      // Monday 2 November, after the change on the 1st (UTC-5).
      "2026-11-02T14:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
    ]);
  });

  it("is strictly after the instant asked from, so a run due now is not due again", () => {
    expect(
      nextScheduledRun(schedule(SCHEDULE_PRESET.DAILY, "UTC"), new Date("2026-10-30T09:00:00Z")),
    ).toEqual(new Date("2026-10-31T09:00:00Z"));
  });

  it("refuses an expression that is not five-field cron, an unknown zone, and a schedule past the floor", () => {
    const refusal = (cron: string, timezone: string) =>
      Result.match(readSchedule({ cron, timezone }, FROM), {
        onFailure: (reason) => reason,
        onSuccess: () => undefined,
      });
    expect(refusal("every morning", "UTC")).toBe(SCHEDULE_REFUSAL.CRON);
    expect(refusal("0 0 9 * * *", "UTC")).toBe(SCHEDULE_REFUSAL.CRON);
    expect(refusal(SCHEDULE_PRESET.DAILY, "Mars/Olympus_Mons")).toBe(SCHEDULE_REFUSAL.TIMEZONE);
    expect(refusal("* * * * *", "UTC")).toBe(SCHEDULE_REFUSAL.TOO_FREQUENT);
    expect(refusal("0,5 9 * * *", "UTC")).toBe(SCHEDULE_REFUSAL.TOO_FREQUENT);
    expect(refusal("*/15 * * * *", "UTC")).toBeUndefined();
    expect(nextScheduledRun(schedule("* * * * *", "UTC"), FROM)).toBeUndefined();
  });
});
