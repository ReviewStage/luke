import { Duration } from "effect";

export const DAYS_PER_WEEK = 7;

const DAY_MS = Duration.toMillis(Duration.days(1));

interface CalendarWeek<Day extends { day: string }> {
  weekStart: string;
  days: readonly (Day | undefined)[];
}

function daysSinceEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;
}

function weekdaySlot(day: string): number {
  return (daysSinceEpoch(day) + 4) % DAYS_PER_WEEK;
}

function sundayKey(day: string): string {
  return new Date((daysSinceEpoch(day) - weekdaySlot(day)) * DAY_MS).toISOString().slice(0, 10);
}

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

export function lastWeeks<Day extends { day: string }>(
  weeks: readonly CalendarWeek<Day>[],
  count: number,
): readonly CalendarWeek<Day>[] {
  return count >= weeks.length ? weeks : weeks.slice(weeks.length - count);
}
