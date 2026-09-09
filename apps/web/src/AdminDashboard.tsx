import type { FaceMotion } from "@sidecar/surface";
import { createAuthClient } from "better-auth/react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import type { AdminDayAccount, AdminDayDetail } from "../server/admin/admin-day";
import type {
  AdminDailySignups,
  AdminDailyUsage,
  AdminIntegration,
  AdminMetrics,
  AdminRetentionCell,
  AdminTrend,
} from "../server/admin/admin-metrics";
import type { AdminUserAccount, AdminUserDetail } from "../server/admin/admin-user";
import type { AdminUserList, AdminUserListRow } from "../server/admin/admin-users";
import {
  ADMIN_DAY_PARAM,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  ADMIN_USERS_SEARCH_PARAM,
  type AdminMetricsWindow,
  isUtcDayKey,
} from "../server/admin/http";
import { accountInitials, accountLabel } from "./account-initials";
import { GitHubMark, GoogleMark } from "./account-marks";
import { calendarWeeks, DAYS_PER_WEEK, lastWeeks, monthLabels } from "./activity-calendar";
import {
  ACCOUNTS_SORT_KEY,
  type AccountsDetailColumn,
  type AccountsSort,
  type AccountsSortKey,
  type AccountsTableRow,
  nextSort,
  SORT_DIRECTION,
  sortAccountsRows,
} from "./admin/accounts-table/sort";
import { ACCOUNTS_SORT, ADMINS_HIDDEN, SIDEBAR_COLLAPSED, SIGN_IN_CHOSEN } from "./admin/prefs";
import {
  SKELETON_PLOT,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonBody,
  type SkeletonShape,
} from "./admin/skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "./admin/use-admin-read";
import {
  ANIMATION_ROSTER,
  ANIMATION_SWATCH,
  ANIMATION_VARIANT,
  type AnimationEntry,
  type AnimationVariant,
  formatCycleSeconds,
  indexAnimationAssets,
} from "./admin-animations";
import {
  SIDEBAR_ICON_SLOT,
  SIDEBAR_PILL_INSET,
  SIDEBAR_WIDTH,
  sidebarPillWidth,
  sidebarRailWidth,
  sidebarToggleLabel,
} from "./admin-sidebar";
import { AUTH_BUTTON } from "./auth-surface";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./components/ui/chart";
import { partialDayKey, seriesHasNoData } from "./daily-series";
import { LukeMark } from "./SiteChrome";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";

const authClient = createAuthClient();

const METRICS_PATH = "/api/admin/metrics";
const USER_DETAIL_PATH = "/api/admin/user";
const USERS_PATH = "/api/admin/users";
const FAVORITE_PATH = "/api/admin/favorite";
const DAY_DETAIL_PATH = "/api/admin/day";

/**
 * The page's own addresses, distinct from the API's parameters so a pasted
 * dashboard link and an API call never read as each other. Both ride the
 * query string because the page is served at `/admin` alone — a path segment
 * would need its own route — and the account id goes back into the detail
 * endpoint's gate, never into anything rendered.
 */
const ACCOUNT_VIEW_PARAM = "user";
const DAY_VIEW_PARAM = "day";
const TAB_PARAM = "view";
const USERS_TAB_VALUE = "users";
const ANIMATIONS_TAB_VALUE = "animations";
const WINDOW_VIEW_PARAM = "days";
const SEARCH_VIEW_PARAM = "q";

/**
 * Long enough that a typed word coalesces into one roster read, short enough
 * that the searched answer still feels like the box's own.
 */
const SEARCH_DEBOUNCE_MS = 250;

/** The sidebar's three destinations; an open account highlights Users. */
type AdminTab = "dashboard" | "users" | "animations";

/** Which of the page's views the address bar names. */
type AdminView =
  | { kind: "dashboard" }
  | { kind: "users" }
  | { kind: "animations" }
  | { kind: "account"; id: string }
  | { kind: "day"; day: string };

function viewFromLocation(): AdminView {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(ACCOUNT_VIEW_PARAM);
  if (id) return { kind: "account", id };
  // An address naming no real UTC day is the plain dashboard rather than a
  // broken page, the same reading an out-of-set window gets.
  const day = params.get(DAY_VIEW_PARAM);
  if (day !== null && isUtcDayKey(day)) return { kind: "day", day };
  if (params.get(TAB_PARAM) === USERS_TAB_VALUE) return { kind: "users" };
  if (params.get(TAB_PARAM) === ANIMATIONS_TAB_VALUE) return { kind: "animations" };
  return { kind: "dashboard" };
}

/**
 * The window the address bar names, so a 90-day view is shareable and survives
 * a reload. An address naming no window, or one outside the set, is the
 * default view rather than a broken page — a link is the reader's, not a
 * request the API gets to refuse.
 */
function windowFromLocation(): AdminMetricsWindow {
  const value = new URLSearchParams(window.location.search).get(WINDOW_VIEW_PARAM);
  return (
    Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value) ??
    ADMIN_METRICS_WINDOW_DEFAULT
  );
}

/**
 * The search the address bar names, so a searched roster is shareable and
 * survives a reload. An address naming a term past the API's length bound is
 * clipped to it rather than refused — a link is the reader's — and matches
 * the bound the input below enforces on typing.
 */
function searchFromLocation(): string {
  const value = new URLSearchParams(window.location.search).get(SEARCH_VIEW_PARAM) ?? "";
  return value.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
}

/**
 * The current address with the search set or cleared. Typing rewrites the
 * entry in place rather than pushing one, so the back button walks views,
 * not keystrokes.
 */
function searchHref(query: string): string {
  const params = new URLSearchParams(window.location.search);
  if (query) params.set(SEARCH_VIEW_PARAM, query);
  else params.delete(SEARCH_VIEW_PARAM);
  const queryString = params.toString();
  return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
}

/** The term a typed query asks the service to search for: none when blank. */
function searchTerm(query: string): string | undefined {
  const term = query.trim();
  return term.length === 0 ? undefined : term;
}

/**
 * A page address from its own params, carrying the window the address bar
 * currently names, so navigating between views keeps the chosen window. The
 * default window rides as no param at all, keeping the plain addresses plain.
 */
function hrefWithWindow(params: URLSearchParams): string {
  const windowDays = windowFromLocation();
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(WINDOW_VIEW_PARAM, String(windowDays));
  }
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

function accountHref(id: string): string {
  const params = new URLSearchParams();
  params.set(ACCOUNT_VIEW_PARAM, id);
  return hrefWithWindow(params);
}

function dayHref(day: string): string {
  const params = new URLSearchParams();
  params.set(DAY_VIEW_PARAM, day);
  return hrefWithWindow(params);
}

function tabHref(tab: AdminTab): string {
  const params = new URLSearchParams();
  if (tab === "users") params.set(TAB_PARAM, USERS_TAB_VALUE);
  if (tab === "animations") params.set(TAB_PARAM, ANIMATIONS_TAB_VALUE);
  return hrefWithWindow(params);
}

