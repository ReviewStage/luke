import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AdminDailyUsage } from "../../../server/admin/admin-metrics";
import { calendarWeeks, DAYS_PER_WEEK, lastWeeks, monthLabels } from "../../activity-calendar";
import { partialDayKey } from "../../daily-series";
import { formatNumber, formatTooltipDay } from "../format";
import { USAGE_CHART } from "./usage-chart";

/**
 * The floor under a day cell's fill, the retention grid's own: a one-call day
 * beside a busy account's peak would otherwise round to a fill too faint to
 * read as a mark.
 */
const CALENDAR_FILL_FLOOR_PERCENT = 8;

function calendarCellStyle(total: number, maxTotal: number): React.CSSProperties {
  const fill = Math.max(CALENDAR_FILL_FLOOR_PERCENT, Math.round((total / maxTotal) * 100));
  return { backgroundColor: `color-mix(in oklab, var(--chart-1) ${fill}%, transparent)` };
}

/** Sunday first, the calendar's own week convention (`activity-calendar.ts`). */
const CALENDAR_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function CalendarDayCell({
  day,
  maxTotal,
  partialDay,
  onShow,
  onHide,
}: {
  day: AdminDailyUsage;
  maxTotal: number;
  partialDay: string | undefined;
  onShow: (day: AdminDailyUsage, cell: HTMLElement) => void;
  onHide: () => void;
}): React.JSX.Element {
  const provisional =
    day.day === partialDay ? " border border-dashed border-muted-foreground/60" : "";
  return (
    <div
      role="img"
      aria-label={`${formatTooltipDay(day.day, partialDay)} — ${formatNumber(day.calls)} hosted calls`}
      data-calendar-day={day.day}
      className={`rounded-[3px] outline-offset-2 ${day.calls === 0 ? "bg-muted/60" : ""}${provisional}`}
      style={day.calls === 0 ? undefined : calendarCellStyle(day.calls, maxTotal)}
      onPointerEnter={(event) => onShow(day, event.currentTarget)}
      onPointerLeave={(event) => {
        // A move straight onto a sibling cell fires that cell's enter next,
        // which slides the shared tooltip over; clearing first would blink it.
        if (
          event.relatedTarget instanceof HTMLElement &&
          event.relatedTarget.dataset.calendarDay !== undefined
        ) {
          return;
        }
        onHide();
      }}
    />
  );
}

/** The clearance between a day cell and the tooltip riding above or below it. */
const CALENDAR_TOOLTIP_GAP_PX = 6;

/**
 * The calendar's one cell size, at every viewport. 12px with a 3px gap keeps
 * the original 1rem-cell, 4px-gap proportion while letting the full 53-week
 * trailing year fit the desktop card beside the expanded sidebar; a narrower
 * surface shows fewer weeks rather than smaller cells.
 */
const CALENDAR_CELL_PX = 12;

const CALENDAR_GAP_PX = 3;

/** The weekday-label column's fixed width, which is what makes the fit exact. */
const CALENDAR_WEEKDAY_COLUMN_PX = 28;

/** How many whole week columns fit beside the weekday labels, one at least. */
export function calendarWeeksThatFit(availableWidth: number): number {
  return Math.max(
    1,
    Math.floor(
      (availableWidth - CALENDAR_WEEKDAY_COLUMN_PX) / (CALENDAR_CELL_PX + CALENDAR_GAP_PX),
    ),
  );
}

interface CalendarTooltipAnchor {
  day: AdminDailyUsage;
  /** The cell's edges in the card's own coordinates, where the tooltip lives. */
  centerX: number;
  top: number;
  bottom: number;
}

/**
 * The account's trailing year — the server's own calendar series, apart from
 * the window the bars above are read at — folded into an intensity calendar:
 * columns are UTC weeks keyed by their Sunday (this calendar's own
 * convention; the retention grid stays Monday-keyed), rows the seven
 * weekdays Sunday to Saturday, and each cell's fill is that day's share of
 * the busiest day shown. The bars carry magnitude; this
 * grid carries the pattern they hide — weekday rhythms, weekend gaps, a
 * streak breaking. The cells keep one fixed, readable size at every
 * viewport; what flexes is how many trailing weeks are shown — the last N
 * whole columns the card's measured width can hold, the full year on a
 * desktop and a few months on a phone, refit live as the window resizes, so
 * nothing scrolls and no partial column is cut. The heading, the month
 * labels, and the fill scale all describe the shown span alone: a deeper
 * fill is that day's share of the busiest day visible, not of a busiest day
 * a narrow surface may have cropped away. A day the span does not cover
 * draws nothing, a covered day with no calls keeps the faintest neutral
 * fill so absence still reads as an observed day, and today — always in the
 * last column, since the slice keeps the newest weeks — wears the retention
 * grid's dashed border, because a fade here would pose as a quiet day. A
 * hovered or focused cell answers at once with the charts' own tooltip —
 * one element the whole grid shares, anchored to the card and clamped to
 * its edges.
 */
