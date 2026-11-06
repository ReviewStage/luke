import type { AdminDailyCount } from "@repo/features/admin-answer-wire";
import { formatCount } from "@repo/features/number-format";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import { calendarWeeks, DAYS_PER_WEEK, lastWeeks, monthLabels } from "@repo/ui/activity-calendar";
import { formatTooltipDay } from "@repo/ui/admin-format";
import { ChartTooltipFrame } from "@repo/ui/chart";
import { partialDayKey } from "@repo/ui/daily-series";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChartFrame, ChartFrameSkeleton } from "./chart-frame.js";
import { USAGE_CHART } from "./usage-chart.js";

export const CALENDAR_MEASURE = {
  ACTIONS: {
    label: "Meaningful actions",
    noun: "meaningful actions",
    color: "var(--ui-color-chart-1)",
  },
  HOSTED_CALLS: {
    label: USAGE_CHART.calls.label,
    noun: "hosted calls",
    color: USAGE_CHART.calls.color,
  },
} as const;

type CalendarMeasure = (typeof CALENDAR_MEASURE)[keyof typeof CALENDAR_MEASURE];

const CALENDAR_FILL_FLOOR_PERCENT = 8;

const CALENDAR_CELL_RADIUS = "25%";

function calendarCellFill(total: number, maxTotal: number, color: string): string {
  const fill = Math.max(CALENDAR_FILL_FLOOR_PERCENT, Math.round((total / maxTotal) * 100));
  return `color-mix(in oklab, ${color} ${fill}%, transparent)`;
}

const CALENDAR_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function CalendarDayCell({
  day,
  maxTotal,
  measure,
  partialDay,
  onShow,
  onHide,
}: {
  day: AdminDailyCount;
  maxTotal: number;
  measure: CalendarMeasure;
  partialDay: string | undefined;
  onShow: (day: AdminDailyCount, cell: HTMLElement) => void;
  onHide: () => void;
}): React.JSX.Element {
  const provisional =
    day.day === partialDay ? " border border-dashed border-(--ui-color-text-muted)/60" : "";
  return (
    <div
      role="img"
      aria-label={`${formatTooltipDay(day.day, partialDay)} — ${formatCount(day.count)} ${measure.noun}`}
      data-calendar-day={day.day}
      className={`outline-offset-2 ${day.count === 0 ? "bg-(--ui-color-fill-hover)/60" : ""}${provisional}`}
      style={{
        borderRadius: CALENDAR_CELL_RADIUS,
        backgroundColor:
          day.count === 0 ? undefined : calendarCellFill(day.count, maxTotal, measure.color),
      }}
      onPointerEnter={(event) => onShow(day, event.currentTarget)}
      onPointerLeave={(event) => {
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

const CALENDAR_TOOLTIP_GAP_PX = 6;

const CALENDAR_CELL_PX = 12;

const CALENDAR_GAP_PX = 3;

const CALENDAR_GRID_HEIGHT = `calc(var(--ui-type-caption-leading) + ${DAYS_PER_WEEK * (CALENDAR_CELL_PX + CALENDAR_GAP_PX)}px)`;

function calendarLegend(measure: CalendarMeasure): string {
  return `Each cell is one UTC day, whatever the window. A deeper fill is more ${measure.noun} against the busiest day shown, and the dashed cell is today, still filling.`;
}

const CALENDAR_WEEKDAY_COLUMN_PX = 28;

function calendarWeeksThatFit(availableWidth: number): number {
  return Math.max(
    1,
    Math.floor(
      (availableWidth - CALENDAR_WEEKDAY_COLUMN_PX) / (CALENDAR_CELL_PX + CALENDAR_GAP_PX),
    ),
  );
}

interface CalendarTooltipAnchor {
  day: AdminDailyCount;
  centerX: number;
  top: number;
  bottom: number;
}

export function ActivityCalendar({
  daily,
  measure,
  generatedAt,
}: {
  daily: readonly AdminDailyCount[];
  measure: CalendarMeasure;
  generatedAt: number;
}): React.JSX.Element {
  const allWeeks = calendarWeeks(daily);
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
  const months = monthLabels(allWeeks).slice(allWeeks.length - weeks.length);
  const partialDay = partialDayKey(daily, generatedAt);
  const shownDays = weeks.flatMap((week) => week.days.filter((day) => day !== undefined));
  const maxTotal = Math.max(...shownDays.map((day) => day.count), 0);
  const spanLabel =
    weeks.length === allWeeks.length
      ? "trailing year"
      : `last ${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}`;
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<CalendarTooltipAnchor | undefined>(undefined);
  const showTooltip = useCallback((day: AdminDailyCount, cell: HTMLElement) => {
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
      title={`This account's ${measure.noun}, ${spanLabel}, week by week`}
      overlay={
        anchor !== undefined ? (
          <div ref={tooltipRef} className="pointer-events-none absolute z-tooltip">
            <ChartTooltipFrame
              label={formatTooltipDay(anchor.day.day, partialDay)}
              rows={[
                {
                  key: measure.noun,
                  color: measure.color,
                  name: measure.label,
                  value: formatCount(anchor.day.count),
                },
              ]}
            />
          </div>
        ) : null
      }
      legend={calendarLegend(measure)}
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
                      measure={measure}
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

export function ActivityCalendarSkeleton({
  measure,
}: {
  measure: CalendarMeasure;
}): React.JSX.Element {
  return <ChartFrameSkeleton legend={calendarLegend(measure)} plot={CALENDAR_GRID_HEIGHT} />;
}