function windowHref(windowDays: AdminMetricsWindow): string {
  const params = new URLSearchParams(window.location.search);
  if (windowDays === ADMIN_METRICS_WINDOW_DEFAULT) params.delete(WINDOW_VIEW_PARAM);
  else params.set(WINDOW_VIEW_PARAM, String(windowDays));
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

/**
 * Whether a click on a link is asking this page to navigate, or asking the
 * browser for its own gesture — a new tab, a window, a download — which the
 * real anchor underneath must keep answering.
 */
function plainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The signed-in account the header names; read from the session, shown as-is. */
interface ViewerAccount {
  name: string;
  email: string;
  image: string | undefined;
}

/** The page's one button treatment: sign out and try again both wear it. */
const PLAIN_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-card";

/** What each endpoint says when it refuses for no reason of the gate's own. */
const ENDPOINT_ERROR = {
  METRICS: "The metrics endpoint did not answer. Try again shortly.",
  USERS: "The users endpoint did not answer. Try again shortly.",
  ACCOUNT: "The account endpoint did not answer. Try again shortly.",
  DAY: "The day endpoint did not answer. Try again shortly.",
} as const;

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** An instant drawn as its UTC date alone, e.g. "Aug 3, 2026". */
function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

/** A day key drawn as a short axis tick, e.g. "Aug 21". */
function formatDayTick(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A day key drawn as the day page's own masthead, e.g. "August 21, 2026". */
function formatDayHeading(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

/**
 * How faded today's bar draws. The series' last day is still filling, so a
 * bar rendered like a complete day's always reads as a dip; the fade and the
 * tooltip's "(so far today)" say the day is partial instead.
 */
const PARTIAL_DAY_OPACITY = 0.45;

/** A tooltip label for one bar's day, saying so when that day is still filling. */
function formatTooltipDay(day: string, partialDay: string | undefined): string {
  return day === partialDay ? `${formatDayTick(day)} (so far today)` : formatDayTick(day);
}

const TREND_TONE = {
  UP: "text-complete",
  DOWN: "text-attention",
  FLAT: "text-muted-foreground",
} as const;

function trendTone(trend: AdminTrend): string {
  if (trend.recent > trend.prior) return TREND_TONE.UP;
  if (trend.recent < trend.prior) return TREND_TONE.DOWN;
  return TREND_TONE.FLAT;
}

/**
 * How the run moved against the one before it, as a percentage where there is
 * one to state. A prior run of zero has none — every rise from nothing is
 * infinite — so the move stands as its own count rather than a figure that
 * reads as precision it does not have.
 */
function formatTrendMove(trend: AdminTrend): string {
  const delta = trend.recent - trend.prior;
  if (delta === 0) return "flat";
  const sign = delta > 0 ? "+" : "−";
  if (trend.prior === 0) return `${sign}${formatNumber(Math.abs(delta))}`;
  return `${sign}${Math.abs(Math.round((delta / trend.prior) * 100))}%`;
}

function StatCard({
  label,
  value,
  hint,
  title,
  grouped = false,
}: {
  label: string;
  value: string;
  hint?: string;
  title?: string;
  grouped?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={
        grouped ? "min-w-0 bg-card px-5 py-4" : "rounded-lg border border-border bg-card px-5 py-4"
      }
      title={title}
    >
      <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Related headline metrics share one surface, leaving charts as the dominant objects. */
function StatGroup({
  columns,
  children,
}: {
  columns: 2 | 3;
  children: React.ReactNode;
}): React.JSX.Element {
  const layout =
    columns === 3
      ? "divide-y min-[720px]:grid-cols-3 min-[720px]:divide-x min-[720px]:divide-y-0"
      : "divide-y min-[520px]:grid-cols-2 min-[520px]:divide-x min-[520px]:divide-y-0";
  return (
    <div
      className={`grid divide-border overflow-hidden rounded-lg border border-border bg-card ${layout}`}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="mt-12 mb-4 text-lg font-semibold tracking-[-0.01em]">{children}</h2>;
}

/**
 * A chart's own heading: what it draws on the left, and how its trailing run
 * moved against the run before it on the right. The comparison sits with the
 * bars rather than on a card of its own, because it is read as a caption on
 * the shape above it.
 */
function ChartHeading({ label, trend }: { label: string; trend: AdminTrend }): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`font-medium tabular-nums ${trendTone(trend)}`}>
          {formatTrendMove(trend)}
        </span>
        <span className="text-muted-foreground">
          {formatNumber(trend.recent)} in the last {trend.days} days, against{" "}
          {formatNumber(trend.prior)} before
        </span>
      </span>
    </div>
  );
}

const USAGE_CHART = {
  calls: { label: "Hosted calls", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * A trailing-window bar chart on shadcn/ui's chart primitives. One series, so
 * the heading names it and no legend box restates the heading; the tooltip
 * carries each day's exact count. A window with no calls at all says so
 * instead of drawing the server's zero-fill as a flat measurement, and
 * today's bar wears the partial-day fade. Where a day has a roster to open, a
 * click anywhere in a day's column opens it — read from the chart's own axis
 * datum, so the bar and the hover band around it land on the same day — and
 * the pointer says so; one account's chart passes no opener, because its day
 * needs no roster.
 */
function UsageChart({
  daily,
  trend,
  label,
  generatedAt,
  onOpenDay,
}: {
  daily: readonly AdminDailyUsage[];
  trend: AdminTrend;
  label: string;
  generatedAt: number;
  onOpenDay?: (day: string) => void;
}): React.JSX.Element {
  if (seriesHasNoData(daily.map((point) => point.calls))) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartHeading label={label} trend={trend} />
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          No hosted-tier calls recorded in this window yet.
        </p>
      </div>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <ChartHeading label={label} trend={trend} />
      <ChartContainer
        config={USAGE_CHART}
        className={`aspect-auto h-48 w-full ${onOpenDay ? "cursor-pointer" : ""}`}
      >
        <BarChart
          data={[...daily]}
          // The clicked label is resolved against the drawn series itself, so
          // only a day these bars actually state can open.
          onClick={
            onOpenDay
              ? ({ activeLabel }) => {
                  const clicked = daily.find((point) => point.day === activeLabel);
                  if (clicked) onOpenDay(clicked.day);
                }
              : undefined
          }
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDayTick}
          />
          <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
              />
            }
          />
          <Bar dataKey="calls" fill="var(--color-calls)" radius={[4, 4, 0, 0]}>
            {daily.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

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
 * its edges.
 */
function ActivityCalendar({
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

const SIGNUPS_CHART = {
  count: { label: "New accounts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * One series, so the heading names it and no legend box restates the heading.
 * A window with no signups says so instead of drawing the server's zero-fill
 * as a flat measurement, and today's bar wears the partial-day fade.
 */
function SignupsChart({
  daily,
  trend,
  generatedAt,
}: {
  daily: readonly AdminDailySignups[];
  trend: AdminTrend;
  generatedAt: number;
}): React.JSX.Element {
  if (seriesHasNoData(daily.map((point) => point.count))) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartHeading label="New accounts per day" trend={trend} />
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          No accounts created in this window yet.
        </p>
      </div>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <ChartHeading label="New accounts per day" trend={trend} />
      <ChartContainer config={SIGNUPS_CHART} className="aspect-auto h-40 w-full">
        <BarChart data={[...daily]}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDayTick}
          />
          <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
              />
            }
          />
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]}>
            {daily.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

const SIGN_IN_METHODS_CHART = {
  accounts: { label: "Accounts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * How the accounts sign in, as horizontal bars. One measure across nominal
 * categories, so every bar wears the first slot's hue and the end labels
 * carry the exact count and its share of all accounts — shares that can sum
 * past 100%, since an account may link more than one method, which is why
 * each label says "of accounts" instead of posing as a slice of the bars. A
 * method nobody has linked draws no bar at all: a zero-length bar parks its
 * end label at the plot origin, where two empty methods would stack their
 * labels over the category axis.
 */
function SignInMethodsChart({
  methods,
  totalAccounts,
}: {
  methods: AdminMetrics["users"]["signInMethods"];
  totalAccounts: number;
}): React.JSX.Element {
  const rows = [
    { method: "GitHub", accounts: methods.github },
    { method: "Google", accounts: methods.google },
    { method: "Other", accounts: methods.other },
  ]
    .filter((row) => row.accounts > 0)
    .map((row) => ({
      ...row,
      label: `${formatNumber(row.accounts)} · ${Math.round(
        (row.accounts / totalAccounts) * 100,
      )}% of accounts`,
    }));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 text-xs text-muted-foreground">Linked sign-in methods</div>
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          No linked sign-in methods recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 text-xs text-muted-foreground">Linked sign-in methods</div>
      <ChartContainer
        config={SIGN_IN_METHODS_CHART}
        className="aspect-auto w-full"
        style={{ height: rows.length * 40 }}
      >
        <BarChart data={rows} layout="vertical" margin={{ right: 160 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="method" type="category" tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="accounts" fill="var(--color-accounts)" radius={4} barSize={18}>
            <LabelList
              dataKey="label"
              position="right"
              offset={8}
              className="fill-muted-foreground"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

/**
 * The floor under a cell's fill, so a small nonzero share still reads as a
 * mark against the card instead of vanishing into it.
 */
const RETENTION_FILL_FLOOR_PERCENT = 8;

/**
 * The share past which a cell's fill is strong enough that the page's light
 * foreground stops clearing it, so the text flips to the dark background tone.
 */
const RETENTION_TEXT_FLIP_SHARE = 0.75;

function retentionCellStyle(share: number): React.CSSProperties {
  const fill = Math.max(RETENTION_FILL_FLOOR_PERCENT, Math.round(share * 100));
  return {
    backgroundColor: `color-mix(in oklab, var(--chart-1) ${fill}%, transparent)`,
    color: share >= RETENTION_TEXT_FLIP_SHARE ? "var(--background)" : "var(--foreground)",
  };
}

function RetentionCell({ cell }: { cell: AdminRetentionCell }): React.JSX.Element {
  const provisional = cell.inProgress ? "border border-dashed border-muted-foreground/60" : "";
  if (cell.share === null) {
    return (
      <div
        className={`flex min-h-9 items-center justify-center rounded-sm text-muted-foreground ${provisional}`}
        title="No accounts in this cohort"
      >
        —
      </div>
    );
  }
  const percent = `${Math.round(cell.share * 100)}%`;
  const title = `${formatNumber(cell.activeAccounts)} ${
    cell.activeAccounts === 1 ? "account" : "accounts"
  } active${cell.inProgress ? " so far this week" : ""}`;
  if (cell.share === 0) {
    return (
      <div
        className={`flex min-h-9 items-center justify-center rounded-sm text-muted-foreground ${provisional}`}
        title={title}
      >
        {percent}
      </div>
    );
  }
  return (
    <div
      className={`flex min-h-9 items-center justify-center rounded-sm ${provisional}`}
      style={retentionCellStyle(cell.share)}
      title={title}
    >
      {percent}
    </div>
  );
}

/**
 * Weekly signup cohorts against the weeks after them, as a plain CSS grid
 * rather than a chart: each row is the accounts created in one UTC week, each
 * cell the share of them that used the hosted tier that many weeks after
 * signing up. The grid is triangular because the builder emits no cell for a
 * week the calendar has not reached, and the current week's cells wear a
 * dashed border because their week is still accruing.
 */
function RetentionGrid({ retention }: { retention: AdminMetrics["retention"] }): React.JSX.Element {
  const totalAccounts = retention.cohorts.reduce((total, cohort) => total + cohort.size, 0);
  if (totalAccounts === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No accounts created in the last {retention.weeks} weeks yet.
      </div>
    );
  }

  const offsets = Array.from({ length: retention.weeks }, (_, offset) => offset);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[640px] gap-1 p-5 text-xs tabular-nums"
          style={{
            gridTemplateColumns: `minmax(84px, auto) minmax(72px, auto) repeat(${retention.weeks}, minmax(52px, 1fr))`,
          }}
        >
          <div className="flex items-center font-mono text-muted-foreground uppercase">Cohort</div>
          <div className="flex items-center justify-end font-mono text-muted-foreground uppercase">
            Accounts
          </div>
          {offsets.map((offset) => (
            <div
              key={offset}
              className="flex items-center justify-center font-mono text-muted-foreground uppercase"
            >
              Wk {offset}
            </div>
          ))}
          {retention.cohorts.map((cohort) => (
            <Fragment key={cohort.weekStart}>
              <div className="flex items-center">{formatDayTick(cohort.weekStart)}</div>
              <div className="flex items-center justify-end pr-1 text-muted-foreground">
                {formatNumber(cohort.size)}
              </div>
              {offsets.map((offset) => {
                const cell = cohort.cells[offset];
                return cell ? (
                  <RetentionCell key={offset} cell={cell} />
                ) : (
                  <div key={offset} aria-hidden="true" />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntegrationRow({ integration }: { integration: AdminIntegration }): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm">{integration.label}</span>
      <span
        className="inline-flex items-center gap-2 font-mono text-xs"
        data-tone={integration.configured ? "complete" : "attention"}
      >
        <span
          className="inline-block size-2 rounded-full data-[on=true]:bg-complete data-[on=false]:bg-attention"
          data-on={integration.configured}
          aria-hidden="true"
        />
        <span className={integration.configured ? "text-complete" : "text-attention"}>
          {integration.configured ? "Configured" : "Not configured"}
        </span>
      </span>
    </li>
  );
}

const AVATAR_FRAME = {
  small: "size-8",
  large: "size-14",
} as const;

const AVATAR_TEXT = {
  small: "text-xs",
  large: "text-lg",
} as const;

/**
 * An account's own avatar, falling back to its initials. A provider's avatar
 * URL can outlive the image it named, so a failed fetch falls back to the
 * letters rather than leaving a broken frame. Small is the header's, large is
 * the detail page's masthead.
 */
function AccountAvatar({
  account,
  size = "small",
}: {
  account: ViewerAccount;
  size?: keyof typeof AVATAR_FRAME;
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  if (account.image !== undefined && !imageFailed) {
    return (
      <img
        src={account.image}
        alt=""
        className={`${AVATAR_FRAME[size]} rounded-full object-cover`}
        // Google's avatar host answers 403 to a request carrying a Referer, so
        // without this a Google-signed-in admin falls to initials every time.
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <span
      className={`grid ${AVATAR_FRAME[size]} place-items-center rounded-full bg-muted ${AVATAR_TEXT[size]} font-semibold`}
      aria-hidden="true"
    >
      {accountInitials(account.name, account.email)}
    </span>
  );
}

/**
 * The focus ring is drawn inside the item: the page's own `:focus-visible`
 * outline would otherwise sit astride the panel's border, which reads as a
 * seam rather than as focus.
 */
const ACCOUNT_MENU_ITEM =
  "flex min-h-11 w-full cursor-pointer items-center px-3 py-2 text-left text-sm font-medium transition-colors duration-150 outline-offset-[-2px] hover:bg-muted focus-visible:bg-muted";

function AccountMenu({
  account,
  avatarSkeleton = false,
  onSignOut,
}: {
  account: ViewerAccount;
  avatarSkeleton?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-opacity duration-150 hover:opacity-80"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${accountLabel(account)}`}
        onClick={() => setOpen(!open)}
      >
        {avatarSkeleton ? (
          <Skeleton circle className={AVATAR_FRAME.small} />
        ) : (
          <AccountAvatar account={account} />
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-[calc(100%+8px)] right-0 z-10 min-w-[200px] rounded-lg border border-border bg-card py-1 text-left shadow-[0_16px_48px_rgba(0,0,0,0.32)]"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm leading-tight font-medium">{account.name}</div>
            <div className="truncate text-xs text-muted-foreground">{account.email}</div>
          </div>
          <button
            type="button"
            ref={itemRef}
            role="menuitem"
            className={ACCOUNT_MENU_ITEM}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DashboardIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="5" height="5" rx="1" />
      <rect x="9.25" y="1.75" width="5" height="5" rx="1" />
      <rect x="1.75" y="9.25" width="5" height="5" rx="1" />
      <rect x="9.25" y="9.25" width="5" height="5" rx="1" />
    </svg>
  );
}

function UsersIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5.1" r="2.35" />
      <path d="M1.9 13.4c.6-2.4 2.2-3.7 4.1-3.7s3.5 1.3 4.1 3.7" />
      <path d="M10.6 3a2.35 2.35 0 0 1 0 4.2" />
      <path d="M11.8 10c1.3.5 2 1.6 2.3 3.4" />
    </svg>
  );
}

/** Luke's own face, traced from `FACE_ART` onto the sidebar's 16-unit grid. */
function AnimationsIcon(): React.JSX.Element {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform="rotate(-8 8 8)">
        <path
          d="M 6.5 4.6 V 10.2 Q 6.5 11.4 7.7 11.4 Q 9.6 11.4 12 9.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="4.3" cy="5.25" r="1.05" fill="currentColor" />
        <circle cx="11.5" cy="5.25" r="1.05" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Points at the sidebar's own edge: left to fold it away, right to bring it back. */
function CollapseIcon({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsed ? <path d="M6 3.5 10.5 8 6 12.5" /> : <path d="M10 3.5 5.5 8l4.5 4.5" />}
    </svg>
  );
}

/**
 * The pill's fill is scoped here rather than taken from `--muted`: 5% white is
 * a resting tint for flat surfaces, too faint to read as a state on the
 * lifted card the rail sits on, and raising the shared token would brighten
 * every muted surface on the page.
 */
const SIDEBAR_ITEM = {
  ACTIVE: {
    ROW: "text-foreground",
    PILL: "bg-foreground/10",
  },
  IDLE: {
    ROW: "text-muted-foreground hover:text-foreground focus-visible:text-foreground",
    PILL: "group-hover:bg-foreground/10 group-focus-visible:bg-foreground/10",
  },
} as const;

/**
 * The page's one navigation, wearing the brand the headers used to carry.
 * Each tab is a real anchor to its own address, so a modified click still
 * gets the browser's own gesture. On a phone the rail would eat a fifth of
 * the width for two links, so below the page's breakpoint the same
 * navigation stands as a compact top bar instead — two sibling renders
 * rather than one reshaped tree, because the fold below is the rail's own
 * geometry and never reaches the bar's inline labels.
 *
 * The fold is a single width transition on the outer rail over a fixed-width
 * inner panel it clips: the panel is always laid out at the expanded width, so
 * a label is revealed or hidden by the moving clip edge rather than inserted
 * and removed. Nothing inside the panel re-flows as the rail moves, so the
 * fold neither pops a label in nor wraps one nor shoves an icon. Each row
 * leads with an icon slot exactly the collapsed rail's width, so the icon sits
 * on the rail's centre and the label begins at the rail's edge — past the clip,
 * never a fragment inside it — which is why the rows carry no horizontal
 * padding of their own: any would start the label short of that edge. Collapsed,
 * every item keeps its name on a `title` and the toggle on its `aria-label`;
 * the labels themselves stay in the tree, clipped, so a reader still hears them.
 * The same clip is why hover and the active state are drawn by a pill layer
 * sized against the rail (`sidebarPillWidth`) instead of the row's background:
 * the fixed-width row runs under the clip edge, so its background would be
 * sliced there, expanded flush against the borders and collapsed cut mid-pill.
 */
function AdminSidebar({
  active,
  collapsed,
  onToggle,
  onNavigate,
}: {
  active: AdminTab;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (tab: AdminTab) => void;
}): React.JSX.Element {
  const iconSlot = (icon: React.ReactNode) => (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: SIDEBAR_ICON_SLOT }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );

  const pill = (styling: (typeof SIDEBAR_ITEM)[keyof typeof SIDEBAR_ITEM]) => (
    <span
      aria-hidden="true"
      style={{ left: SIDEBAR_PILL_INSET, width: sidebarPillWidth(collapsed) }}
      className={`absolute inset-y-0 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none ${styling.PILL}`}
    />
  );

  const item = (tab: AdminTab, label: string, icon: React.ReactNode) => {
    const styling = active === tab ? SIDEBAR_ITEM.ACTIVE : SIDEBAR_ITEM.IDLE;
    return (
      <a
        href={tabHref(tab)}
        aria-current={active === tab ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={`group relative flex min-h-11 items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${styling.ROW}`}
        onClick={(event) => {
          if (!plainLeftClick(event)) return;
          event.preventDefault();
          onNavigate(tab);
        }}
      >
        {pill(styling)}
        {iconSlot(icon)}
        <span className="relative min-w-0 whitespace-nowrap">{label}</span>
      </a>
    );
  };

  const barItem = (tab: AdminTab, label: string, icon: React.ReactNode) => {
    const styling = active === tab ? SIDEBAR_ITEM.ACTIVE : SIDEBAR_ITEM.IDLE;
    return (
      <a
        href={tabHref(tab)}
        aria-label={label}
        aria-current={active === tab ? "page" : undefined}
        className={`group relative flex min-h-11 min-w-0 items-center justify-center px-2 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none min-[520px]:px-2.5 ${styling.ROW}`}
        onClick={(event) => {
          if (!plainLeftClick(event)) return;
          event.preventDefault();
          onNavigate(tab);
        }}
      >
        {/* The bar never folds, so the rail's pill needs no width of its own
            here: the same fills simply cover the item. */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full transition-[background-color] duration-150 ${styling.PILL}`}
        />
        <span className="relative flex min-w-0 items-center gap-2.5">
          {icon}
          <span className="hidden truncate min-[520px]:inline">{label}</span>
        </span>
      </a>
    );
  };

  return (
    <>
      <nav
        aria-label="Admin sections"
        className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-1 border-b border-border bg-card px-3 py-2 min-[720px]:hidden"
      >
        <span className="mr-1 inline-flex w-6 shrink-0 text-foreground" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </span>
        {barItem("dashboard", "Dashboard", <DashboardIcon />)}
        {barItem("users", "Users", <UsersIcon />)}
        {barItem("animations", "Animations", <AnimationsIcon />)}
      </nav>
      <nav
        aria-label="Admin sections"
        style={{ width: sidebarRailWidth(collapsed) }}
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-150 ease-out min-[720px]:flex motion-reduce:transition-none"
      >
        <div
          style={{ width: SIDEBAR_WIDTH.EXPANDED }}
          className="flex h-full shrink-0 flex-col py-5"
        >
          <div className="flex items-center pr-3">
            {iconSlot(
              <span className="inline-flex w-6 text-foreground">
                <LukeMark className="h-auto w-full" />
              </span>,
            )}
            <span className="whitespace-nowrap font-brand text-base font-bold tracking-[-0.01em]">
              Luke admin
            </span>
          </div>
          <div className="mt-8 grid gap-1">
            {item("dashboard", "Dashboard", <DashboardIcon />)}
            {item("users", "Users", <UsersIcon />)}
            {item("animations", "Animations", <AnimationsIcon />)}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            aria-label={sidebarToggleLabel(collapsed)}
            className={`group relative flex min-h-11 cursor-pointer items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${SIDEBAR_ITEM.IDLE.ROW}`}
            onClick={onToggle}
          >
            {pill(SIDEBAR_ITEM.IDLE)}
            {iconSlot(<CollapseIcon collapsed={collapsed} />)}
            <span className="relative whitespace-nowrap">Collapse</span>
          </button>
        </div>
      </nav>
    </>
  );
}

/** The heading and account menu every view wears; controls sit between them. */
function PageHeader({
  title,
  controls,
  account,
  accountSkeleton = false,
  onSignOut,
}: {
  title: string;
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  accountSkeleton?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const hasControls = controls !== null && controls !== undefined;

  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-4 min-[720px]:flex min-[720px]:gap-x-6 min-[720px]:gap-y-3">
      {/* On a phone the identity is one row and the controls are a deliberate
          second row. This keeps the account trigger from becoming a stray
          button after whichever control happened to wrap first. */}
      <h1 className="col-start-1 row-start-1 text-lg font-semibold tracking-[-0.01em]">{title}</h1>
      {hasControls ? (
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-3 min-[720px]:ml-auto min-[720px]:gap-4">
          {controls}
        </div>
      ) : null}
      {accountSkeleton || account ? (
        <div
          className={`col-start-2 row-start-1 flex items-center ${hasControls ? "" : "min-[720px]:ml-auto"}`}
        >
          {account ? (
            <AccountMenu account={account} avatarSkeleton={accountSkeleton} onSignOut={onSignOut} />
          ) : accountSkeleton ? (
            <div className="flex size-11 items-center justify-center">
              <Skeleton circle className={AVATAR_FRAME.small} />
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

/**
 * The failure a refresh landed on an answer that stays shown: the numbers on
 * screen are still the last ones actually read, and this band says the newer
 * read did not arrive. The
 * status region stands in the page whether or not it has anything to say,
 * because a live region inserted together with its news is announced by
 * nothing; it holds the announcement alone, with the button beside it, so a
 * press flipping the button's label cannot re-announce the failure and the
 * button keeps its own role.
 */
function RefreshFailureNotice({
  failure,
  refreshing,
  onRetry,
}: {
  failure: string | undefined;
  refreshing: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div
      className={
        failure !== undefined
          ? "mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-5 py-3 text-sm"
          : undefined
      }
    >
      <span role="status">
        {failure !== undefined ? (
          <>
            <span className="font-medium text-attention">Refresh failed.</span>{" "}
            <span className="text-muted-foreground">
              Still showing the earlier answer. {failure}
            </span>
          </>
        ) : null}
      </span>
      {failure !== undefined ? (
        <button type="button" className={PLAIN_BUTTON} onClick={onRetry} disabled={refreshing}>
          {refreshing ? "Trying…" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The window every windowed read answers to, as one control of three fixed
 * lengths. The choice lives in the address bar, so the press hands it up
 * rather than keeping state of its own, and flipping it refetches the way the
 * scope toggle does.
 */
function WindowSwitcher({
  value,
  onChange,
}: {
  value: AdminMetricsWindow;
  onChange: (windowDays: AdminMetricsWindow) => void;
}): React.JSX.Element {
  return (
    <div className="inline-flex h-8 rounded-md border border-border bg-card p-0.5">
      {Object.values(ADMIN_METRICS_WINDOW).map((windowDays) => (
        <button
          key={windowDays}
          type="button"
          aria-label={`${windowDays}-day window`}
          aria-pressed={value === windowDays}
          data-active={value === windowDays}
          className="cursor-pointer rounded px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-offset-2 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
          onClick={() => onChange(windowDays)}
        >
          {windowDays}d
        </button>
      ))}
    </div>
  );
}

function HideAdminsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (hide: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Hide admins
    </label>
  );
}

/**
 * The loading stand-in every view wears: the page's own header and controls,
 * drawn for real, over the bones its own sections name. The header is the
 * loaded page's own component, so the two cannot drift apart — which is what
 * four page-shaped copies of it could not promise.
 */
function PageSkeleton({
  title,
  account,
  onSignOut,
  controls,
  loading,
  back,
  shapes,
}: {
  title: string;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  controls: React.ReactNode;
  /** What the visually hidden line says this page is reading. */
  loading: string;
  back?: { tab: AdminTab; label: string; onBack: () => void };
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <main
      className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10"
      aria-busy="true"
    >
      <PageHeader
        title={title}
        account={account}
        accountSkeleton
        onSignOut={onSignOut}
        controls={controls}
      />
      <p className="sr-only">Loading. {loading}</p>
      {back === undefined ? null : (
        <a
          href={tabHref(back.tab)}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={(event) => {
            if (!plainLeftClick(event)) return;
            event.preventDefault();
            back.onBack();
          }}
        >
          <span aria-hidden="true">←</span> {back.label}
        </a>
      )}
      <SkeletonBody shapes={shapes} />
    </main>
  );
}

function RetentionNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Each cell is the share of one UTC week's signups that spent hosted voice or attention that
      many weeks after signup — Wk 0 is activation in the signup week itself, and dashed cells are
      still accruing. Purely local use of the desktop app writes no row here, so a cohort that never
      touched the hosted tier reads the same as one that left.
    </p>
  );
}

function TopAccountsNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      An active day is a UTC day the account spent hosted voice or attention — the one per-account
      daily signal the service's own tables hold. A row opens the account's own page.
    </p>
  );
}

function AccountActivityNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      An active day is a UTC day this account spent hosted voice or attention — the one per-account
      daily signal the service's own tables hold. Purely local use of the desktop app writes no row
      here; day-level launch activity is recorded as product-analytics events, which live with the
      analytics processor rather than in this database.
    </p>
  );
}

function RosterNote({
  truncatedTo,
  searched,
}: {
  truncatedTo?: number;
  searched?: boolean;
}): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Every account the service holds, most recently active first, whether or not it ever touched
      the hosted tier — active days count the window's UTC days with hosted voice or attention,
      while last seen is the account's freshest sign-in session, which a plain sign-in moves without
      any hosted use. A heading sorts by its column, a row opens the account's own page, and a row's
      star favorites the account for you alone, following your sign-in rather than this browser.
      {truncatedTo !== undefined
        ? searched
          ? ` Only the ${formatNumber(truncatedTo)} most recently active matching accounts are listed here — narrow the search to reach the rest.`
          : ` Only the ${formatNumber(truncatedTo)} most recently active accounts are listed here — searching reads the whole roster, not just these.`
        : ""}
    </p>
  );
}

/** The dashboard's own sections, in the order the loaded page states them. */
const DASHBOARD_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "User activity" },
  { kind: SKELETON_SHAPE.STAT_GROUP, columns: 3 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.SIGNUPS, SKELETON_PLOT.SIGN_IN_METHODS] },
  { kind: SKELETON_SHAPE.HEADING, label: "Signup retention · weekly cohorts" },
  { kind: SKELETON_SHAPE.RETENTION },
  { kind: SKELETON_SHAPE.STATIC, node: <RetentionNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Feature usage · hosted tier" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 1, columns: 1 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.HEADING, label: "Most active hosted-tier accounts" },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 3 },
  { kind: SKELETON_SHAPE.STATIC, node: <TopAccountsNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Reliability" },
  { kind: SKELETON_SHAPE.STAT_GROUP, columns: 2 },
  { kind: SKELETON_SHAPE.LINES, bones: ["w-full", "w-full", "w-2/5"] },
  { kind: SKELETON_SHAPE.HEADING, label: "System health" },
  { kind: SKELETON_SHAPE.HEALTH },
];

/** The roster's own sections. */
const USERS_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.SEARCH },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 5, starGutter: true },
  { kind: SKELETON_SHAPE.STATIC, node: <RosterNote /> },
];

/** One account's own sections. */
const ACCOUNT_SHAPES: readonly SkeletonShape[] = [
  {
    kind: SKELETON_SHAPE.MASTHEAD,
    avatar: true,
    lines: [
      { box: "h-8", bone: "h-6 w-48" },
      { box: "h-5", bone: "h-3.5 w-56" },
      { box: "h-4", bone: "h-3 w-40" },
    ],
  },
  { kind: SKELETON_SHAPE.HEADING, label: "Daily use · hosted tier" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 4, columns: 4 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.CALENDAR },
  { kind: SKELETON_SHAPE.HEADING, label: "Volume" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 3, columns: 3 },
  { kind: SKELETON_SHAPE.STATIC, node: <AccountActivityNote /> },
];

/** One day's own sections, under the heading the address already names. */
function daySkeletonShapes(day: string): readonly SkeletonShape[] {
  return [
    {
      kind: SKELETON_SHAPE.MASTHEAD,
      title: formatDayHeading(day),
      lines: [{ box: "h-5", bone: "h-3.5 w-56" }],
    },
    { kind: SKELETON_SHAPE.HEADING, label: "Hosted tier · this day" },
    { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
    { kind: SKELETON_SHAPE.HEADING, label: "Accounts active this day" },
    { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 1 },
  ];
}

/** A windowed read's address: the default scope, window, and no search ride as no params. */
function windowedReadPath(
  base: string,
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
  search?: string,
): string {
  const params = new URLSearchParams();
  if (!hideAdmins) params.set(ADMIN_METRICS_SCOPE_PARAM, ADMIN_METRICS_SCOPE.ALL);
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(ADMIN_METRICS_WINDOW_PARAM, String(windowDays));
  }
  if (search !== undefined) params.set(ADMIN_USERS_SEARCH_PARAM, search);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function Dashboard({
  metrics,
  refreshFailure,
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  refreshing,
  onRefresh,
  onOpenAccount,
  onOpenDay,
}: {
  metrics: AdminMetrics;
  refreshFailure: string | undefined;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenAccount: (id: string) => void;
  onOpenDay: (day: string) => void;
}): React.JSX.Element {
  const db = metrics.systemHealth.database;

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader
        title="Dashboard"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
          </>
        }
      />

      <RefreshFailureNotice failure={refreshFailure} refreshing={refreshing} onRetry={onRefresh} />

      {/* A refetch dims the answer already on screen rather than replacing it:
          the numbers below stay the last ones actually read, and the dimming
          says so while the next read is in flight. */}
      <div
        className="transition-opacity duration-150 data-[busy=true]:opacity-50"
        data-busy={refreshing}
        aria-busy={refreshing}
      >
        <SectionHeading>User activity</SectionHeading>
        <StatGroup columns={3}>
          <StatCard label="Total accounts" value={formatNumber(metrics.users.total)} grouped />
          {/* The hint already carries the window total, so the run this count
              is read against rides the title attribute instead. */}
          <StatCard
            label={`New · ${metrics.users.signupTrend.days} days`}
            value={formatNumber(metrics.users.signupTrend.recent)}
            hint={`${formatNumber(metrics.users.newInWindow)} in ${metrics.windowDays} days`}
            title={`against ${formatNumber(metrics.users.signupTrend.prior)} in the ${metrics.users.signupTrend.days} days before`}
            grouped
          />
          <StatCard
            label="Active today"
            value={formatNumber(metrics.featureUsage.activeUsersToday)}
            hint={`${formatNumber(metrics.featureUsage.activeUsersWindow)} accounts in ${metrics.windowDays} days`}
            grouped
          />
        </StatGroup>
        <div className="mt-3 grid gap-3 min-[720px]:grid-cols-[1.6fr_1fr]">
          <SignupsChart
            daily={metrics.users.dailySignups}
            trend={metrics.users.signupTrend}
            generatedAt={metrics.generatedAt}
          />
          <SignInMethodsChart
            methods={metrics.users.signInMethods}
            totalAccounts={metrics.users.total}
          />
        </div>

        <SectionHeading>Signup retention · weekly cohorts</SectionHeading>
        <RetentionGrid retention={metrics.retention} />
        <RetentionNote />

        <SectionHeading>Feature usage · hosted tier</SectionHeading>
        <StatCard
          label="Hosted calls · today"
          value={formatNumber(metrics.featureUsage.callsToday)}
          hint={`${formatNumber(metrics.featureUsage.callsWindow)} in ${metrics.windowDays} days`}
        />
        <div className="mt-3">
          <UsageChart
            daily={metrics.featureUsage.daily}
            trend={metrics.featureUsage.usageTrend}
            label="Hosted-tier calls per day"
            generatedAt={metrics.generatedAt}
            onOpenDay={onOpenDay}
          />
        </div>
        <SectionHeading>Most active hosted-tier accounts</SectionHeading>
        <AccountsTable
          rows={metrics.featureUsage.topUsers}
          windowDays={metrics.windowDays}
          emptyText="No hosted-tier usage recorded in this window yet."
          minWidth={ACCOUNTS_TABLE_MIN_WIDTH.OVERVIEW}
          onOpen={onOpenAccount}
        />
        <TopAccountsNote />

        <SectionHeading>Reliability</SectionHeading>
        <StatGroup columns={2}>
          <StatCard
            label="Throttled account-days · today"
            value={formatNumber(metrics.reliability.quotaLimitedUserDaysToday)}
            hint="an account that reached a daily ceiling"
            grouped
          />
          <StatCard
            label={`Throttled account-days · ${metrics.windowDays} days`}
            value={formatNumber(metrics.reliability.quotaLimitedUserDaysWindow)}
            grouped
          />
        </StatGroup>
        <p className="mt-3 text-sm text-muted-foreground">
          A hosted request that reaches the daily ceiling —{" "}
          {formatNumber(metrics.reliability.dailyLimit)} calls per account per day — is refused with{" "}
          <code className="font-mono text-xs">quota-exhausted</code>; the count above is the closest
          rejection signal the service's own tables hold. Per-request error rates and client-side
          failures are recorded as product-analytics events, which live with{" "}
          {metrics.reliability.analyticsConsoleUrl ? (
            <a
              href={metrics.reliability.analyticsConsoleUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
            >
              the analytics processor
            </a>
          ) : (
            "the analytics processor"
          )}{" "}
          rather than in this database.
        </p>

        <SectionHeading>System health</SectionHeading>
        <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
              Database
            </div>
            <div
              className="mt-2 inline-flex items-center gap-2 text-xl font-semibold"
              data-tone={db.reachable ? "complete" : "attention"}
            >
              <span
                className="inline-block size-2.5 rounded-full data-[on=true]:bg-complete data-[on=false]:bg-attention"
                data-on={db.reachable}
                aria-hidden="true"
              />
              <span className={db.reachable ? "text-complete" : "text-attention"}>
                {db.reachable ? "Reachable" : "Unreachable"}
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              probe round-trip {formatNumber(db.latencyMs)} ms
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <div className="mb-1 font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
              Integrations
            </div>
            <ul className="m-0 list-none p-0">
              {metrics.systemHealth.integrations.map((integration) => (
                <IntegrationRow key={integration.key} integration={integration} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}

function SignInCard(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);

  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: window.location.pathname,
    });
    if (result.error) {
      setPending(undefined);
      setFailed(true);
      return;
    }
    SIGN_IN_CHOSEN.write(true);
  };

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[390px] rounded-lg border border-border bg-card px-8 py-12 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 className="mt-4 mb-2 text-[1.75rem] leading-[1.15] font-semibold">Luke admin</h1>
        <p className="m-0 text-muted-foreground">
          Sign in with the account this dashboard is restricted to.
        </p>
        <div className="mt-8 mb-4 grid gap-3">
          <button
            type="button"
            className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GOOGLE)}
          >
            <GoogleMark className="size-[15px] shrink-0" />
            {pending === SOCIAL_PROVIDER.GOOGLE
              ? "Opening…"
              : `Continue with ${SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE]}`}
          </button>
          <button
            type="button"
            className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GITHUB)}
          >
            <GitHubMark className="size-[15px] shrink-0" />
            {pending === SOCIAL_PROVIDER.GITHUB
              ? "Opening…"
              : `Continue with ${SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB]}`}
          </button>
        </div>
        {failed ? <p className="m-0 text-attention">Sign-in could not start. Try again.</p> : null}
      </section>
    </main>
  );
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-lg border border-border bg-card px-8 py-12 text-center">
        <div className="mx-auto inline-flex w-11" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 className="mt-4 mb-2 text-2xl font-semibold">{title}</h1>
        <div className="text-muted-foreground">{children}</div>
      </section>
    </main>
  );
}

/** The gate's one non-admin refusal, worded the same on both views. */
function ForbiddenCard({
  email,
  onSignOut,
}: {
  email: string | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <Centered title="Not authorized">
      You are signed in{email ? ` as ${email}` : ""}, but this account does not have the admin role.
      Admin access is the <code className="font-mono">admin</code> role on your account, set
      directly in the database.
      <div className="mt-6">
        <button type="button" className={PLAIN_BUTTON} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </Centered>
  );
}

// SAFETY: a 200 from the admin metrics endpoint is an AdminMetrics body by its contract.
const readMetrics: AdminReader<AdminMetrics> = async (response) =>
  (await response.json()) as AdminMetrics;

// SAFETY: a 200 from the admin user endpoint is an AdminUserDetail body by its contract.
const readUserDetail: AdminReader<AdminUserDetail> = async (response) =>
  (await response.json()) as AdminUserDetail;

/** The failed read's own card, with the retry every screen offers on it. */
function AdminErrorCard({
  detail,
  refreshing,
  onRetry,
}: {
  detail: string;
  refreshing: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Centered title="Could not load">
      {detail}
      <div className="mt-6">
        <button type="button" className={PLAIN_BUTTON} onClick={onRetry} disabled={refreshing}>
          {refreshing ? "Trying…" : "Try again"}
        </button>
      </div>
    </Centered>
  );
}

/** A linked provider's row value drawn as its label where the page knows one. */
function signInMethodLabel(providerId: string): string {
  if (providerId === SOCIAL_PROVIDER.GITHUB) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB];
  if (providerId === SOCIAL_PROVIDER.GOOGLE) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE];
  return providerId;
}

function UserDetailPage({
  detail,
  refreshFailure,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onBack,
  refreshing,
  onRefresh,
}: {
  detail: AdminUserDetail;
  refreshFailure: string | undefined;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  onBack: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const subject: AdminUserAccount = detail.account;
  const activity = detail.activity;
  // A streak as long as the window may run past it; the page says so rather
  // than posing the truncation as the exact count.
  const streak =
    activity.currentStreakDays >= detail.windowDays
      ? `${formatNumber(detail.windowDays)}+`
      : formatNumber(activity.currentStreakDays);

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader
        title="Account"
        account={account}
        onSignOut={onSignOut}
        controls={<WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />}
      />

      <RefreshFailureNotice failure={refreshFailure} refreshing={refreshing} onRetry={onRefresh} />

      <div
        className="transition-opacity duration-150 data-[busy=true]:opacity-50"
        data-busy={refreshing}
        aria-busy={refreshing}
      >
        <a
          href={tabHref("users")}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={(event) => {
            if (!plainLeftClick(event)) return;
            event.preventDefault();
            onBack();
          }}
        >
          <span aria-hidden="true">←</span> All users
        </a>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <AccountAvatar
            account={{
              name: subject.name,
              email: subject.email,
              image: subject.image ?? undefined,
            }}
            size="large"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-[-0.01em]">{accountLabel(subject)}</h1>
              {subject.admin ? (
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                  Admin
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{subject.email}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Joined {formatDate(subject.createdAt)}
              {subject.signInMethods.length > 0
                ? ` · signs in with ${subject.signInMethods.map(signInMethodLabel).join(", ")}`
                : ""}
            </div>
          </div>
        </div>

        <SectionHeading>Daily use · hosted tier</SectionHeading>
        <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
          <StatCard
            label={`Active days · ${detail.windowDays} days`}
            value={formatNumber(activity.activeDaysWindow)}
            hint={`of ${formatNumber(detail.windowDays)} window days`}
          />
          <StatCard
            label="Current streak"
            value={`${streak} ${activity.currentStreakDays === 1 ? "day" : "days"}`}
            hint="consecutive active days"
          />
          <StatCard
            label={`Active days · ${activity.activeDaysTrend.days} days`}
            value={formatNumber(activity.activeDaysTrend.recent)}
            hint={`${formatNumber(activity.activeDaysTrend.prior)} the week before`}
          />
          <StatCard
            label="Last active"
            value={
              activity.allTime.lastActiveDay ? formatDayTick(activity.allTime.lastActiveDay) : "—"
            }
            hint={
              activity.allTime.firstActiveDay
                ? `first active ${formatDayTick(activity.allTime.firstActiveDay)}`
                : "no hosted usage yet"
            }
          />
        </div>
        <div className="mt-3">
          <UsageChart
            daily={activity.daily}
            trend={activity.usageTrend}
            label="This account's calls per day"
            generatedAt={detail.generatedAt}
          />
        </div>
        {/* The calendar spans its own trailing year, so it draws whatever
            window is chosen above — and an account with no calls at all
            draws the all-neutral year, because at a year's span the quiet
            grid is the answer rather than a restatement of the chart's
            empty notice. */}
        <div className="mt-3">
          <ActivityCalendar daily={activity.calendarDaily} generatedAt={detail.generatedAt} />
        </div>

        <SectionHeading>Volume</SectionHeading>
        <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-3">
          <StatCard
            label={`Hosted calls · ${detail.windowDays} days`}
            value={formatNumber(activity.callsWindow)}
            hint={`${formatNumber(activity.allTime.calls)} all time`}
          />
          <StatCard
            label="Active days · all time"
            value={formatNumber(activity.allTime.activeDays)}
          />
          <StatCard
            label={`Throttled days · ${detail.windowDays} days`}
            value={formatNumber(activity.quotaLimitedDaysWindow)}
            hint="days a daily ceiling was reached"
          />
        </div>
        <AccountActivityNote />
      </div>
    </main>
  );
}

// SAFETY: a 200 from the admin day endpoint is an AdminDayDetail body by its contract.
const readDayDetail: AdminReader<AdminDayDetail> = async (response) =>
  (await response.json()) as AdminDayDetail;

/**
 * The day's accounts, busiest first as the endpoint orders them. The shared
 * `AccountsTable` draws windowed columns a single day does not have, so the
 * day page keeps a table of its own with the same row anatomy: the row for
 * the pointer, and a real anchor on the name so a keyboard reaches it and a
 * modified click still gets the browser's own gesture.
 */
function DayAccountsTable({
  accounts,
  onOpen,
}: {
  accounts: readonly AdminDayAccount[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No hosted-tier calls recorded on this day.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Calls</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
                onClick={() => onOpen(row.id)}
              >
                <td className="px-5 py-3">
                  <a
                    href={accountHref(row.id)}
                    className="flex items-center gap-3 outline-offset-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!plainLeftClick(event)) return;
                      event.preventDefault();
                      onOpen(row.id);
                    }}
                  >
                    <AccountAvatar
                      account={{ name: row.name, email: row.email, image: row.image ?? undefined }}
                    />
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {accountLabel(row)}
                        {row.admin ? (
                          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      {accountLabel(row) === row.email ? null : (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </div>
                  </a>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayNote({
  truncatedTo,
  totalAccounts,
}: {
  truncatedTo?: number;
  totalAccounts: number;
}): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Voice and attention count the hosted-tier calls each account spent on this UTC day. A row
      opens the account's own page.
      {truncatedTo !== undefined
        ? ` Only the ${formatNumber(truncatedTo)} busiest accounts are listed here — the totals above still count all ${formatNumber(totalAccounts)}.`
        : ""}
    </p>
  );
}

function DayDetailPage({
  detail,
  refreshFailure,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  refreshing,
  onRefresh,
}: {
  detail: AdminDayDetail;
  refreshFailure: string | undefined;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const stillFilling = partialDayKey([{ day: detail.day }], detail.generatedAt) !== undefined;
  const soFar = stillFilling ? "so far today" : undefined;

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader
        title="Day"
        account={account}
        onSignOut={onSignOut}
        controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
      />

      <RefreshFailureNotice failure={refreshFailure} refreshing={refreshing} onRetry={onRefresh} />

      <div
        className="transition-opacity duration-150 data-[busy=true]:opacity-50"
        data-busy={refreshing}
        aria-busy={refreshing}
      >
        <a
          href={tabHref("dashboard")}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={(event) => {
            if (!plainLeftClick(event)) return;
            event.preventDefault();
            onBack();
          }}
        >
          <span aria-hidden="true">←</span> Dashboard
        </a>

        <div className="mt-6">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">
            {formatDayHeading(detail.day)}
          </h1>
          <div className="mt-1 text-sm text-muted-foreground">
            One UTC day of hosted-tier calls{stillFilling ? " — still filling" : ""}
          </div>
        </div>

        <SectionHeading>Hosted tier · this day</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Active accounts"
            value={formatNumber(detail.totals.accounts)}
            hint={soFar}
          />
          <StatCard label="Hosted calls" value={formatNumber(detail.totals.calls)} hint={soFar} />
        </div>

        <SectionHeading>Accounts active this day</SectionHeading>
        <DayAccountsTable accounts={detail.accounts} onOpen={onOpenAccount} />
        {detail.accounts.length > 0 ? (
          <DayNote
            truncatedTo={
              detail.totals.accounts > detail.accounts.length ? detail.accounts.length : undefined
            }
            totalAccounts={detail.totals.accounts}
          />
        ) : null}
      </div>
    </main>
  );
}

// SAFETY: a 200 from the admin users endpoint is an AdminUserList body by its contract.
const readUserList: AdminReader<AdminUserList> = async (response) =>
  (await response.json()) as AdminUserList;

/**
 * The narrowest each surface's table may draw before its scroll wrapper takes
 * over — past this the columns crush instead of shrinking. The roster stands
 * wider because its detail and star columns join the shared set.
 */
const ACCOUNTS_TABLE_MIN_WIDTH = {
  OVERVIEW: "min-w-[640px]",
  ROSTER: "min-w-[760px]",
} as const;

type AccountsTableMinWidth =
  (typeof ACCOUNTS_TABLE_MIN_WIDTH)[keyof typeof ACCOUNTS_TABLE_MIN_WIDTH];

/**
 * A column heading, sortable where the surface sorts: a real button inside
 * the cell so a keyboard reaches it, `aria-sort` on the cell so a reader
 * hears the order the pointer sees drawn as the arrow. Without a sorter the
 * heading is the plain cell the overview draws.
 */
function AccountsHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: AccountsSortKey;
  sort: AccountsSort | undefined;
  onSort: ((key: AccountsSortKey) => void) | undefined;
  numeric?: boolean;
}): React.JSX.Element {
  const cell = `px-5 py-3 font-medium ${numeric ? "text-right" : ""}`;
  if (!onSort) return <th className={cell}>{label}</th>;
  const direction = sort?.key === sortKey ? sort.direction : undefined;
  return (
    <th className={cell} aria-sort={direction}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-baseline gap-1 font-medium uppercase transition-colors duration-150 outline-offset-2 hover:text-foreground data-[sorted=true]:text-foreground"
        data-sorted={direction !== undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {direction ? (
          <span aria-hidden="true">{direction === SORT_DIRECTION.ASCENDING ? "▲" : "▼"}</span>
        ) : null}
      </button>
    </th>
  );
}

function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.9l1.87 3.79 4.18.61-3.02 2.95.71 4.16L8 11.44l-3.74 1.97.71-4.16-3.02-2.95 4.18-.61L8 1.9z" />
    </svg>
  );
}

/**
 * One table for every account list the admin surface draws: the overview's
 * most-active accounts and the Users roster both render through it, so the
 * shared columns cannot drift apart. Every row opens the account's own page:
 * the row for the pointer, and a real anchor on the name so a keyboard
 * reaches it and a modified click still gets the browser's own gesture. What
 * belongs to one surface is opted into — the roster's star column, sortable
 * headers, and detail columns.
 */
function AccountsTable<Row extends AccountsTableRow>({
  rows,
  windowDays,
  emptyText,
  minWidth,
  onOpen,
  detailColumns = [],
  sortable = false,
  favorite,
}: {
  rows: readonly Row[];
  windowDays: number;
  emptyText: string;
  minWidth: AccountsTableMinWidth;
  onOpen: (id: string) => void;
  detailColumns?: readonly AccountsDetailColumn<Row>[];
  /** Sorts by any header's press, remembering the order chosen. */
  sortable?: boolean;
  /** Draws the leading star column: what a row's star shows, and what its press asks. */
  favorite?: { starred: (row: Row) => boolean; onToggle: (id: string, favorite: boolean) => void };
}): React.JSX.Element {
  const [sort, setSort] = useState<AccountsSort | undefined>(
    sortable ? ACCOUNTS_SORT.read : undefined,
  );
  const toggleSort = (key: AccountsSortKey) => {
    const next = nextSort(sort, key);
    ACCOUNTS_SORT.write(next);
    setSort(next);
  };
  const onSort = sortable ? toggleSort : undefined;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  const sorted = sortAccountsRows(rows, sort, detailColumns, favorite?.starred);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} text-sm`}>
          <thead>
            <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
              {favorite ? (
                <th className="w-0 py-3 pr-0 pl-5">
                  <span className="sr-only">Favorite</span>
                </th>
              ) : null}
              <AccountsHeader
                label="Account"
                sortKey={ACCOUNTS_SORT_KEY.ACCOUNT}
                sort={sort}
                onSort={onSort}
              />
              {detailColumns.map((column) => (
                <AccountsHeader
                  key={column.key}
                  label={column.label}
                  sortKey={column.key}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
              ))}
              <AccountsHeader
                label="Active days"
                sortKey={ACCOUNTS_SORT_KEY.ACTIVE_DAYS}
                sort={sort}
                onSort={onSort}
                numeric
              />
              <AccountsHeader
                label="Last active"
                sortKey={ACCOUNTS_SORT_KEY.LAST_ACTIVE}
                sort={sort}
                onSort={onSort}
                numeric
              />
              <AccountsHeader
                label="Calls"
                sortKey={ACCOUNTS_SORT_KEY.CALLS}
                sort={sort}
                onSort={onSort}
                numeric
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                className="group cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
                onClick={() => onOpen(row.id)}
              >
                {favorite ? (
                  <td className="w-0 py-3 pr-0 pl-5">
                    <button
                      type="button"
                      className="-my-2 -ml-3 flex size-11 cursor-pointer items-center justify-center text-muted-foreground opacity-60 transition-opacity duration-150 outline-offset-2 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 data-[favorite=true]:text-attention data-[favorite=true]:opacity-100"
                      data-favorite={favorite.starred(row)}
                      aria-pressed={favorite.starred(row)}
                      aria-label={`${favorite.starred(row) ? "Unfavorite" : "Favorite"} ${row.name || row.email}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        favorite.onToggle(row.id, !favorite.starred(row));
                      }}
                    >
                      <StarIcon filled={favorite.starred(row)} />
                    </button>
                  </td>
                ) : null}
                <td className="px-5 py-3">
                  <a
                    href={accountHref(row.id)}
                    className="flex items-center gap-3 outline-offset-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!plainLeftClick(event)) return;
                      event.preventDefault();
                      onOpen(row.id);
                    }}
                  >
                    <AccountAvatar
                      account={{ name: row.name, email: row.email, image: row.image ?? undefined }}
                    />
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {accountLabel(row)}
                        {row.admin ? (
                          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      {accountLabel(row) === row.email ? null : (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </div>
                  </a>
                </td>
                {detailColumns.map((column) => (
                  <td key={column.key} className="px-5 py-3 text-right tabular-nums">
                    {column.cell(row)}
                  </td>
                ))}
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.activeDays)}
                  <span className="text-muted-foreground"> of {formatNumber(windowDays)}</span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {row.lastActiveDay === null ? "—" : formatDayTick(row.lastActiveDay)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The roster's own columns beside the shared ones: when the account joined
 * and when it last touched the service, fields the most-active rows do not
 * carry.
 */
const ROSTER_DETAIL_COLUMNS: readonly AccountsDetailColumn<AdminUserListRow>[] = [
  {
    key: ACCOUNTS_SORT_KEY.JOINED,
    label: "Joined",
    cell: (row) => formatDate(row.createdAt),
    sortValue: (row) => row.createdAt,
  },
  {
    key: ACCOUNTS_SORT_KEY.LAST_SEEN,
    label: "Last seen",
    cell: (row) => (row.lastSeenAt === null ? "—" : formatDate(row.lastSeenAt)),
    sortValue: (row) => row.lastSeenAt,
  },
];

function UsersPage({
  list,
  refreshFailure,
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onOpenAccount,
  onToggleFavorite,
  query,
  onQueryChange,
  refreshing,
  onRefresh,
}: {
  list: AdminUserList;
  refreshFailure: string | undefined;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  onOpenAccount: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  // The service searches the whole roster once the debounce settles; until
  // that answer lands, the same needle filters the rows already loaded, so
  // the box stays instant between refetches.
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? list.rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
    : list.rows;

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader
        title="Users"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
          </>
        }
      />

      <RefreshFailureNotice failure={refreshFailure} refreshing={refreshing} onRetry={onRefresh} />

      <div
        className="transition-opacity duration-150 data-[busy=true]:opacity-50"
        data-busy={refreshing}
        aria-busy={refreshing}
      >
        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <input
            type="search"
            value={query}
            maxLength={ADMIN_USERS_SEARCH_MAX_LENGTH}
            placeholder="Search by name or email…"
            aria-label="Search accounts by name or email"
            className="min-h-11 w-full max-w-[320px] rounded-md border border-border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(rows.length)} of {formatNumber(list.total)} accounts
            {list.search === undefined ? "" : " matching"}
          </span>
        </div>
        <div className="mt-4">
          <AccountsTable
            rows={rows}
            windowDays={list.windowDays}
            emptyText="No account matches."
            minWidth={ACCOUNTS_TABLE_MIN_WIDTH.ROSTER}
            onOpen={onOpenAccount}
            detailColumns={ROSTER_DETAIL_COLUMNS}
            sortable
            favorite={{ starred: (row) => row.favorite, onToggle: onToggleFavorite }}
          />
        </div>
        <RosterNote
          truncatedTo={list.total > list.rows.length ? list.rows.length : undefined}
          searched={list.search !== undefined}
        />
      </div>
    </main>
  );
}

function UsersScreen({
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onOpenAccount,
  frame,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  // What the box holds and what the service was asked to search for, apart:
  // the query redraws on every keystroke and filters the loaded rows at once,
  // while the read's own debounce commits it into the address the roster is
  // refetched under, so the whole account table is not scanned per keystroke.
  // Typing rides the address bar in place, so a searched roster is shareable
  // without the back button walking keystrokes.
  const [query, setQuery] = useState(searchFromLocation);
  const changeQuery = (next: string) => {
    setQuery(next);
    window.history.replaceState(null, "", searchHref(next.trim()));
  };
  useEffect(() => {
    const onPopState = () => setQuery(searchFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { state, refreshing, reload, withdraw, revise } = useAdminRead(
    windowedReadPath(USERS_PATH, hideAdmins, windowDays, searchTerm(query)),
    readUserList,
    ENDPOINT_ERROR.USERS,
    { debounceMs: SEARCH_DEBOUNCE_MS },
  );
  const signOut = () => void withdraw(onSignOut);

  // The star answers the press at once, while one write chain per account
  // carries the newest intent to the service: presses faster than the network
  // coalesce into the chain's next request instead of racing it out of order.
  // A landed write redraws its own outcome, so a roster refresh that crossed
  // it mid-flight cannot leave a stale star, and a failed one puts the star
  // back only when no newer press has spoken since.
  const favoriteIntents = useRef(new Map<string, boolean>());
  const favoriteWriting = useRef(new Set<string>());
  const toggleFavorite = useCallback(
    (id: string, favorite: boolean) => {
      const draw = (value: boolean) =>
        revise((list) => ({
          ...list,
          rows: list.rows.map((row) => (row.id === id ? { ...row, favorite: value } : row)),
        }));
      draw(favorite);
      favoriteIntents.current.set(id, favorite);
      if (favoriteWriting.current.has(id)) return;
      favoriteWriting.current.add(id);
      void (async () => {
        try {
          for (;;) {
            const want = favoriteIntents.current.get(id);
            if (want === undefined) return;
            favoriteIntents.current.delete(id);
            let landed = false;
            try {
              const response = await fetch(
                `${FAVORITE_PATH}?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`,
                { method: want ? "PUT" : "DELETE", headers: { accept: "application/json" } },
              );
              landed = response.ok;
            } catch {
              landed = false;
            }
            if (landed) draw(want);
            else if (!favoriteIntents.current.has(id)) draw(!want);
          }
        } finally {
          favoriteWriting.current.delete(id);
        }
      })();
    },
    [revise],
  );

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Users"
          account={account}
          onSignOut={signOut}
          loading="Reading the service's own tables."
          controls={
            <>
              <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
              <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            </>
          }
          shapes={USERS_SHAPES}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return frame(
        <AdminErrorCard
          detail={adminReadFailure(state, ENDPOINT_ERROR.USERS)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready":
      return frame(
        <UsersPage
          list={state.value}
          refreshFailure={state.refreshFailure}
          hideAdmins={hideAdmins}
          onHideAdminsChange={onHideAdminsChange}
          windowDays={windowDays}
          onWindowDaysChange={onWindowDaysChange}
          account={account}
          onSignOut={signOut}
          onOpenAccount={onOpenAccount}
          onToggleFavorite={toggleFavorite}
          query={query}
          onQueryChange={changeQuery}
          refreshing={refreshing}
          onRefresh={reload}
        />,
      );
  }
}

/** One account's read address, with the default window riding as no param. */
function accountReadPath(id: string, windowDays: AdminMetricsWindow): string {
  const params = new URLSearchParams();
  params.set(ADMIN_USER_ID_PARAM, id);
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(ADMIN_METRICS_WINDOW_PARAM, String(windowDays));
  }
  return `${USER_DETAIL_PATH}?${params.toString()}`;
}

function UserDetailScreen({
  id,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onBack,
  frame,
}: {
  id: string;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { state, refreshing, reload, withdraw } = useAdminRead(
    accountReadPath(id, windowDays),
    readUserDetail,
    ENDPOINT_ERROR.ACCOUNT,
    { keeps: (shown) => shown.account.id === id },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Account"
          account={account}
          onSignOut={signOut}
          loading="Reading the account's own rows."
          controls={<WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />}
          back={{ tab: "users", label: "All users", onBack }}
          shapes={ACCOUNT_SHAPES}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
      return frame(
        <Centered title="No such account">
          No account carries this id — it may have been deleted since its row was read.
          <div className="mt-6">
            <button type="button" className={PLAIN_BUTTON} onClick={onBack}>
              Back to users
            </button>
          </div>
        </Centered>,
      );
    case "error":
      return frame(
        <AdminErrorCard detail={state.detail} refreshing={refreshing} onRetry={reload} />,
      );
    case "ready":
      return frame(
        <UserDetailPage
          detail={state.value}
          refreshFailure={state.refreshFailure}
          windowDays={windowDays}
          onWindowDaysChange={onWindowDaysChange}
          account={account}
          onSignOut={signOut}
          onBack={onBack}
          refreshing={refreshing}
          onRefresh={reload}
        />,
      );
  }
}

/** The day read's address: one day, with the default scope riding as no param. */
function dayReadPath(day: string, hideAdmins: boolean): string {
  const params = new URLSearchParams();
  params.set(ADMIN_DAY_PARAM, day);
  if (!hideAdmins) params.set(ADMIN_METRICS_SCOPE_PARAM, ADMIN_METRICS_SCOPE.ALL);
  return `${DAY_DETAIL_PATH}?${params.toString()}`;
}

function DayDetailScreen({
  day,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  frame,
}: {
  day: string;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { state, refreshing, reload, withdraw } = useAdminRead(
    dayReadPath(day, hideAdmins),
    readDayDetail,
    ENDPOINT_ERROR.DAY,
    { keeps: (shown) => shown.day === day },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Day"
          account={account}
          onSignOut={signOut}
          loading="Reading the day's own rows."
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          back={{ tab: "dashboard", label: "Dashboard", onBack }}
          shapes={daySkeletonShapes(day)}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return frame(
        <AdminErrorCard
          detail={adminReadFailure(state, ENDPOINT_ERROR.DAY)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready":
      return frame(
        <DayDetailPage
          detail={state.value}
          refreshFailure={state.refreshFailure}
          hideAdmins={hideAdmins}
          onHideAdminsChange={onHideAdminsChange}
          account={account}
          onSignOut={signOut}
          onBack={onBack}
          onOpenAccount={onOpenAccount}
          refreshing={refreshing}
          onRefresh={reload}
        />,
      );
  }
}

/**
 * The committed motion SVGs, inlined into the bundle at build time. The glob
 * reaches outside the app the way the changelog's `CHANGELOG.md?raw` does:
 * `design/brand/motion/` is the artwork's one committed home, and a copy kept
 * here would drift from what `generate-brand-assets.mjs --check` guards.
 */
const MOTION_ASSET_SOURCES = import.meta.glob<string>("../../../design/brand/motion/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const MOTION_ASSETS = indexAnimationAssets(MOTION_ASSET_SOURCES);

/**
 * Each variant's markup as one `{__html}` object per asset, built once. React
 * re-sets `dangerouslySetInnerHTML` whenever that object's identity changes,
 * which replaces the SVG elements and restarts their timelines unpaused — so
 * an object built in render would undo the pause below on any ancestor
 * re-render, the session resolving included.
 */
const MOTION_MARKUP: ReadonlyMap<
  FaceMotion,
  ReadonlyMap<AnimationVariant, { __html: string }>
> = new Map(
  [...MOTION_ASSETS].map(([motion, byVariant]) => [
    motion,
    new Map([...byVariant].map(([variant, svg]) => [variant, { __html: svg }])),
  ]),
);

/** Dark first: the variant matching the page's own surface previews first. */
const PREVIEW_VARIANTS: readonly AnimationVariant[] = [
  ANIMATION_VARIANT.DARK,
  ANIMATION_VARIANT.LIGHT,
];

function AnimationCard({ entry }: { entry: AnimationEntry }): React.JSX.Element {
  const variants = MOTION_MARKUP.get(entry.motion);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 font-mono text-sm font-semibold">{entry.motion}</h3>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatCycleSeconds(entry.cycleMs)} cycle
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {PREVIEW_VARIANTS.map((variant) => {
          const markup = variants?.get(variant);
          return markup === undefined ? (
            <div
              key={variant}
              className="grid aspect-square place-items-center rounded-md border border-dashed border-border px-2 text-center text-xs text-muted-foreground"
            >
              No committed asset
            </div>
          ) : (
            <div
              key={variant}
              className="aspect-square overflow-hidden rounded-md [&>svg]:block [&>svg]:size-full"
              style={{ backgroundColor: ANIMATION_SWATCH[variant] }}
              aria-hidden="true"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: the markup is a committed design/brand/motion SVG inlined at build time, not user input.
              dangerouslySetInnerHTML={markup}
            />
          );
        })}
      </div>
      {entry.extraParts.length > 0 ? (
        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          Also draws: {entry.extraParts.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Every motion the face artwork defines, previewed from the committed brand
 * SVGs beside the metadata the generated table states. The page reads nothing
 * from the service — the artwork is the repository's own, inlined at build
 * time — so the local sign-in press is the only gate standing before it, the
 * same first-visit consent every other view starts behind.
 */
function AnimationsPage({
  account,
  onSignOut,
}: {
  account: ViewerAccount | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  // SMIL loops answer to neither `--face-motion` nor `prefers-reduced-motion`,
  // so the page holds them still itself wherever the reader asked the system
  // for less motion, following the setting as it changes.
  const previewsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previews = previewsRef.current;
    if (previews === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      for (const svg of previews.querySelectorAll("svg")) {
        if (reduced.matches) svg.pauseAnimations();
        else svg.unpauseAnimations();
      }
    };
    apply();
    reduced.addEventListener("change", apply);
    return () => reduced.removeEventListener("change", apply);
  }, []);

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader title="Animations" account={account} onSignOut={onSignOut} controls={null} />
      <div
        ref={previewsRef}
        className="mt-8 grid gap-4 min-[560px]:grid-cols-2 min-[880px]:grid-cols-3"
      >
        {ANIMATION_ROSTER.map((entry) => (
          <AnimationCard key={entry.motion} entry={entry} />
        ))}
      </div>
    </main>
  );
}

export function AdminDashboard(): React.JSX.Element {
  // Admin accounts are the maintainers' own; their traffic reads as noise in
  // every count, so admins start hidden and the toggle is the explicit ask to
  // include them, remembered across visits. The scope is the server's filter —
  // aggregates cannot be unpicked client-side — so flipping it refetches.
  const [hideAdmins, setHideAdmins] = useState(ADMINS_HIDDEN.read);
  const changeHideAdmins = (hide: boolean) => {
    ADMINS_HIDDEN.write(hide);
    setHideAdmins(hide);
  };
  const session = authClient.useSession();
  const account = session.data?.user;

  // The address bar owns which view is open — and which window it covers — so
  // a tab, an account page, or a 90-day view can be reloaded, shared, and left
  // with the browser's own back button.
  const [view, setView] = useState<AdminView>(viewFromLocation);
  const [windowDays, setWindowDays] = useState<AdminMetricsWindow>(windowFromLocation);
  useEffect(() => {
    const onPopState = () => {
      setView(viewFromLocation());
      setWindowDays(windowFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const openAccount = useCallback((id: string) => {
    window.history.pushState(null, "", accountHref(id));
    setView({ kind: "account", id });
  }, []);
  const openDay = useCallback((day: string) => {
    window.history.pushState(null, "", dayHref(day));
    setView({ kind: "day", day });
  }, []);
  const navigate = useCallback((tab: AdminTab) => {
    window.history.pushState(null, "", tabHref(tab));
    if (tab === "users") setView({ kind: "users" });
    else if (tab === "animations") setView({ kind: "animations" });
    else setView({ kind: "dashboard" });
  }, []);
  const changeWindow = useCallback((next: AdminMetricsWindow) => {
    setWindowDays((current) => {
      if (next === current) return current;
      window.history.pushState(null, "", windowHref(next));
      return next;
    });
  }, []);

  const [sidebarFolded, setSidebarFolded] = useState(SIDEBAR_COLLAPSED.read);
  const toggleSidebar = () => {
    setSidebarFolded((current) => {
      SIDEBAR_COLLAPSED.write(!current);
      return !current;
    });
  };

  // The dashboard's read waits while another view is open; coming back re-runs
  // it, which refreshes the numbers while the last answer stands dimmed the
  // way any refetch does. It is the shell's own read because the animations
  // view, which fetches nothing, honors the refusals it already holds.
  const metrics = useAdminRead(
    windowedReadPath(METRICS_PATH, hideAdmins, windowDays),
    readMetrics,
    ENDPOINT_ERROR.METRICS,
    { enabled: view.kind === "dashboard" },
  );
  const withdrawSession = metrics.withdraw;
  const signOut = useCallback(
    () =>
      withdrawSession(async () => {
        await authClient.signOut();
        SIGN_IN_CHOSEN.write(false);
      }),
    [withdrawSession],
  );

  const viewer: ViewerAccount | undefined = account
    ? { name: account.name, email: account.email, image: account.image ?? undefined }
    : undefined;

  // The gate's cards — sign-in and the non-admin refusal — stand alone on
  // every view: navigation drawn beside a consent card would pose as
  // somewhere to go. Everything past the gate wears the sidebar, which is why
  // the screens below take the shell as a frame to apply themselves, only
  // around the answers that earn it. The content region is a div because the
  // `main` landmark belongs to whatever stands inside it — a page's own root
  // or a centered card's — and each render path stands exactly one.
  const shell = (tab: AdminTab, content: React.JSX.Element) => (
    <div className="flex min-h-screen flex-col min-[720px]:flex-row">
      <AdminSidebar
        active={tab}
        collapsed={sidebarFolded}
        onToggle={toggleSidebar}
        onNavigate={navigate}
      />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );

  if (view.kind === "account") {
    return (
      <UserDetailScreen
        id={view.id}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate("users")}
        frame={(content) => shell("users", content)}
      />
    );
  }

  if (view.kind === "day") {
    return (
      <DayDetailScreen
        day={view.day}
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate("dashboard")}
        onOpenAccount={openAccount}
        frame={(content) => shell("dashboard", content)}
      />
    );
  }

  if (view.kind === "animations") {
    // The reference page fetches nothing, so it cannot learn the gate's
    // answers the way the data views do; it honors the refusals the parent
    // already holds and otherwise stands on the local sign-in press alone,
    // which the artwork — committed in the repository, observed from nobody —
    // is content with.
    if (metrics.state.status === "signed-out") return <SignInCard />;
    if (metrics.state.status === "forbidden") {
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    }
    return shell(
      "animations",
      <AnimationsPage account={viewer} onSignOut={() => void signOut()} />,
    );
  }

  if (view.kind === "users") {
    return (
      <UsersScreen
        hideAdmins={hideAdmins}
        onHideAdminsChange={changeHideAdmins}
        windowDays={windowDays}
        onWindowDaysChange={changeWindow}
        account={viewer}
        onSignOut={signOut}
        onOpenAccount={openAccount}
        frame={(content) => shell("users", content)}
      />
    );
  }

  switch (metrics.state.status) {
    case "loading":
      return shell(
        "dashboard",
        <PageSkeleton
          title="Dashboard"
          account={viewer}
          onSignOut={() => void signOut()}
          loading="Reading the service's own tables."
          controls={
            <>
              <WindowSwitcher value={windowDays} onChange={changeWindow} />
              <HideAdminsToggle checked={hideAdmins} onChange={changeHideAdmins} />
            </>
          }
          shapes={DASHBOARD_SHAPES}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    case "missing":
    case "error":
      return shell(
        "dashboard",
        <AdminErrorCard
          detail={adminReadFailure(metrics.state, ENDPOINT_ERROR.METRICS)}
          refreshing={metrics.refreshing}
          onRetry={metrics.reload}
        />,
      );
    case "ready":
      return shell(
        "dashboard",
        <Dashboard
          metrics={metrics.state.value}
          refreshFailure={metrics.state.refreshFailure}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={changeWindow}
          account={viewer}
          onSignOut={() => void signOut()}
          refreshing={metrics.refreshing}
          onRefresh={metrics.reload}
          onOpenAccount={openAccount}
          onOpenDay={openDay}
        />,
      );
  }
}
