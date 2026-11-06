import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { DAYS_PER_WEEK } from "../../activity-calendar.js";
import { cn } from "../../cn.js";
import { BackIcon, ForwardIcon } from "../../face/glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import {
  CALENDAR,
  CALENDAR_CAPTION,
  CALENDAR_CAPTION_LABEL,
  CALENDAR_DAY,
  CALENDAR_DAY_BUTTON,
  CALENDAR_DAY_FACE,
  CALENDAR_DAY_INK,
  CALENDAR_MONTH_GRID,
  CALENDAR_NAV,
  CALENDAR_PLACE,
  CALENDAR_RANGE,
  CALENDAR_TODAY,
  CALENDAR_WEEKDAY,
  type CalendarPlace,
} from "../../shadcn/calendar.js";
import { ANNOUNCE, useAnnounce } from "../announcer/announcer.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

const WEEKS_SHOWN = 6;

const MONTHS_PER_YEAR = 12;

const LOCALE = "en-US";

const FIRST_DAY = "0001-01-01";
const LAST_DAY = "9999-12-31";

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/u;

const A_SUNDAY = "2026-10-18";

const ARROW_STEPS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -DAYS_PER_WEEK],
  ["ArrowDown", DAYS_PER_WEEK],
]);

const PICK_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayOfDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

function shiftedDay(day: string, count: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + count);
  return dayOfDate(date);
}

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

function onCalendar(day: string): boolean {
  return DAY_SHAPE.test(day) && day >= FIRST_DAY && day <= LAST_DAY;
}

function weekdayOf(day: string): number {
  return dateOf(day).getUTCDay();
}

function spelled(day: string, options: Intl.DateTimeFormatOptions): string {
  return dateOf(day).toLocaleDateString(LOCALE, { ...options, timeZone: "UTC" });
}

interface DrawnWeek {
  readonly row: number;
  readonly days: readonly (string | undefined)[];
}

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

function placeOf(
  day: string,
  start: string | undefined,
  end: string | undefined,
): CalendarPlace | undefined {
  if (start === undefined) return undefined;
  if (end === undefined || end === start) return day === start ? CALENDAR_PLACE.SINGLE : undefined;
  const [low, high] = start < end ? [start, end] : [end, start];
  if (day === low) return CALENDAR_PLACE.START;
  if (day === high) return CALENDAR_PLACE.END;
  return day > low && day < high ? CALENDAR_PLACE.BETWEEN : undefined;
}

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

function restingDay(month: string, start: string | undefined, today: string): string {
  if (start !== undefined && monthOf(start) === month) return start;
  if (monthOf(today) === month) return today;
  return `${month}-01`;
}

function dayInk(place: CalendarPlace | undefined, today: boolean, outside: boolean): string {
  if (place !== undefined && place !== CALENDAR_PLACE.BETWEEN) return CALENDAR_DAY_INK.PICKED;
  if (today) return CALENDAR_DAY_INK.TODAY;
  return outside ? CALENDAR_DAY_INK.OUTSIDE : CALENDAR_DAY_INK.OWN;
}

const WEEKDAYS = Array.from({ length: DAYS_PER_WEEK }, (_, slot) => {
  const day = shiftedDay(A_SUNDAY, slot);
  return {
    day,
    short: spelled(day, { weekday: "short" }).slice(0, 2),
    long: spelled(day, { weekday: "long" }),
  };
});

export function Calendar({
  month,
  today,
  start,
  end,
  onPick,
  onShowMonth,
}: {
  month: string;
  today: string;
  start?: string | undefined;
  end?: string | undefined;
  onPick: (day: string) => void;
  onShowMonth: (month: string) => void;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const grid = useRef<HTMLTableElement>(null);
  const following = useRef<string | undefined>(undefined);
  const [moved, setMoved] = useState<string | undefined>(undefined);
  const focusDay =
    moved !== undefined && monthOf(moved) === month ? moved : restingDay(month, start, today);
  const ranged = start !== undefined && end !== undefined && end !== start;
  const first = `${month}-01`;
  const caption = spelled(first, { month: "long", year: "numeric" });
  useAnnounce(ANNOUNCE.POLITE, caption);

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
    event.preventDefault();
    if (!onCalendar(target)) return;
    following.current = target;
    setMoved(target);
    if (monthOf(target) !== month) onShowMonth(monthOf(target));
  };

  const onBlur = (event: FocusEvent<HTMLTableElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    following.current = undefined;
  };

  return (
    <div className={cn("ui-calendar", CALENDAR)}>
      <div className={cn("ui-calendar-head", CALENDAR_CAPTION)}>
        <span className={cn("ui-calendar-title", CALENDAR_CAPTION_LABEL)} id={titleId}>
          {caption}
        </span>
        <span className={cn("ui-calendar-steps", CALENDAR_NAV)}>
          <Tooltip label="Previous month">
            <IconButton
              icon={<BackIcon />}
              label="Previous month"
              size={BUTTON_SIZE.COMPACT}
              disabled={month <= monthOf(FIRST_DAY)}
              onClick={() => showMonth(-1)}
            />
          </Tooltip>
          <Tooltip label="Next month">
            <IconButton
              icon={<ForwardIcon />}
              label="Next month"
              size={BUTTON_SIZE.COMPACT}
              disabled={month >= monthOf(LAST_DAY)}
              onClick={() => showMonth(1)}
            />
          </Tooltip>
        </span>
      </div>
      <table
        ref={grid}
        className={cn("ui-calendar-grid", CALENDAR_MONTH_GRID)}
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
                className={cn("ui-calendar-weekday", CALENDAR_WEEKDAY)}
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
                const isToday = day === today;
                const outside = monthOf(day) !== month;
                const picked = place !== undefined && place !== CALENDAR_PLACE.BETWEEN;
                return (
                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: inside a grid a cell is a gridcell, which takes aria-selected; the rule reads it as a plain table's cell.
                  <td
                    key={day}
                    className={cn(
                      "ui-calendar-cell",
                      CALENDAR_DAY,
                      place === undefined ? undefined : CALENDAR_RANGE[place],
                    )}
                    aria-selected={place !== undefined}
                    data-place={place}
                  >
                    <button
                      type="button"
                      className={cn(
                        "ui-calendar-day",
                        CALENDAR_DAY_BUTTON,
                        picked ? CALENDAR_DAY_FACE.PICKED : CALENDAR_DAY_FACE.OPEN,
                        dayInk(place, isToday, outside),
                        isToday && CALENDAR_TODAY,
                      )}
                      tabIndex={day === focusDay ? 0 : -1}
                      aria-label={spelled(day, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                      aria-current={isToday ? "date" : undefined}
                      data-day={day}
                      data-outside={outside ? "true" : undefined}
                      onClick={pulseOnPress(() => pick(day))}
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
