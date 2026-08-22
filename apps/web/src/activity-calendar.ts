/**
 * Folds the admin page's zero-filled daily series into calendar weeks so a
 * GitHub-style grid can draw them: columns are UTC weeks keyed by their
 * Monday — the same weeks the retention grid stands on — and each week holds
 * seven slots, Monday first. A slot outside the window stays empty rather
 * than borrowing a neighbor's day, which is what lets a window opening
 * mid-week, or a window ending on today, draw an honestly ragged edge.
 */

export const DAYS_PER_WEEK = 7;

const DAY_MS = 86_400_000;

export interface CalendarWeek<Day extends { day: string }> {
  /** The week's UTC Monday, as YYYY-MM-DD. */
  weekStart: string;
  /** Seven slots, Monday first; a slot the window does not cover is undefined. */
  days: readonly (Day | undefined)[];
}

function daysSinceEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;
}

/** The epoch, 1970-01-01, was a Thursday: three days past its week's Monday. */
function weekdaySlot(day: string): number {
  return (daysSinceEpoch(day) + 3) % DAYS_PER_WEEK;
}

function mondayKey(day: string): string {
  return new Date((daysSinceEpoch(day) - weekdaySlot(day)) * DAY_MS).toISOString().slice(0, 10);
}

/** Reads the series as the server sends it: consecutive UTC days, oldest first. */
export function calendarWeeks<Day extends { day: string }>(
  daily: readonly Day[],
): readonly CalendarWeek<Day>[] {
  const weeks: { weekStart: string; days: (Day | undefined)[] }[] = [];
  for (const entry of daily) {
    const weekStart = mondayKey(entry.day);
    let week = weeks.at(-1);
    if (week === undefined || week.weekStart !== weekStart) {
      week = { weekStart, days: Array.from({ length: DAYS_PER_WEEK }, () => undefined) };
      weeks.push(week);
    }
    week.days[weekdaySlot(entry.day)] = entry;
  }
  return weeks;
}

/**
 * One label per week column, set where a month begins: the first column, and
 * any column whose earliest covered day opens a month its predecessor's did
 * not. The earliest covered day — not the Monday — names the month, so a
 * first column that starts mid-week is labeled for the days it actually
 * shows.
 */
export function monthLabels(
  weeks: readonly CalendarWeek<{ day: string }>[],
): readonly (string | undefined)[] {
  let previousMonth: string | undefined;
  return weeks.map((week) => {
    const firstDay = week.days.find((day) => day !== undefined);
    if (firstDay === undefined) return undefined;
    const month = firstDay.day.slice(0, 7);
    if (month === previousMonth) return undefined;
    previousMonth = month;
    return new Date(`${firstDay.day}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
  });
}
