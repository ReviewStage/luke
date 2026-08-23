/**
 * Folds the account page's zero-filled daily series into calendar weeks so a
 * trailing-year intensity grid can draw them: columns are UTC weeks keyed by
 * their Sunday, and each week holds seven slots, Sunday first. Sunday-first
 * weeks are this calendar's own convention — the retention grid and every
 * other weekly surface stay on Monday-keyed UTC weeks, where Postgres's
 * `date_trunc('week')` lands. A slot outside the span stays empty rather
 * than borrowing a neighbor's day, which is what lets a span opening
 * mid-week, or a span ending on today, draw an honestly ragged edge.
 */

export const DAYS_PER_WEEK = 7;

const DAY_MS = 86_400_000;

export interface CalendarWeek<Day extends { day: string }> {
  /** The week's UTC Sunday, as YYYY-MM-DD. */
  weekStart: string;
  /** Seven slots, Sunday first; a slot the span does not cover is undefined. */
  days: readonly (Day | undefined)[];
}

function daysSinceEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;
}

/** The epoch, 1970-01-01, was a Thursday: four days past its week's Sunday. */
function weekdaySlot(day: string): number {
  return (daysSinceEpoch(day) + 4) % DAYS_PER_WEEK;
}

function sundayKey(day: string): string {
  return new Date((daysSinceEpoch(day) - weekdaySlot(day)) * DAY_MS).toISOString().slice(0, 10);
}

/** Reads the series as the server sends it: consecutive UTC days, oldest first. */
export function calendarWeeks<Day extends { day: string }>(
  daily: readonly Day[],
): readonly CalendarWeek<Day>[] {
  const weeks: { weekStart: string; days: (Day | undefined)[] }[] = [];
  for (const entry of daily) {
    const weekStart = sundayKey(entry.day);
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
 * not. The earliest covered day — not the Sunday — names the month, so a
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

/**
 * Every `keepEvery`th of the labels `monthLabels` set, first kept, in their
 * columns. At widths where a year's thirteen labels would collide, dropping
 * whole labels keeps the survivors readable; squeezing all thirteen would
 * overlap them into none.
 */
export function thinMonthLabels(
  labels: readonly (string | undefined)[],
  keepEvery: number,
): readonly (string | undefined)[] {
  let ordinal = 0;
  return labels.map((label) => {
    if (label === undefined) return undefined;
    ordinal += 1;
    return (ordinal - 1) % keepEvery === 0 ? label : undefined;
  });
}
