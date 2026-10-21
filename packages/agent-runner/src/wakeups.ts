/**
 * wakeups.ts -- when a one-shot task Claude Code scheduled comes due, read from its cron schedule.
 *
 * A one-shot task, a self-paced loop's pending wakeup among them, pins its
 * fire time to a minute and an hour in a five-field cron expression
 * (`minute hour day-of-month month day-of-week`), read in the local time
 * zone of the machine the CLI runs on
 * (https://code.claude.com/docs/en/scheduled-tasks). The runner runs on that
 * machine, beside the CLI, so it reads the schedule in its own local time
 * and answers the instant, which Luke keeps and delivers the wakeup at
 * wherever it runs. A schedule that pins no single minute, such as a step
 * or a list, is no one-shot's this can tell the time of, and answers none.
 */

/** How far ahead a schedule's next match is looked for: a year, since a one-shot's day and month are its own. */
const SEARCH_DAYS = 366;

const WILDCARD = "*";

/** A field as a number in its range, the wildcard as none, and anything else as not readable. */
function fieldOf(text: string, min: number, max: number): number | "any" | undefined {
  if (text === WILDCARD) return "any";
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const value = Number(text);
  return value >= min && value <= max ? value : undefined;
}

/**
 * The instant a one-shot schedule next comes due after `now`, in the local
 * time zone; none where the schedule pins no single minute and hour, names
 * a weekday, or matches no day within a year.
 */
export function oneShotDueAt(schedule: string, now: Date): Date | undefined {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minuteText, hourText, dayText, monthText, weekdayText] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minute = fieldOf(minuteText, 0, 59);
  const hour = fieldOf(hourText, 0, 23);
  const day = fieldOf(dayText, 1, 31);
  const month = fieldOf(monthText, 1, 12);
  if (typeof minute !== "number" || typeof hour !== "number") return undefined;
  if (day === undefined || month === undefined || weekdayText !== WILDCARD) return undefined;
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      hour,
      minute,
    );
    // A day the month does not have rolls into the next month, which matches neither field.
    const dayMatches = day === "any" || candidate.getDate() === day;
    const monthMatches = month === "any" || candidate.getMonth() + 1 === month;
    if (dayMatches && monthMatches && candidate.getTime() > now.getTime()) return candidate;
  }
  return undefined;
}
