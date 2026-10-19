import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { DAYS_PER_WEEK } from "../../activity-calendar.js";
import { BackIcon, ForwardIcon } from "../../face/glyphs.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";

/**
 * calendar.tsx -- one month of days to pick one day or a range from, a week to a row, Sunday first.
 *
 * The calendar is controlled and holds no opinion of its own: the caller
 * hands it the month shown, today, and the selection's start and end, each
 * day a `YYYY-MM-DD` string and the month `YYYY-MM`, and hears a pick of a
 * day and a request to show another month. Whether a pick sets the start or
 * the end is the caller's to decide; a selection with an end is a range.
 * Today is handed in rather than read from the clock, so a test and a
 * catalog draw the same month whatever the day.
 *
 * Six weeks always stand, so paging months never moves what is drawn under
 * the calendar; the days of the months either side are dimmed and still
 * picked like any other. Today is marked, a single day or a range's ends
 * are filled, and the days between a range's ends are washed as one band.
 *
 * The grid is one tab stop, on the day the keyboard last stood on in the
 * shown month, else the start, else today, else the month's first. Arrows
 * step by a day or a week, Home and End go to the week's Sunday and
 * Saturday, PageUp and PageDown by a month (with Shift, a year), and Enter
 * or Space picks. A step that leaves the shown month asks the caller to show
 * the month it lands in, and the keyboard follows it there once it does,
 * however many renders later. The calendar pages through the four-digit
 * years alone, 0001 to 9999, the span a `YYYY-MM-DD` day spells.
 */

/** Weeks drawn whatever the month, enough for any month to fit. */
const WEEKS_SHOWN = 6;

/** Months in a year, for Shift with PageUp and PageDown. */
const MONTHS_PER_YEAR = 12;

/** The locale every name the calendar spells is in, as a date mention's are. */
const LOCALE = "en-US";

/** The first and last days a four-digit year spells, the span the calendar pages through. */
const FIRST_DAY = "0001-01-01";
const LAST_DAY = "9999-12-31";

/** A day as the calendar reads and writes one. */
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/u;

/** A Sunday, from which the weekday headings are spelled in order. */
const A_SUNDAY = "2026-10-18";

/** Where a day stands against the selection, which its fill is drawn from. */
const DAY_PLACE = {
  SINGLE: "single",
  START: "start",
  END: "end",
  BETWEEN: "between",
} as const;

type DayPlace = (typeof DAY_PLACE)[keyof typeof DAY_PLACE];

/** How many days each arrow steps the keyboard. */
const ARROW_STEPS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -DAYS_PER_WEEK],
  ["ArrowDown", DAYS_PER_WEEK],
]);

/** The keys that pick the day the keyboard is on. */
const PICK_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

/** The UTC midnight of `day`. */
function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The day of a UTC date, as YYYY-MM-DD. */
function dayOfDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The month `day` falls in, as YYYY-MM. */
function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The day `count` days from `day`. */
function shiftedDay(day: string, count: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + count);
  return dayOfDate(date);
}

/** The same day of the month `count` months from `day`, held to that month's last. */
function monthShiftedDay(day: string, count: number): string {
  const date = dateOf(day);
  const wanted = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(wanted, last.getUTCDate()));
  return dayOfDate(date);
}

/**
 * Whether `day` is one the calendar draws and steps to: a four-digit year's,
 * since a date past 9999 spells an extended year (`+010000-…`) that no
 * `YYYY-MM-DD` reader takes.
 */
function onCalendar(day: string): boolean {
  return DAY_SHAPE.test(day) && day >= FIRST_DAY && day <= LAST_DAY;
}

/** Sunday is 0 and Saturday 6. */
function weekdayOf(day: string): number {
  return dateOf(day).getUTCDay();
}

/** `day` spelled in the calendar's locale, read as the UTC day it names. */
function spelled(day: string, options: Intl.DateTimeFormatOptions): string {
  return dateOf(day).toLocaleDateString(LOCALE, { ...options, timeZone: "UTC" });
}

/** One drawn week: its place in the grid, and its seven days, a day past the calendar's span left empty. */
interface DrawnWeek {
  readonly row: number;
  readonly days: readonly (string | undefined)[];
}

/** The six weeks drawn for `month`, each seven days from its Sunday. */
function weeksOf(month: string): readonly DrawnWeek[] {
  const first = `${month}-01`;
  const sunday = shiftedDay(first, -weekdayOf(first));
  return Array.from({ length: WEEKS_SHOWN }, (_, row) => ({
    row,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, slot) => {
      const day = shiftedDay(sunday, row * DAYS_PER_WEEK + slot);
      return onCalendar(day) ? day : undefined;
    }),
  }));
}

/** Where `day` stands against the selection from `start` to `end`, in either order. */
function placeOf(
  day: string,
  start: string | undefined,
  end: string | undefined,
): DayPlace | undefined {
  if (start === undefined) return undefined;
  if (end === undefined || end === start) return day === start ? DAY_PLACE.SINGLE : undefined;
  const [low, high] = start < end ? [start, end] : [end, start];
  if (day === low) return DAY_PLACE.START;
  if (day === high) return DAY_PLACE.END;
  return day > low && day < high ? DAY_PLACE.BETWEEN : undefined;
}

/** The day a key steps to from `day`, wherever it lands, or none for a key that moves nothing. */
function keyStep(event: KeyboardEvent<HTMLElement>, day: string): string | undefined {
  const step = ARROW_STEPS.get(event.key);
  if (step !== undefined) return shiftedDay(day, step);
  const months = event.shiftKey ? MONTHS_PER_YEAR : 1;
  if (event.key === "PageUp") return monthShiftedDay(day, -months);
  if (event.key === "PageDown") return monthShiftedDay(day, months);
  if (event.key === "Home") return shiftedDay(day, -weekdayOf(day));
  if (event.key === "End") return shiftedDay(day, DAYS_PER_WEEK - 1 - weekdayOf(day));
  return undefined;
}

