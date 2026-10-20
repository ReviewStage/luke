import type { AdminDailyUsage } from "@luke/service/admin/admin-metrics";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { calendarWeeks, DAYS_PER_WEEK, lastWeeks, monthLabels } from "@luke/ui/activity-calendar";
import { formatNumber, formatTooltipDay } from "@luke/ui/admin-format";
import { ChartTooltipFrame } from "@luke/ui/chart";
import { partialDayKey } from "@luke/ui/daily-series";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChartFrame } from "./chart-frame";
import { USAGE_CHART } from "./usage-chart";

/**
 * The floor under a day cell's fill, the retention grid's own: a one-call day
 * beside a busy account's peak would otherwise round to a fill too faint to
 * read as a mark.
 */
const CALENDAR_FILL_FLOOR_PERCENT = 8;

/**
 * A day cell's corner, a quarter of its edge, as a small workspace tile's
 * is: the cell is too small for a radius token, whose smallest would round
 * it into a dot.
 */
const CALENDAR_CELL_RADIUS = "25%";

function calendarCellFill(total: number, maxTotal: number): string {
  const fill = Math.max(CALENDAR_FILL_FLOOR_PERCENT, Math.round((total / maxTotal) * 100));
  return `color-mix(in oklab, var(--luke-color-chart-1) ${fill}%, transparent)`;
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
    day.day === partialDay ? " border border-dashed border-(--luke-color-text-muted)/60" : "";
  return (
    <div
      role="img"
      aria-label={`${formatTooltipDay(day.day, partialDay)} — ${formatNumber(day.calls)} hosted calls`}
      data-calendar-day={day.day}
      className={`outline-offset-2 ${day.calls === 0 ? "bg-(--luke-color-fill-hover)/60" : ""}${provisional}`}
      style={{
        borderRadius: CALENDAR_CELL_RADIUS,
        backgroundColor: day.calls === 0 ? undefined : calendarCellFill(day.calls, maxTotal),
      }}
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
function calendarWeeksThatFit(availableWidth: number): number {
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
 * its edges. The weekday and month labels are captions, as the other
 * charts' axis ticks are.
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
    <ChartFrame
      ref={cardRef}
      title={`This account's ${spanLabel}, week by week`}
      overlay={
        anchor !== undefined ? (
          <div ref={tooltipRef} className="pointer-events-none absolute z-10">
            <ChartTooltipFrame
              label={formatTooltipDay(anchor.day.day, partialDay)}
              rows={[
                {
                  key: "calls",
                  color: USAGE_CHART.calls.color,
                  name: USAGE_CHART.calls.label,
                  value: formatNumber(anchor.day.calls),
                },
              ]}
            />
          </div>
        ) : null
      }
      legend="Each cell is one UTC day, whatever the window. A deeper fill is more hosted calls against the busiest day shown, and the dashed cell is today, still filling."
    >
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
              <div key={label} className="self-center">
                <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {label}
                </Text>
              </div>
            ))}
            {weeks.map((week, weekIndex) => (
              <Fragment key={week.weekStart}>
                <div className="whitespace-nowrap">
                  <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                    {months[weekIndex]}
                  </Text>
                </div>
                {week.days.map((day, slot) =>
                  day === undefined ? (
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
    </ChartFrame>
  );
}