export function ActivityCalendar({
  daily,
  generatedAt,
}: {
  daily: readonly AdminDailyUsage[];
  generatedAt: number;
}): React.JSX.Element {
  const allWeeks = calendarWeeks(daily);
  // Undefined until the pre-paint measure below lands, so the first frame
  // never paints a grid at a guessed width.
  const [fitCount, setFitCount] = useState<number | undefined>(undefined);
  const gridAreaRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const area = gridAreaRef.current;
    if (area === null) return;
    const refit = () => setFitCount(calendarWeeksThatFit(area.clientWidth));
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const weeks = fitCount === undefined ? [] : lastWeeks(allWeeks, fitCount);
  // Labels are set on the whole year and sliced with the weeks, so a column
  // is labeled only where a month opens inside the visible span: openings sit
  // four or more columns apart, which is what keeps labels from ever
  // colliding, where labeling a slice's mid-month first column would put two
  // labels one column apart.
  const months = monthLabels(allWeeks).slice(allWeeks.length - weeks.length);
  const partialDay = partialDayKey(daily, generatedAt);
  const shownDays = weeks.flatMap((week) => week.days.filter((day) => day !== undefined));
  const maxTotal = Math.max(...shownDays.map((day) => day.calls), 0);
  const spanLabel =
    weeks.length === allWeeks.length
      ? "trailing year"
      : `last ${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}`;
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<CalendarTooltipAnchor | undefined>(undefined);
  const showTooltip = useCallback((day: AdminDailyUsage, cell: HTMLElement) => {
    const card = cardRef.current;
    if (card === null) return;
    const cellRect = cell.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    setAnchor({
      day,
      centerX: cellRect.left + cellRect.width / 2 - cardRect.left,
      top: cellRect.top - cardRect.top,
      bottom: cellRect.bottom - cardRect.top,
    });
  }, []);
  const hideTooltip = useCallback(() => setAnchor(undefined), []);
  // The tooltip's own size is what the clamp needs, so the placement waits
  // for the render that gives it one, still before the frame paints.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const tooltip = tooltipRef.current;
    if (anchor === undefined || card === null || tooltip === null) return;
    const left = Math.min(
      Math.max(anchor.centerX - tooltip.offsetWidth / 2, 0),
      card.clientWidth - tooltip.offsetWidth,
    );
    const above = anchor.top - tooltip.offsetHeight - CALENDAR_TOOLTIP_GAP_PX;
    const top = above >= 0 ? above : anchor.bottom + CALENDAR_TOOLTIP_GAP_PX;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }, [anchor]);
  return (
    <div ref={cardRef} className="relative rounded-lg border border-border bg-card p-5">
      <div className="mb-4 text-xs text-muted-foreground">
        This account's {spanLabel}, week by week
      </div>
      <div ref={gridAreaRef}>
        {weeks.length === 0 ? null : (
          <div
            className="grid tabular-nums"
            style={{
              gap: CALENDAR_GAP_PX,
              gridAutoFlow: "column",
              gridTemplateColumns: `${CALENDAR_WEEKDAY_COLUMN_PX}px repeat(${weeks.length}, ${CALENDAR_CELL_PX}px)`,
              gridTemplateRows: `auto repeat(${DAYS_PER_WEEK}, ${CALENDAR_CELL_PX}px)`,
            }}
          >
            <div aria-hidden="true" />
            {CALENDAR_WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="self-center font-mono text-[10px] leading-none text-muted-foreground uppercase"
              >
                {label}
              </div>
            ))}
            {weeks.map((week, weekIndex) => (
              <Fragment key={week.weekStart}>
                <div className="font-mono text-[10px] leading-4 whitespace-nowrap text-muted-foreground uppercase">
                  {months[weekIndex]}
                </div>
                {week.days.map((day, slot) =>
                  day === undefined ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: an empty slot has no identity beyond its weekday position.
                    <div key={slot} aria-hidden="true" />
                  ) : (
                    <CalendarDayCell
                      key={day.day}
                      day={day}
                      maxTotal={maxTotal}
                      partialDay={partialDay}
                      onShow={showTooltip}
                      onHide={hideTooltip}
                    />
                  ),
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <p className="mt-4 mb-0 text-xs text-muted-foreground">
        Each cell is one UTC day across the weeks shown, whatever window is chosen above — a deeper
        fill is more hosted calls against the busiest day shown, and the dashed cell is today, still
        filling.
      </p>
      {anchor !== undefined ? (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-card px-2.5 py-1.5 text-xs shadow-xl"
        >
          <div className="font-medium">{formatTooltipDay(anchor.day.day, partialDay)}</div>
          <div className="flex w-full items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: USAGE_CHART.calls.color }}
            />
            <div className="flex flex-1 items-center justify-between gap-4 leading-none">
              <span className="text-muted-foreground">{USAGE_CHART.calls.label}</span>
              <span className="font-mono font-medium text-foreground tabular-nums">
                {formatNumber(anchor.day.calls)}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
