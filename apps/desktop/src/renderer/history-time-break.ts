/**
 * How long a silence between two recorded lines has to be before the thread
 * names the moment the next one was said, the way iMessage sets a date over
 * a message that followed a long break. An hour is iMessage's own threshold:
 * closer than that, a message answers the one before it, and the row's own
 * stamp in the pull column is enough.
 */
export const HISTORY_TIME_BREAK_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** The past week's weekdays are unambiguous by name; a week on they are not. */
const WEEKDAY_NAME_DAYS = 7;

/**
 * Whether the line recorded at `recordedAt` opens a break: the thread's first
 * recorded line always does, since the date of what the reader is looking at
 * is the whole question, and a later one does when the silence before it
 * reached the threshold. A line with no stamp neither opens a break nor
 * stands as the one before the next.
 */
export function opensHistoryTimeBreak(
  previousRecordedAt: number | undefined,
  recordedAt: number | undefined,
): boolean {
  if (recordedAt === undefined) return false;
  if (previousRecordedAt === undefined) return true;
  return recordedAt - previousRecordedAt >= HISTORY_TIME_BREAK_MS;
}

export interface HistoryTimeBreakLabel {
  /** The day, as a reader would name it: Today, Yesterday, a weekday, or a date. */
  day: string;
  /** The clock time on that day. */
  time: string;
}

export interface HistoryTimeBreakFormatterOptions {
  locale?: string;
  timeZone?: string;
}

/**
 * Names the moment a break's line was said, read against `now`. The day is
 * relative only while relative is exact — Today, Yesterday, then the weekday
 * for the rest of the past week — and a date after that, with the year once
 * the year is not this one, because the thread exists to say what date an
 * old line is from and a bare weekday a fortnight on says nothing.
 */
export function createHistoryTimeBreakFormatter({
  locale,
  timeZone,
}: HistoryTimeBreakFormatterOptions = {}): (
  recordedAt: number,
  now: number,
) => HistoryTimeBreakLabel {
  const zone = timeZone === undefined ? {} : { timeZone };
  const calendar = new Intl.DateTimeFormat("en-US", {
    ...zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat(locale, { ...zone, hour: "numeric", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(locale, { ...zone, weekday: "long" });
  const dateThisYear = new Intl.DateTimeFormat(locale, {
    ...zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const datedYear = new Intl.DateTimeFormat(locale, {
    ...zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const calendarDay = (at: Date) => {
    const parts = new Map(calendar.formatToParts(at).map((part) => [part.type, part.value]));
    const year = Number(parts.get("year"));
    return {
      year,
      ordinal: Date.UTC(year, Number(parts.get("month")) - 1, Number(parts.get("day"))) / DAY_MS,
    };
  };

  return (recordedAt, now) => {
    const at = new Date(recordedAt);
    const said = calendarDay(at);
    const today = calendarDay(new Date(now));
    const daysAgo = today.ordinal - said.ordinal;
    const day =
      daysAgo === 0
        ? "Today"
        : daysAgo === 1
          ? "Yesterday"
          : daysAgo > 1 && daysAgo < WEEKDAY_NAME_DAYS
            ? weekday.format(at)
            : said.year === today.year
              ? dateThisYear.format(at)
              : datedYear.format(at);
    return { day, time: time.format(at) };
  };
}