/** The day the grid's tab stop rests on in `month` before the keyboard has moved in it. */
function restingDay(month: string, start: string | undefined, today: string): string {
  if (start !== undefined && monthOf(start) === month) return start;
  if (monthOf(today) === month) return today;
  return `${month}-01`;
}

/** The weekday headings, Sunday first: two letters drawn, the whole name read. */
const WEEKDAYS = Array.from({ length: DAYS_PER_WEEK }, (_, slot) => {
  const day = shiftedDay(A_SUNDAY, slot);
  return {
    day,
    short: spelled(day, { weekday: "short" }).slice(0, 2),
    long: spelled(day, { weekday: "long" }),
  };
});

/**
 * `month`'s days, `start` to `end` selected, `today` marked; `onPick`
 * hears a day picked by a press or a key, and `onShowMonth` the month the
 * arrows above it or the keyboard ask for.
 */
export function Calendar({
  month,
  today,
  start,
  end,
  onPick,
  onShowMonth,
}: {
  /** The month shown, as YYYY-MM. */
  month: string;
  /** Today, as YYYY-MM-DD, which is marked wherever it is drawn. */
  today: string;
  /** The selected day, or a range's start, as YYYY-MM-DD; none while nothing is picked. */
  start?: string | undefined;
  /** A range's end, as YYYY-MM-DD; with it the selection is a range. */
  end?: string | undefined;
  /** Answers a day picked, as YYYY-MM-DD. */
  onPick: (day: string) => void;
  /** Answers a request to show another month, as YYYY-MM. */
  onShowMonth: (month: string) => void;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const grid = useRef<HTMLTableElement>(null);
  // The day a key moved the keyboard to, until the grid draws it and it takes the focus.
  const following = useRef<string | undefined>(undefined);
  const [moved, setMoved] = useState<string | undefined>(undefined);
  const focusDay =
    moved !== undefined && monthOf(moved) === month ? moved : restingDay(month, start, today);
  const ranged = start !== undefined && end !== undefined && end !== start;
  const first = `${month}-01`;

  // Note that the keyboard is moved after the render that draws the day it
  // lands on, and waits for it, because a step into another month waits for
  // the caller to show that month, which it may do renders later.
  useEffect(() => {
    const target = following.current;
    if (target === undefined || monthOf(target) !== month) return;
    const button = grid.current?.querySelector<HTMLElement>(`[data-day="${target}"]`);
    if (button === null || button === undefined) return;
    following.current = undefined;
    button.focus();
  });

  const pick = (day: string) => {
    following.current = undefined;
    setMoved(day);
    onPick(day);
  };

  const showMonth = (count: number) => {
    following.current = undefined;
    onShowMonth(monthOf(monthShiftedDay(first, count)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const day = event.target instanceof HTMLElement ? event.target.dataset.day : undefined;
    if (day === undefined) return;
    if (PICK_KEYS.has(event.key)) {
      event.preventDefault();
      pick(day);
      return;
    }
    const target = keyStep(event, day);
    if (target === undefined) return;
    // Note that a moving key is the grid's even where the span stops it, so it never scrolls the page.
    event.preventDefault();
    if (!onCalendar(target)) return;
    following.current = target;
    setMoved(target);
    if (monthOf(target) !== month) onShowMonth(monthOf(target));
  };

  // Note that focus leaving the grid drops a step still waiting on its month,
  // so a month shown later never pulls the keyboard back from elsewhere.
  const onBlur = (event: FocusEvent<HTMLTableElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    following.current = undefined;
  };

  return (
    <div className="luke-calendar">
      <div className="luke-calendar-head">
        <span className="luke-calendar-title" id={titleId} aria-live="polite">
          {spelled(first, { month: "long", year: "numeric" })}
        </span>
        <span className="luke-calendar-steps">
          <IconButton
            icon={<BackIcon />}
            label="Previous month"
            size={BUTTON_SIZE.COMPACT}
            disabled={month <= monthOf(FIRST_DAY)}
            onClick={() => showMonth(-1)}
          />
          <IconButton
            icon={<ForwardIcon />}
            label="Next month"
            size={BUTTON_SIZE.COMPACT}
            disabled={month >= monthOf(LAST_DAY)}
            onClick={() => showMonth(1)}
          />
        </span>
      </div>
      <table
        ref={grid}
        className="luke-calendar-grid"
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a date grid is a table the arrows move through, which is what ARIA's grid is for, as the APG's date picker draws it.
        role="grid"
        aria-labelledby={titleId}
        aria-multiselectable={ranged ? true : undefined}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th
                key={weekday.day}
                className="luke-calendar-weekday"
                scope="col"
                aria-label={weekday.long}
              >
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(month).map((week) => (
            <tr key={week.row}>
              {week.days.map((day, slot) => {
                if (day === undefined) return <td key={WEEKDAYS[slot]?.day} />;
                const place = placeOf(day, start, end);
                return (
                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: inside a grid a cell is a gridcell, which takes aria-selected; the rule reads it as a plain table's cell.
                  <td
                    key={day}
                    className="luke-calendar-cell"
                    aria-selected={place !== undefined}
                    data-place={place}
                  >
                    <button
                      type="button"
                      className="luke-calendar-day"
                      tabIndex={day === focusDay ? 0 : -1}
                      aria-label={spelled(day, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                      aria-current={day === today ? "date" : undefined}
                      data-day={day}
                      data-outside={monthOf(day) !== month ? "true" : undefined}
                      onClick={() => pick(day)}
                    >
                      {dateOf(day).getUTCDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
