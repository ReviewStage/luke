import { createAuthClient } from "better-auth/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
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
  ADMIN_HTTP_STATUS,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_USER_ID_PARAM,
  type AdminMetricsWindow,
} from "../server/admin/http";
import { accountInitials } from "./account-initials";
import { accountLabel } from "./account-label";
import { GitHubMark, GoogleMark } from "./account-marks";
import { settleRead } from "./admin-refresh";
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
  ChartLegend,
  ChartLegendContent,
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

/**
 * The page's own addresses, distinct from the API's parameters so a pasted
 * dashboard link and an API call never read as each other. Both ride the
 * query string because the page is served at `/admin` alone — a path segment
 * would need its own route — and the account id goes back into the detail
 * endpoint's gate, never into anything rendered.
 */
const ACCOUNT_VIEW_PARAM = "user";
const TAB_PARAM = "view";
const USERS_TAB_VALUE = "users";
const WINDOW_VIEW_PARAM = "days";

/** The sidebar's two destinations; an open account highlights Users. */
type AdminTab = "dashboard" | "users";

/** Which of the page's views the address bar names. */
type AdminView = { kind: "dashboard" } | { kind: "users" } | { kind: "account"; id: string };

function viewFromLocation(): AdminView {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(ACCOUNT_VIEW_PARAM);
  if (id) return { kind: "account", id };
  if (params.get(TAB_PARAM) === USERS_TAB_VALUE) return { kind: "users" };
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

function tabHref(tab: AdminTab): string {
  const params = new URLSearchParams();
  if (tab === "users") params.set(TAB_PARAM, USERS_TAB_VALUE);
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

/**
 * The site's session cookie is shared with the sign-in flow the desktop app
 * opens in this browser, so the first visit to this page would otherwise land
 * already signed in — on a session the maintainer never chose to spend here.
 * The dashboard opens only after a sign-in pressed on this page once; the
 * press is remembered locally, and from then on an existing session resumes
 * the way it does on any signed-in page. Signing out takes the press back with
 * the session, or the next cookie earned elsewhere on the site would open the
 * dashboard on a consent the maintainer gave once and then withdrew.
 */
const SIGN_IN_CHOSEN_STORAGE_KEY = "luke-admin-sign-in-chosen";

function signInChosenHere(): boolean {
  try {
    return window.localStorage.getItem(SIGN_IN_CHOSEN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberSignInChosen(): void {
  try {
    window.localStorage.setItem(SIGN_IN_CHOSEN_STORAGE_KEY, "true");
  } catch {
    // Storage refused: the card simply asks again on the next visit.
  }
}

function forgetSignInChosen(): void {
  try {
    window.localStorage.removeItem(SIGN_IN_CHOSEN_STORAGE_KEY);
  } catch {
    // Storage refused: the key outlives the session, and the card is the only
    // thing lost — the endpoint still answers 401 to a request with no cookie.
  }
}

/**
 * Whether the sidebar was left collapsed, remembered the way the sign-in
 * press is: locally, as the presence of a key, so a browser that refuses
 * storage simply opens expanded every visit.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = "luke-admin-sidebar-collapsed";

function sidebarLeftCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    else window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch {
    // Storage refused: the sidebar opens expanded on the next visit.
  }
}

/**
 * Whether the "Hide admins" filter was left off, remembered the way the
 * sidebar fold is: locally, as the presence of a key marking the exception,
 * so a browser that refuses storage simply opens with admins hidden.
 */
const HIDE_ADMINS_STORAGE_KEY = "luke-admin-hide-admins";

function adminsLeftHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_ADMINS_STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

function rememberAdminsHidden(hide: boolean): void {
  try {
    if (hide) window.localStorage.removeItem(HIDE_ADMINS_STORAGE_KEY);
    else window.localStorage.setItem(HIDE_ADMINS_STORAGE_KEY, "false");
  } catch {
    // Storage refused: admins hide again on the next visit.
  }
}

/** The signed-in account the header names; read from the session, shown as-is. */
interface ViewerAccount {
  name: string;
  email: string;
  image: string | undefined;
}

/** The page's one button treatment: sign out, refresh, and try again all wear it. */
const PLAIN_BUTTON =
  "cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-card";

/**
 * What the fetch resolved to: the gate's refusals stay distinct here, and a
 * ready answer carries the one failure a later refresh may have landed on it.
 */
type DashboardState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "error"; detail: string }
  | {
      status: "ready";
      metrics: AdminMetrics;
      question: string;
      refreshFailure: string | undefined;
    };

const ERROR_DETAIL = {
  UNAVAILABLE: "The service did not answer. It may be briefly unavailable — try again shortly.",
  PROTECTED:
    "The request was redirected before it reached the dashboard. A preview deployment behind Vercel Deployment Protection intercepts the API call; disable protection for this deployment, or use a production URL.",
  METRICS: "The metrics endpoint did not answer. Try again shortly.",
  USERS: "The users endpoint did not answer. Try again shortly.",
  ACCOUNT: "The account endpoint did not answer. Try again shortly.",
} as const;

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
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

/** How often the header's age re-reads the clock, so a page left open says so. */
const AGE_TICK_MS = 30_000;

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
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
}: {
  label: string;
  value: string;
  hint?: string;
  title?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4" title={title}>
      <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-sm text-muted-foreground">{hint}</div> : null}
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
  voiceCalls: { label: "Voice calls", color: "var(--chart-1)" },
  attentionReviews: { label: "Attention reviews", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * A trailing-window stacked bar chart on shadcn/ui's chart primitives. Voice
 * and attention stack so one bar reads as a day's total while its split stays
 * visible; the tooltip carries each day's exact numbers, and the legend names
 * the two series. A window with no calls at all says so instead of drawing
 * the server's zero-fill as a flat measurement, and today's bar wears the
 * partial-day fade.
 */
function UsageChart({
  daily,
  trend,
  label,
  generatedAt,
}: {
  daily: readonly AdminDailyUsage[];
  trend: AdminTrend;
  label: string;
  generatedAt: number;
}): React.JSX.Element {
  if (seriesHasNoData(daily.map((point) => point.voiceCalls + point.attentionReviews))) {
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
      <ChartContainer config={USAGE_CHART} className="aspect-auto h-48 w-full">
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
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="voiceCalls" stackId="calls" fill="var(--color-voiceCalls)">
            {daily.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
          <Bar
            dataKey="attentionReviews"
            stackId="calls"
            fill="var(--color-attentionReviews)"
            radius={[4, 4, 0, 0]}
          >
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
  "block w-full cursor-pointer px-3 py-2 text-left text-sm font-medium transition-colors duration-150 outline-offset-[-2px] hover:bg-muted focus-visible:bg-muted";

function AccountMenu({
  account,
  onSignOut,
}: {
  account: ViewerAccount;
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
        className="flex cursor-pointer items-center rounded-full transition-opacity duration-150 hover:opacity-80"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${accountLabel(account)}`}
        onClick={() => setOpen(!open)}
      >
        <AccountAvatar account={account} />
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
 * gets the browser's own gesture.
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
        className={`group relative flex items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${styling.ROW}`}
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

  return (
    <nav
      aria-label="Admin sections"
      style={{ width: sidebarRailWidth(collapsed) }}
      className="sticky top-0 flex h-screen shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-150 ease-out motion-reduce:transition-none"
    >
      <div style={{ width: SIDEBAR_WIDTH.EXPANDED }} className="flex h-full shrink-0 flex-col py-5">
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
        </div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label={sidebarToggleLabel(collapsed)}
          className={`group relative flex cursor-pointer items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${SIDEBAR_ITEM.IDLE.ROW}`}
          onClick={onToggle}
        >
          {pill(SIDEBAR_ITEM.IDLE)}
          {iconSlot(<CollapseIcon collapsed={collapsed} />)}
          <span className="relative whitespace-nowrap">Collapse</span>
        </button>
      </div>
    </nav>
  );
}

/** The heading and account menu every view wears; controls sit between them. */
function PageHeader({
  title,
  controls,
  account,
  onSignOut,
}: {
  title: string;
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{title}</h1>
      <div className="flex flex-wrap items-center gap-4">
        {controls}
        {account ? (
          <>
            <span className="h-8 w-px bg-border" aria-hidden="true" />
            <AccountMenu account={account} onSignOut={onSignOut} />
          </>
        ) : null}
      </div>
    </header>
  );
}

function GeneratedStamp({
  generatedAt,
  windowDays,
  now,
}: {
  generatedAt: number;
  windowDays: number;
  now: number;
}): React.JSX.Element {
  return (
    <span
      className="font-mono text-xs text-muted-foreground"
      title={`${formatTimestamp(generatedAt)} UTC`}
    >
      {windowDays}-day window · generated {formatAge(Math.max(0, now - generatedAt))}
    </span>
  );
}

/**
 * The failure a refresh landed on an answer that stays shown: the numbers on
 * screen are still the last ones actually read — the header's stamp keeps
 * describing them — and this band says the newer read did not arrive. The
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
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {Object.values(ADMIN_METRICS_WINDOW).map((windowDays) => (
        <button
          key={windowDays}
          type="button"
          aria-label={`${windowDays}-day window`}
          aria-pressed={value === windowDays}
          data-active={value === windowDays}
          className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-offset-2 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
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
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
      <input
        type="checkbox"
        className="size-3.5 cursor-pointer accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Hide admins
    </label>
  );
}

/**
 * The first load's stand-in: the page's own layout with bones where the data
 * will land, so the answer replaces the skeleton without moving what the
 * reader is already looking at. Every fixed dimension in the components below
 * mirrors a real component above and must move with it — a stat card's line
 * boxes, each chart's fixed plot height, the retention grid's eight `min-h-9`
 * cohort rows and the tables' ten (`ADMIN_RETENTION_WEEKS` and
 * `ADMIN_TOP_USERS_LIMIT`, not imported because the modules exporting them
 * carry query code the client bundle must not), and a table row's `py-3`
 * around a `size-8` avatar. Static words — the headings, the
 * notes under the sections, the working window and scope controls — render as
 * themselves; only unknown data gets bones, each hidden from readers while
 * `aria-busy` on the region and one visually hidden line say what the page is
 * doing.
 */
function Skeleton({
  className,
  circle = false,
}: {
  className: string;
  circle?: boolean;
}): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`${circle ? "rounded-full" : "rounded-md"} animate-pulse bg-muted motion-reduce:animate-none ${className}`}
    />
  );
}

/** A bone boxed to the height of the text line it stands for, so the swap to words moves nothing. */
function SkeletonLine({ box, bone }: { box: string; bone: string }): React.JSX.Element {
  return (
    <div className={`flex items-center ${box}`}>
      <Skeleton className={bone} />
    </div>
  );
}

function skeletonRows(count: number): readonly number[] {
  return Array.from({ length: count }, (_, row) => row);
}

function SkeletonStatCard(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <SkeletonLine box="h-4" bone="h-3 w-24" />
      <div className="mt-2">
        <SkeletonLine box="h-9" bone="h-7 w-20" />
      </div>
      <div className="mt-1">
        <SkeletonLine box="h-5" bone="h-3.5 w-32" />
      </div>
    </div>
  );
}

/** Each plot height is its chart's own fixed height, so the bars land where the bone stood. */
const SKELETON_PLOT = {
  USAGE: "h-48",
  SIGNUPS: "h-40",
  SIGN_IN_METHODS: "h-[120px]",
} as const;

type SkeletonPlot = (typeof SKELETON_PLOT)[keyof typeof SKELETON_PLOT];

function SkeletonChartCard({ plot }: { plot: SkeletonPlot }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <SkeletonLine box="h-4" bone="h-3 w-36" />
        <SkeletonLine box="h-4" bone="h-3 w-56" />
      </div>
      <Skeleton className={`w-full ${plot}`} />
    </div>
  );
}

function SkeletonRetentionGrid(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-1">
        <SkeletonLine box="h-4" bone="h-3 w-full" />
        {skeletonRows(8).map((row) => (
          <Skeleton key={row} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

function SkeletonAccountsTable({
  rows,
  numericColumns,
  starGutter = false,
}: {
  rows: number;
  numericColumns: number;
  starGutter?: boolean;
}): React.JSX.Element {
  const columns = skeletonRows(numericColumns);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-6 border-b border-border px-5 py-3">
        {starGutter ? <div className="w-4 shrink-0" /> : null}
        <div className="min-w-0 flex-1">
          <SkeletonLine box="h-4" bone="h-3 w-16" />
        </div>
        {columns.map((column) => (
          <div key={column} className="flex w-14 shrink-0 justify-end">
            <SkeletonLine box="h-4" bone="h-3 w-10" />
          </div>
        ))}
      </div>
      {skeletonRows(rows).map((row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-border px-5 py-3 last:border-0"
        >
          {starGutter ? <div className="w-4 shrink-0" /> : null}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton circle className="size-8 shrink-0" />
            <div className="min-w-0">
              <SkeletonLine box="h-5" bone="h-3.5 w-36" />
              <SkeletonLine box="h-4" bone="h-3 w-44" />
            </div>
          </div>
          {columns.map((column) => (
            <div key={column} className="flex w-14 shrink-0 justify-end">
              <SkeletonLine box="h-5" bone="h-3.5 w-10" />
            </div>
          ))}
        </div>
      ))}
    </div>
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

function RosterNote({ truncatedTo }: { truncatedTo?: number }): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Every account the service holds, most recently active first, whether or not it ever touched
      the hosted tier — active days count the window's UTC days with hosted voice or attention,
      while last seen is the account's freshest sign-in session, which a plain sign-in moves without
      any hosted use. A heading sorts by its column, a row opens the account's own page, and a row's
      star favorites the account for you alone, following your sign-in rather than this browser.
      {truncatedTo !== undefined
        ? ` Only the ${formatNumber(truncatedTo)} most recently active accounts are listed here, and the filter searches those alone.`
        : ""}
    </p>
  );
}

function DashboardSkeleton({
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <main className="mx-auto max-w-[1040px] px-6 py-10" aria-busy="true">
      <PageHeader
        title="Dashboard"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            <SkeletonLine box="h-4" bone="h-3 w-48" />
            <button type="button" className={PLAIN_BUTTON} disabled>
              Loading…
            </button>
          </>
        }
      />
      <p className="sr-only">Loading. Reading the service's own tables.</p>
      <SectionHeading>User activity</SectionHeading>
      <div className="grid gap-3 min-[720px]:grid-cols-3">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div className="mt-3 grid gap-3 min-[720px]:grid-cols-[1.6fr_1fr]">
        <SkeletonChartCard plot={SKELETON_PLOT.SIGNUPS} />
        <SkeletonChartCard plot={SKELETON_PLOT.SIGN_IN_METHODS} />
      </div>
      <SectionHeading>Signup retention · weekly cohorts</SectionHeading>
      <SkeletonRetentionGrid />
      <RetentionNote />
      <SectionHeading>Feature usage · hosted tier</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div className="mt-3">
        <SkeletonChartCard plot={SKELETON_PLOT.USAGE} />
      </div>
      <SectionHeading>Most active hosted-tier accounts</SectionHeading>
      <SkeletonAccountsTable rows={10} numericColumns={5} />
      <TopAccountsNote />
      <SectionHeading>Reliability</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div className="mt-3">
        <SkeletonLine box="h-5" bone="h-3.5 w-full" />
        <SkeletonLine box="h-5" bone="h-3.5 w-full" />
        <SkeletonLine box="h-5" bone="h-3.5 w-2/5" />
      </div>
      <SectionHeading>System health</SectionHeading>
      <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <SkeletonLine box="h-4" bone="h-3 w-20" />
          <div className="mt-2">
            <SkeletonLine box="h-7" bone="h-5 w-32" />
          </div>
          <div className="mt-1">
            <SkeletonLine box="h-5" bone="h-3.5 w-40" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="mb-1">
            <SkeletonLine box="h-4" bone="h-3 w-24" />
          </div>
          {skeletonRows(5).map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <SkeletonLine box="h-5" bone="h-3.5 w-48" />
              <SkeletonLine box="h-4" bone="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function UsersSkeleton({
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <main className="mx-auto max-w-[1040px] px-6 py-10" aria-busy="true">
      <PageHeader
        title="Users"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            <SkeletonLine box="h-4" bone="h-3 w-48" />
            <button type="button" className={PLAIN_BUTTON} disabled>
              Loading…
            </button>
          </>
        }
      />
      <p className="sr-only">Loading. Reading the service's own tables.</p>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Skeleton className="h-[34px] w-full max-w-[320px]" />
        <SkeletonLine box="h-4" bone="h-3 w-28" />
      </div>
      <div className="mt-4">
        <SkeletonAccountsTable rows={10} numericColumns={6} starGutter />
      </div>
      <RosterNote />
    </main>
  );
}

function AccountSkeleton({
  account,
  onSignOut,
  onBack,
}: {
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <main className="mx-auto max-w-[1040px] px-6 py-10" aria-busy="true">
      <PageHeader
        title="Account"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <SkeletonLine box="h-4" bone="h-3 w-48" />
            <button type="button" className={PLAIN_BUTTON} disabled>
              Loading…
            </button>
          </>
        }
      />
      <p className="sr-only">Loading. Reading the account's own rows.</p>
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
        <Skeleton circle className="size-14 shrink-0" />
        <div>
          <SkeletonLine box="h-8" bone="h-6 w-48" />
          <div className="mt-1">
            <SkeletonLine box="h-5" bone="h-3.5 w-56" />
          </div>
          <div className="mt-1">
            <SkeletonLine box="h-4" bone="h-3 w-40" />
          </div>
        </div>
      </div>
      <SectionHeading>Daily use · hosted tier</SectionHeading>
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div className="mt-3">
        <SkeletonChartCard plot={SKELETON_PLOT.USAGE} />
      </div>
      <SectionHeading>Volume</SectionHeading>
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <AccountActivityNote />
    </main>
  );
}

/** A windowed read's address: the default scope and window ride as no params. */
function windowedReadPath(
  base: string,
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
): string {
  const params = new URLSearchParams();
  if (!hideAdmins) params.set(ADMIN_METRICS_SCOPE_PARAM, ADMIN_METRICS_SCOPE.ALL);
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(ADMIN_METRICS_WINDOW_PARAM, String(windowDays));
  }
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
  now,
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
  now: number;
}): React.JSX.Element {
  const db = metrics.systemHealth.database;

  return (
    <main className="mx-auto max-w-[1040px] px-6 py-10">
      <PageHeader
        title="Dashboard"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            <GeneratedStamp
              generatedAt={metrics.generatedAt}
              windowDays={metrics.windowDays}
              now={now}
            />
            <button
              type="button"
              className={PLAIN_BUTTON}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
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
        <div className="grid gap-3 min-[720px]:grid-cols-3">
          <StatCard label="Total accounts" value={formatNumber(metrics.users.total)} />
          {/* The hint already carries the window total, so the run this count
              is read against rides the title attribute instead. */}
          <StatCard
            label={`New · ${metrics.users.signupTrend.days} days`}
            value={formatNumber(metrics.users.signupTrend.recent)}
            hint={`${formatNumber(metrics.users.newInWindow)} in ${metrics.windowDays} days`}
            title={`against ${formatNumber(metrics.users.signupTrend.prior)} in the ${metrics.users.signupTrend.days} days before`}
          />
          <StatCard
            label="Active today"
            value={formatNumber(metrics.featureUsage.activeUsersToday)}
            hint={`${formatNumber(metrics.featureUsage.activeUsersWindow)} accounts in ${metrics.windowDays} days`}
          />
        </div>
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
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Voice · today"
            value={formatNumber(metrics.featureUsage.voiceCallsToday)}
            hint={`${formatNumber(metrics.featureUsage.voiceCallsWindow)} in ${metrics.windowDays} days`}
          />
          <StatCard
            label="Attention · today"
            value={formatNumber(metrics.featureUsage.attentionReviewsToday)}
            hint={`${formatNumber(metrics.featureUsage.attentionReviewsWindow)} in ${metrics.windowDays} days`}
          />
        </div>
        <div className="mt-3">
          <UsageChart
            daily={metrics.featureUsage.daily}
            trend={metrics.featureUsage.usageTrend}
            label="Hosted-tier calls per day"
            generatedAt={metrics.generatedAt}
          />
        </div>
        <SectionHeading>Most active hosted-tier accounts</SectionHeading>
        <AccountsTable
          rows={metrics.featureUsage.topUsers}
          windowDays={metrics.windowDays}
          emptyText="No hosted-tier usage recorded in this window yet."
          minWidth={ACCOUNTS_TABLE_MIN_WIDTH.OVERVIEW}
          onOpen={onOpenAccount}
          total={(row) => row.total}
        />
        <TopAccountsNote />

        <SectionHeading>Reliability</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Throttled account-days · today"
            value={formatNumber(metrics.reliability.quotaLimitedUserDaysToday)}
            hint="an account that reached a daily ceiling"
          />
          <StatCard
            label={`Throttled account-days · ${metrics.windowDays} days`}
            value={formatNumber(metrics.reliability.quotaLimitedUserDaysWindow)}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          A hosted request that reaches a daily ceiling —{" "}
          {formatNumber(metrics.reliability.voiceDailyLimit)} voice calls or{" "}
          {formatNumber(metrics.reliability.attentionDailyLimit)} attention reviews per account per
          day — is refused with <code className="font-mono text-xs">quota-exhausted</code>; the
          count above is the closest rejection signal the service's own tables hold. Per-request
          error rates and client-side failures are recorded as product-analytics events, which live
          with{" "}
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
    rememberSignInChosen();
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

/** What one answer from the metrics endpoint means, with the gate's refusals kept distinct. */
async function readDashboardState(response: Response, question: string): Promise<DashboardState> {
  // A followed cross-origin redirect means something sat in front of the API —
  // a preview's deployment protection is the usual culprit — so the body is a
  // login page, not JSON.
  if (response.redirected) return { status: "error", detail: ERROR_DETAIL.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ERROR_DETAIL.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: ERROR_DETAIL.METRICS };
  // SAFETY: a 200 from the admin metrics endpoint is an AdminMetrics body by its contract.
  return {
    status: "ready",
    metrics: (await response.json()) as AdminMetrics,
    question,
    refreshFailure: undefined,
  };
}

/** What the detail fetch resolved to: the overview's states plus a gone account. */
type DetailState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "error"; detail: string }
  | {
      status: "ready";
      detail: AdminUserDetail;
      question: string;
      refreshFailure: string | undefined;
    };

async function readDetailState(response: Response, question: string): Promise<DetailState> {
  if (response.redirected) return { status: "error", detail: ERROR_DETAIL.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.NOT_FOUND) return { status: "missing" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ERROR_DETAIL.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: ERROR_DETAIL.ACCOUNT };
  // SAFETY: a 200 from the admin user endpoint is an AdminUserDetail body by its contract.
  return {
    status: "ready",
    detail: (await response.json()) as AdminUserDetail,
    question,
    refreshFailure: undefined,
  };
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
  account,
  onSignOut,
  onBack,
  refreshing,
  onRefresh,
  now,
}: {
  detail: AdminUserDetail;
  refreshFailure: string | undefined;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  onBack: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  now: number;
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
    <main className="mx-auto max-w-[1040px] px-6 py-10">
      <PageHeader
        title="Account"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <GeneratedStamp
              generatedAt={detail.generatedAt}
              windowDays={detail.windowDays}
              now={now}
            />
            <button
              type="button"
              className={PLAIN_BUTTON}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </>
        }
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

        <SectionHeading>Volume</SectionHeading>
        <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
          <StatCard
            label={`Voice · ${detail.windowDays} days`}
            value={formatNumber(activity.voiceCallsWindow)}
            hint={`${formatNumber(activity.allTime.voiceCalls)} all time`}
          />
          <StatCard
            label={`Attention · ${detail.windowDays} days`}
            value={formatNumber(activity.attentionReviewsWindow)}
            hint={`${formatNumber(activity.allTime.attentionReviews)} all time`}
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

/** What the roster fetch resolved to, in the overview's own vocabulary. */
type UsersState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "error"; detail: string }
  | { status: "ready"; list: AdminUserList; question: string; refreshFailure: string | undefined };

async function readUsersState(response: Response, question: string): Promise<UsersState> {
  if (response.redirected) return { status: "error", detail: ERROR_DETAIL.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ERROR_DETAIL.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: ERROR_DETAIL.USERS };
  // SAFETY: a 200 from the admin users endpoint is an AdminUserList body by its contract.
  return {
    status: "ready",
    list: (await response.json()) as AdminUserList,
    question,
    refreshFailure: undefined,
  };
}

/**
 * The account fields both admin tables' rows carry — the shared columns'
 * whole vocabulary, so a row from either endpoint draws through the one
 * `AccountsTable` below.
 */
interface AccountsTableRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
  lastActiveDay: string | null;
  voiceCalls: number;
  attentionReviews: number;
}

/** The sortable columns, one per header the roster draws. */
const ACCOUNTS_SORT_KEY = {
  ACCOUNT: "account",
  JOINED: "joined",
  LAST_SEEN: "lastSeen",
  ACTIVE_DAYS: "activeDays",
  LAST_ACTIVE: "lastActive",
  VOICE: "voice",
  ATTENTION: "attention",
} as const;

type AccountsSortKey = (typeof ACCOUNTS_SORT_KEY)[keyof typeof ACCOUNTS_SORT_KEY];

/** The values `aria-sort` takes, so the state is the announcement. */
const SORT_DIRECTION = {
  ASCENDING: "ascending",
  DESCENDING: "descending",
} as const;

type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

/** A column's first press: names read forward, counts and dates largest first. */
const ACCOUNTS_SORT_FIRST_DIRECTION = {
  [ACCOUNTS_SORT_KEY.ACCOUNT]: SORT_DIRECTION.ASCENDING,
  [ACCOUNTS_SORT_KEY.JOINED]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_SEEN]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.ACTIVE_DAYS]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_ACTIVE]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.VOICE]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.ATTENTION]: SORT_DIRECTION.DESCENDING,
} satisfies Record<AccountsSortKey, SortDirection>;

/**
 * What each shared column orders by. An account sorts by the name its row
 * shows — falling back to the email exactly as the cell does — and a
 * last-active day is an ISO date, so its lexicographic order is its
 * chronological one. A detail column's ordering rides the column itself,
 * because its fields exist only on the rows of the surface that draws it.
 */
const SHARED_SORT_VALUE = new Map<
  AccountsSortKey,
  (row: AccountsTableRow) => string | number | null
>([
  [ACCOUNTS_SORT_KEY.ACCOUNT, (row) => accountLabel(row).toLowerCase()],
  [ACCOUNTS_SORT_KEY.ACTIVE_DAYS, (row) => row.activeDays],
  [ACCOUNTS_SORT_KEY.LAST_ACTIVE, (row) => row.lastActiveDay],
  [ACCOUNTS_SORT_KEY.VOICE, (row) => row.voiceCalls],
  [ACCOUNTS_SORT_KEY.ATTENTION, (row) => row.attentionReviews],
]);

/**
 * A column one surface adds between Account and the usage counts — the
 * roster's Joined and Last seen. It carries its own cell and ordering because
 * its fields exist only on that surface's rows; the shared columns are fixed
 * in the table itself.
 */
interface AccountsDetailColumn<Row> {
  key: AccountsSortKey;
  label: string;
  cell: (row: Row) => React.ReactNode;
  sortValue: (row: Row) => string | number | null;
}

interface AccountsSort {
  key: AccountsSortKey;
  direction: SortDirection;
}

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
 * The last sort chosen, remembered the way the sidebar's collapse is: locally,
 * so a refresh reopens the roster in the order it was left. A stored value the
 * sets above no longer name reads as no sort at all — the server's own order —
 * rather than a guess at what an old build meant by it.
 */
const ACCOUNTS_SORT_STORAGE_KEY = "luke-admin-users-sort";

/** No sort key contains the separator, so the stored token splits back apart. */
const ACCOUNTS_SORT_STORAGE_SEPARATOR = ":";

function accountsSortLeft(): AccountsSort | undefined {
  try {
    const stored = window.localStorage.getItem(ACCOUNTS_SORT_STORAGE_KEY);
    if (stored === null) return undefined;
    const [key, direction] = stored.split(ACCOUNTS_SORT_STORAGE_SEPARATOR);
    const knownKey = Object.values(ACCOUNTS_SORT_KEY).find((candidate) => candidate === key);
    const knownDirection = Object.values(SORT_DIRECTION).find(
      (candidate) => candidate === direction,
    );
    if (knownKey === undefined || knownDirection === undefined) return undefined;
    return { key: knownKey, direction: knownDirection };
  } catch {
    return undefined;
  }
}

function rememberAccountsSort(sort: AccountsSort): void {
  try {
    window.localStorage.setItem(
      ACCOUNTS_SORT_STORAGE_KEY,
      `${sort.key}${ACCOUNTS_SORT_STORAGE_SEPARATOR}${sort.direction}`,
    );
  } catch {
    // Storage refused: the roster opens in the server's order on the next visit.
  }
}

/**
 * Orders the rows for one sort. Starred rows stand above everything first —
 * the star marks the accounts the admin actually watches, so no column order
 * may bury them — and the sort chosen orders each tier on its own. No sort
 * keeps the server's order — most recently active first — and ties keep it
 * too, since the sort is stable. An account with no active day yet sits below
 * the dated rows of its tier in either direction: it has no place in a
 * chronology, and flipping one should not bury the answer under the blanks.
 * A stored key naming a column this table does not draw reads as no sort at
 * all.
 */
function sortAccountsRows<Row extends AccountsTableRow>(
  rows: readonly Row[],
  sort: AccountsSort | undefined,
  detailColumns: readonly AccountsDetailColumn<Row>[],
  starred: ((row: Row) => boolean) | undefined,
): readonly Row[] {
  const detail = sort ? detailColumns.find((column) => column.key === sort.key) : undefined;
  const value = sort ? (detail?.sortValue ?? SHARED_SORT_VALUE.get(sort.key)) : undefined;
  if (value === undefined && starred === undefined) return rows;
  const flip = sort?.direction === SORT_DIRECTION.DESCENDING ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (starred && starred(a) !== starred(b)) return starred(a) ? -1 : 1;
    if (value === undefined) return 0;
    const left = value(a);
    const right = value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (left < right) return -flip;
    if (left > right) return flip;
    return 0;
  });
}

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
 * headers, and detail columns, and the overview's Total.
 */
function AccountsTable<Row extends AccountsTableRow>({
  rows,
  windowDays,
  emptyText,
  minWidth,
  onOpen,
  detailColumns = [],
  total,
  sortable = false,
  favorite,
}: {
  rows: readonly Row[];
  windowDays: number;
  emptyText: string;
  minWidth: AccountsTableMinWidth;
  onOpen: (id: string) => void;
  detailColumns?: readonly AccountsDetailColumn<Row>[];
  /** Draws the trailing Total column from this reading of a row. */
  total?: (row: Row) => number;
  /** Sorts by any header's press, remembering the order chosen. */
  sortable?: boolean;
  /** Draws the leading star column: what a row's star shows, and what its press asks. */
  favorite?: { starred: (row: Row) => boolean; onToggle: (id: string, favorite: boolean) => void };
}): React.JSX.Element {
  const [sort, setSort] = useState<AccountsSort | undefined>(
    sortable ? accountsSortLeft : undefined,
  );
  const toggleSort = (key: AccountsSortKey) => {
    const next: AccountsSort =
      sort?.key === key
        ? {
            key,
            direction:
              sort.direction === SORT_DIRECTION.ASCENDING
                ? SORT_DIRECTION.DESCENDING
                : SORT_DIRECTION.ASCENDING,
          }
        : { key, direction: ACCOUNTS_SORT_FIRST_DIRECTION[key] };
    rememberAccountsSort(next);
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
                label="Voice"
                sortKey={ACCOUNTS_SORT_KEY.VOICE}
                sort={sort}
                onSort={onSort}
                numeric
              />
              <AccountsHeader
                label="Attention"
                sortKey={ACCOUNTS_SORT_KEY.ATTENTION}
                sort={sort}
                onSort={onSort}
                numeric
              />
              {total ? <th className="px-5 py-3 text-right font-medium">Total</th> : null}
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
                      className="flex cursor-pointer text-muted-foreground opacity-0 transition-opacity duration-150 outline-offset-2 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[favorite=true]:text-attention data-[favorite=true]:opacity-100"
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
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.voiceCalls)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.attentionReviews)}
                </td>
                {total ? (
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatNumber(total(row))}
                  </td>
                ) : null}
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
  refreshing,
  onRefresh,
  now,
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
  refreshing: boolean;
  onRefresh: () => void;
  now: number;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? list.rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
    : list.rows;

  return (
    <main className="mx-auto max-w-[1040px] px-6 py-10">
      <PageHeader
        title="Users"
        account={account}
        onSignOut={onSignOut}
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            <GeneratedStamp generatedAt={list.generatedAt} windowDays={list.windowDays} now={now} />
            <button
              type="button"
              className={PLAIN_BUTTON}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
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
            placeholder="Filter by name or email…"
            aria-label="Filter accounts by name or email"
            className="w-full max-w-[320px] rounded-md border border-border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(rows.length)} of {formatNumber(list.total)} accounts
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
        <RosterNote truncatedTo={list.total > list.rows.length ? list.rows.length : undefined} />
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
  now,
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
  now: number;
}): React.JSX.Element {
  const [state, setState] = useState<UsersState>(() =>
    signInChosenHere() ? { status: "loading" } : { status: "signed-out" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController>(null);

  // The same withdrawal the detail screen lands: this screen renders in the
  // overview's place with a ready answer of its own, so the parent's sign-out
  // alone would leave the roster on screen after the consent behind it left.
  const signOut = async () => {
    inFlight.current?.abort();
    setRefreshing(false);
    await onSignOut();
    setState({ status: "signed-out" });
  };

  const load = useCallback(() => {
    if (!signInChosenHere()) {
      setState({ status: "signed-out" });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    setRefreshing(true);
    const path = windowedReadPath(USERS_PATH, hideAdmins, windowDays);
    void (async () => {
      try {
        const next = await readUsersState(
          await fetch(path, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
          path,
        );
        if (!controller.signal.aborted) setState((current) => settleRead(current, next, path));
      } catch {
        if (!controller.signal.aborted) {
          setState((current) =>
            settleRead(current, { status: "error", detail: ERROR_DETAIL.USERS }, path),
          );
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [hideAdmins, windowDays]);

  useEffect(() => {
    load();
    return () => inFlight.current?.abort();
  }, [load]);

  // The star answers the press at once, while one write chain per account
  // carries the newest intent to the service: presses faster than the network
  // coalesce into the chain's next request instead of racing it out of order.
  // A landed write redraws its own outcome, so a roster refresh that crossed
  // it mid-flight cannot leave a stale star, and a failed one puts the star
  // back only when no newer press has spoken since.
  const favoriteIntents = useRef(new Map<string, boolean>());
  const favoriteWriting = useRef(new Set<string>());
  const toggleFavorite = useCallback((id: string, favorite: boolean) => {
    const draw = (value: boolean) =>
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              list: {
                ...current.list,
                rows: current.list.rows.map((row) =>
                  row.id === id ? { ...row, favorite: value } : row,
                ),
              },
            }
          : current,
      );
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
  }, []);

  switch (state.status) {
    case "loading":
      return frame(
        <UsersSkeleton
          hideAdmins={hideAdmins}
          onHideAdminsChange={onHideAdminsChange}
          windowDays={windowDays}
          onWindowDaysChange={onWindowDaysChange}
          account={account}
          onSignOut={() => void signOut()}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    case "error":
      return frame(
        <Centered title="Could not load">
          {state.detail}
          <div className="mt-6">
            <button type="button" className={PLAIN_BUTTON} onClick={load} disabled={refreshing}>
              {refreshing ? "Trying…" : "Try again"}
            </button>
          </div>
        </Centered>,
      );
    case "ready":
      return frame(
        <UsersPage
          list={state.list}
          refreshFailure={state.refreshFailure}
          hideAdmins={hideAdmins}
          onHideAdminsChange={onHideAdminsChange}
          windowDays={windowDays}
          onWindowDaysChange={onWindowDaysChange}
          account={account}
          onSignOut={() => void signOut()}
          onOpenAccount={onOpenAccount}
          onToggleFavorite={toggleFavorite}
          refreshing={refreshing}
          onRefresh={load}
          now={now}
        />,
      );
  }
}

function UserDetailScreen({
  id,
  account,
  onSignOut,
  onBack,
  frame,
  now,
}: {
  id: string;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
  now: number;
}): React.JSX.Element {
  const [state, setState] = useState<DetailState>(() =>
    signInChosenHere() ? { status: "loading" } : { status: "signed-out" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController>(null);

  // The parent's sign-out resets the overview, but this screen renders in the
  // overview's place and holds a ready answer of its own — left alone, the
  // account's identity and usage would stand on screen after the consent
  // behind them was withdrawn. So the withdrawal lands here too: the open
  // read is dropped first, for the same reason the overview drops its own.
  const signOut = async () => {
    inFlight.current?.abort();
    setRefreshing(false);
    await onSignOut();
    setState({ status: "signed-out" });
  };

  const load = useCallback(() => {
    // The same local consent the overview asks for: a deep link into an
    // account page still opens on the sign-in card until a sign-in has been
    // pressed on this page once.
    if (!signInChosenHere()) {
      setState({ status: "signed-out" });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    // A refresh keeps the page it is refreshing; a different account — the
    // browser's own back and forward can swap ids without passing the
    // overview — must not stand dimmed behind the other account's read.
    setState((current) =>
      current.status === "ready" && current.detail.account.id === id
        ? current
        : { status: "loading" },
    );
    setRefreshing(true);
    const path = `${USER_DETAIL_PATH}?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`;
    void (async () => {
      try {
        const next = await readDetailState(
          await fetch(path, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
          path,
        );
        if (!controller.signal.aborted) setState((current) => settleRead(current, next, path));
      } catch {
        if (!controller.signal.aborted) {
          setState((current) =>
            settleRead(current, { status: "error", detail: ERROR_DETAIL.ACCOUNT }, path),
          );
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    load();
    return () => inFlight.current?.abort();
  }, [load]);

  switch (state.status) {
    case "loading":
      return frame(
        <AccountSkeleton account={account} onSignOut={() => void signOut()} onBack={onBack} />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
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
        <Centered title="Could not load">
          {state.detail}
          <div className="mt-6">
            <button type="button" className={PLAIN_BUTTON} onClick={load} disabled={refreshing}>
              {refreshing ? "Trying…" : "Try again"}
            </button>
          </div>
        </Centered>,
      );
    case "ready":
      return frame(
        <UserDetailPage
          detail={state.detail}
          refreshFailure={state.refreshFailure}
          account={account}
          onSignOut={() => void signOut()}
          onBack={onBack}
          refreshing={refreshing}
          onRefresh={load}
          now={now}
        />,
      );
  }
}

/** A clock of its own, so the header's age stays true without refetching to learn it. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function AdminDashboard(): React.JSX.Element {
  // A first visit is signed-out from the very first frame: it never fetches,
  // so a loading state would pose as a request that is not in flight.
  const [state, setState] = useState<DashboardState>(() =>
    signInChosenHere() ? { status: "loading" } : { status: "signed-out" },
  );
  // Admin accounts are the maintainers' own; their traffic reads as noise in
  // every count, so admins start hidden and the toggle is the explicit ask to
  // include them, remembered across visits. The scope is the server's filter —
  // aggregates cannot be unpicked client-side — so flipping it refetches.
  const [hideAdmins, setHideAdmins] = useState(adminsLeftHidden);
  const changeHideAdmins = (hide: boolean) => {
    rememberAdminsHidden(hide);
    setHideAdmins(hide);
  };
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController>(null);
  const now = useNow(AGE_TICK_MS);
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
  const navigate = useCallback((tab: AdminTab) => {
    window.history.pushState(null, "", tabHref(tab));
    setView(tab === "users" ? { kind: "users" } : { kind: "dashboard" });
  }, []);
  const changeWindow = useCallback((next: AdminMetricsWindow) => {
    setWindowDays((current) => {
      if (next === current) return current;
      window.history.pushState(null, "", windowHref(next));
      return next;
    });
  }, []);

  const [sidebarFolded, setSidebarFolded] = useState(sidebarLeftCollapsed);
  const toggleSidebar = () => {
    setSidebarFolded((current) => {
      rememberSidebarCollapsed(!current);
      return !current;
    });
  };

  const load = useCallback(() => {
    // A session earned elsewhere on the site does not open the dashboard by
    // itself: until a sign-in has been pressed on this page once, the card is
    // the answer, whatever cookie the browser holds.
    if (!signInChosenHere()) {
      setState({ status: "signed-out" });
      return;
    }
    // One read at a time: a scope flipped twice, or a refresh pressed on a slow
    // answer, would otherwise leave two in flight and let the older one land
    // last and overwrite the newer.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    // Only a read with nothing to replace clears the page. A refetch — the
    // scope toggle, the refresh button — keeps the last answer up until the
    // next one arrives, because blanking a read page for a press that changes
    // one filter throws away the reader's place and reads as a fault.
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    setRefreshing(true);
    const path = windowedReadPath(METRICS_PATH, hideAdmins, windowDays);
    void (async () => {
      try {
        const next = await readDashboardState(
          await fetch(path, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
          path,
        );
        if (!controller.signal.aborted) setState((current) => settleRead(current, next, path));
      } catch {
        if (!controller.signal.aborted) {
          setState((current) =>
            settleRead(current, { status: "error", detail: ERROR_DETAIL.METRICS }, path),
          );
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [hideAdmins, windowDays]);

  useEffect(() => {
    // The dashboard's read waits while another view is open; coming back
    // re-runs it, which refreshes the numbers while the last answer stands
    // dimmed the way any refetch does.
    if (view.kind !== "dashboard") return;
    load();
    return () => inFlight.current?.abort();
  }, [load, view.kind]);

  const signOut = async () => {
    // The header stays live through a refetch, so this press can land on an open
    // read. It is dropped first: an answer that left carrying the old cookie
    // would otherwise resolve behind the sign-out and put the dashboard back up
    // on a consent that was just withdrawn.
    inFlight.current?.abort();
    setRefreshing(false);
    await authClient.signOut();
    forgetSignInChosen();
    setState({ status: "signed-out" });
  };

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
    <div className="flex min-h-screen">
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
        account={viewer}
        onSignOut={signOut}
        onBack={() => navigate("users")}
        frame={(content) => shell("users", content)}
        now={now}
      />
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
        now={now}
      />
    );
  }

  switch (state.status) {
    case "loading":
      return shell(
        "dashboard",
        <DashboardSkeleton
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={changeWindow}
          account={viewer}
          onSignOut={() => void signOut()}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={() => void signOut()} />;
    case "error":
      return shell(
        "dashboard",
        <Centered title="Could not load">
          {state.detail}
          <div className="mt-6">
            <button type="button" className={PLAIN_BUTTON} onClick={load} disabled={refreshing}>
              {refreshing ? "Trying…" : "Try again"}
            </button>
          </div>
        </Centered>,
      );
    case "ready":
      return shell(
        "dashboard",
        <Dashboard
          metrics={state.metrics}
          refreshFailure={state.refreshFailure}
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
          windowDays={windowDays}
          onWindowDaysChange={changeWindow}
          account={viewer}
          onSignOut={() => void signOut()}
          refreshing={refreshing}
          onRefresh={load}
          onOpenAccount={openAccount}
          now={now}
        />,
      );
  }
}
