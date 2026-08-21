import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import type {
  AdminDailySignups,
  AdminDailyUsage,
  AdminIntegration,
  AdminMetrics,
  AdminTopUser,
  AdminTrend,
} from "../server/admin/admin-metrics";
import type { AdminUserAccount, AdminUserDetail } from "../server/admin/admin-user";
import type { AdminUserList, AdminUserListRow } from "../server/admin/admin-users";
import {
  ADMIN_HTTP_STATUS,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_USER_ID_PARAM,
} from "../server/admin/http";
import { accountInitials } from "./account-initials";
import { GitHubMark, GoogleMark } from "./account-marks";
import { AUTH_BUTTON } from "./auth-surface";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "./components/ui/chart";
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

function accountHref(id: string): string {
  return `${window.location.pathname}?${ACCOUNT_VIEW_PARAM}=${encodeURIComponent(id)}`;
}

function tabHref(tab: AdminTab): string {
  return tab === "users"
    ? `${window.location.pathname}?${TAB_PARAM}=${USERS_TAB_VALUE}`
    : window.location.pathname;
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

/** What the fetch resolved to: the gate's refusals stay distinct here. */
type DashboardState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "error"; detail: string }
  | { status: "ready"; metrics: AdminMetrics };

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
}: {
  label: string;
  value: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
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
 * the two series.
 */
function UsageChart({
  daily,
  trend,
  label,
}: {
  daily: readonly AdminDailyUsage[];
  trend: AdminTrend;
  label: string;
}): React.JSX.Element {
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
              <ChartTooltipContent labelFormatter={(value) => formatDayTick(String(value))} />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="voiceCalls" stackId="calls" fill="var(--color-voiceCalls)" />
          <Bar
            dataKey="attentionReviews"
            stackId="calls"
            fill="var(--color-attentionReviews)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

const SIGNUPS_CHART = {
  count: { label: "New accounts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** One series, so the heading names it and no legend box restates the heading. */
function SignupsChart({
  daily,
  trend,
}: {
  daily: readonly AdminDailySignups[];
  trend: AdminTrend;
}): React.JSX.Element {
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
              <ChartTooltipContent labelFormatter={(value) => formatDayTick(String(value))} />
            }
          />
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
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
 * carry the exact count and share the meter rows used to state. A method
 * nobody has linked draws no bar at all: a zero-length bar parks its end
 * label at the plot origin, where two empty methods would stack their labels
 * over the category axis.
 */
function SignInMethodsChart({
  methods,
}: {
  methods: AdminMetrics["users"]["signInMethods"];
}): React.JSX.Element {
  const total = methods.github + methods.google + methods.other;
  const rows = [
    { method: "GitHub", accounts: methods.github },
    { method: "Google", accounts: methods.google },
    { method: "Other", accounts: methods.other },
  ]
    .filter((row) => row.accounts > 0)
    .map((row) => ({
      ...row,
      label: `${formatNumber(row.accounts)} · ${Math.round((row.accounts / total) * 100)}%`,
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
        <BarChart data={rows} layout="vertical" margin={{ right: 96 }}>
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
 * The accounts that show up most, ordered by days present before volume
 * spent, so the people living in Luke daily sit on top of the people who had
 * one heavy afternoon. Every row opens the account's own page: the row for
 * the pointer, and a real anchor on the name so a keyboard reaches it and a
 * modified click still gets the browser's own gesture.
 */
function ActiveAccountsTable({
  users,
  windowDays,
  onOpen,
}: {
  users: readonly AdminTopUser[];
  windowDays: number;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No hosted-tier usage recorded in this window yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
            <th className="px-5 py-3 font-medium">Account</th>
            <th className="px-5 py-3 text-right font-medium">Active days</th>
            <th className="px-5 py-3 text-right font-medium">Last active</th>
            <th className="px-5 py-3 text-right font-medium">Voice</th>
            <th className="px-5 py-3 text-right font-medium">Attention</th>
            <th className="px-5 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {users.map((entry) => (
            <tr
              key={entry.id}
              className="cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
              onClick={() => onOpen(entry.id)}
            >
              <td className="px-5 py-3">
                <a
                  href={accountHref(entry.id)}
                  className="block outline-offset-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!plainLeftClick(event)) return;
                    event.preventDefault();
                    onOpen(entry.id);
                  }}
                >
                  <div className="font-medium">{entry.name}</div>
                  <div className="text-xs text-muted-foreground">{entry.email}</div>
                </a>
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(entry.activeDays)}
                <span className="text-muted-foreground"> of {formatNumber(windowDays)}</span>
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatDayTick(entry.lastActiveDay)}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(entry.voiceCalls)}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(entry.attentionReviews)}
              </td>
              <td className="px-5 py-3 text-right font-semibold tabular-nums">
                {formatNumber(entry.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        aria-label={`Account menu for ${account.name || account.email}`}
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

const SIDEBAR_ITEM = {
  ACTIVE: "bg-muted text-foreground",
  IDLE: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

/**
 * The page's one navigation, wearing the brand the headers used to carry.
 * Each tab is a real anchor to its own address, so a modified click still
 * gets the browser's own gesture; collapsed, the labels fold away and each
 * item keeps its name on a title and the toggle on its aria-label.
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
  const item = (tab: AdminTab, label: string, icon: React.ReactNode) => (
    <a
      href={tabHref(tab)}
      aria-current={active === tab ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
        active === tab ? SIDEBAR_ITEM.ACTIVE : SIDEBAR_ITEM.IDLE
      } ${collapsed ? "justify-center" : ""}`}
      onClick={(event) => {
        if (!plainLeftClick(event)) return;
        event.preventDefault();
        onNavigate(tab);
      }}
    >
      {icon}
      {collapsed ? null : label}
    </a>
  );

  return (
    <nav
      aria-label="Admin sections"
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card px-3 py-5 transition-[width] duration-150 ${
        collapsed ? "w-[62px]" : "w-56"
      }`}
    >
      <div className={`flex items-center gap-2 px-1 ${collapsed ? "justify-center" : ""}`}>
        <span className="inline-flex w-6 shrink-0 text-foreground" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </span>
        {collapsed ? null : (
          <span className="font-brand text-base font-bold tracking-[-0.01em]">Luke admin</span>
        )}
      </div>
      <div className="mt-8 grid gap-1">
        {item("dashboard", "Dashboard", <DashboardIcon />)}
        {item("users", "Users", <UsersIcon />)}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${SIDEBAR_ITEM.IDLE} ${collapsed ? "justify-center" : ""}`}
        onClick={onToggle}
      >
        <CollapseIcon collapsed={collapsed} />
        {collapsed ? null : "Collapse"}
      </button>
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

function Dashboard({
  metrics,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  refreshing,
  onRefresh,
  onOpenAccount,
  now,
}: {
  metrics: AdminMetrics;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
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
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-primary"
                checked={hideAdmins}
                onChange={(event) => onHideAdminsChange(event.target.checked)}
              />
              Hide admins
            </label>
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

      {/* A refetch dims the answer already on screen rather than replacing it:
          the numbers below stay the last ones actually read, and the dimming
          says so while the next read is in flight. */}
      <div
        className="transition-opacity duration-150 data-[busy=true]:opacity-50"
        data-busy={refreshing}
        aria-busy={refreshing}
      >
        <SectionHeading>User activity</SectionHeading>
        <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
          <StatCard label="Total accounts" value={formatNumber(metrics.users.total)} />
          <StatCard
            label={`New · ${metrics.users.signupTrend.days} days`}
            value={formatNumber(metrics.users.signupTrend.recent)}
            hint={`${formatNumber(metrics.users.newInWindow)} in ${metrics.windowDays} days`}
          />
          <StatCard
            label="Active sessions"
            value={formatNumber(metrics.users.activeSessions)}
            hint={`${formatNumber(metrics.users.activeSessionUsers)} distinct accounts`}
          />
          <StatCard
            label="Active today"
            value={formatNumber(metrics.featureUsage.activeUsersToday)}
            hint={`${formatNumber(metrics.featureUsage.activeUsersWindow)} accounts in ${metrics.windowDays} days`}
          />
        </div>
        <div className="mt-3 grid gap-3 min-[720px]:grid-cols-[1.6fr_1fr]">
          <SignupsChart daily={metrics.users.dailySignups} trend={metrics.users.signupTrend} />
          <SignInMethodsChart methods={metrics.users.signInMethods} />
        </div>

        <SectionHeading>Feature usage · hosted tier</SectionHeading>
        <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
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
          <StatCard
            label="Voice ceiling"
            value={formatNumber(metrics.reliability.voiceDailyLimit)}
            hint="calls per account per day"
          />
          <StatCard
            label="Attention ceiling"
            value={formatNumber(metrics.reliability.attentionDailyLimit)}
            hint="reviews per account per day"
          />
        </div>
        <div className="mt-3">
          <UsageChart
            daily={metrics.featureUsage.daily}
            trend={metrics.featureUsage.usageTrend}
            label="Hosted-tier calls per day"
          />
        </div>
        <SectionHeading>Most active hosted-tier accounts</SectionHeading>
        <ActiveAccountsTable
          users={metrics.featureUsage.topUsers}
          windowDays={metrics.windowDays}
          onOpen={onOpenAccount}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          An active day is a UTC day the account spent hosted voice or attention — the one
          per-account daily signal the service's own tables hold. A row opens the account's own
          page.
        </p>

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
          A hosted request that reaches a daily ceiling is refused with{" "}
          <code className="font-mono text-xs">quota-exhausted</code>; the count above is the closest
          rejection signal the service's own tables hold. Per-request error rates and client-side
          failures are recorded as product-analytics events, which live with the analytics processor
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
async function readDashboardState(response: Response): Promise<DashboardState> {
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
  return { status: "ready", metrics: (await response.json()) as AdminMetrics };
}

/** What the detail fetch resolved to: the overview's states plus a gone account. */
type DetailState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "error"; detail: string }
  | { status: "ready"; detail: AdminUserDetail };

async function readDetailState(response: Response): Promise<DetailState> {
  if (response.redirected) return { status: "error", detail: ERROR_DETAIL.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.NOT_FOUND) return { status: "missing" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ERROR_DETAIL.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: ERROR_DETAIL.ACCOUNT };
  // SAFETY: a 200 from the admin user endpoint is an AdminUserDetail body by its contract.
  return { status: "ready", detail: (await response.json()) as AdminUserDetail };
}

/** A linked provider's row value drawn as its label where the page knows one. */
function signInMethodLabel(providerId: string): string {
  if (providerId === SOCIAL_PROVIDER.GITHUB) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB];
  if (providerId === SOCIAL_PROVIDER.GOOGLE) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE];
  return providerId;
}

function UserDetailPage({
  detail,
  account,
  onSignOut,
  onBack,
  refreshing,
  onRefresh,
  now,
}: {
  detail: AdminUserDetail;
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
              <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                {subject.name || subject.email}
              </h1>
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
        <p className="mt-3 text-sm text-muted-foreground">
          An active day is a UTC day this account spent hosted voice or attention — the one
          per-account daily signal the service's own tables hold. Purely local use of the desktop
          app writes no row here; day-level launch activity is recorded as product-analytics events,
          which live with the analytics processor rather than in this database.
        </p>
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
  | { status: "ready"; list: AdminUserList };

async function readUsersState(response: Response): Promise<UsersState> {
  if (response.redirected) return { status: "error", detail: ERROR_DETAIL.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ERROR_DETAIL.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: ERROR_DETAIL.USERS };
  // SAFETY: a 200 from the admin users endpoint is an AdminUserList body by its contract.
  return { status: "ready", list: (await response.json()) as AdminUserList };
}

/** The roster's sortable columns, one per header the table draws. */
const USERS_SORT_KEY = {
  ACCOUNT: "account",
  JOINED: "joined",
  LAST_SEEN: "lastSeen",
  ACTIVE_DAYS: "activeDays",
  LAST_ACTIVE: "lastActive",
  VOICE: "voice",
  ATTENTION: "attention",
} as const;

type UsersSortKey = (typeof USERS_SORT_KEY)[keyof typeof USERS_SORT_KEY];

/** The values `aria-sort` takes, so the state is the announcement. */
const SORT_DIRECTION = {
  ASCENDING: "ascending",
  DESCENDING: "descending",
} as const;

type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

/** A column's first press: names read forward, counts and dates largest first. */
const USERS_SORT_FIRST_DIRECTION = {
  [USERS_SORT_KEY.ACCOUNT]: SORT_DIRECTION.ASCENDING,
  [USERS_SORT_KEY.JOINED]: SORT_DIRECTION.DESCENDING,
  [USERS_SORT_KEY.LAST_SEEN]: SORT_DIRECTION.DESCENDING,
  [USERS_SORT_KEY.ACTIVE_DAYS]: SORT_DIRECTION.DESCENDING,
  [USERS_SORT_KEY.LAST_ACTIVE]: SORT_DIRECTION.DESCENDING,
  [USERS_SORT_KEY.VOICE]: SORT_DIRECTION.DESCENDING,
  [USERS_SORT_KEY.ATTENTION]: SORT_DIRECTION.DESCENDING,
} satisfies Record<UsersSortKey, SortDirection>;

/**
 * What each column orders by. An account sorts by the name its row shows —
 * falling back to the email exactly as the cell does — and a last-active day
 * is an ISO date, so its lexicographic order is its chronological one.
 */
const USERS_SORT_VALUE = {
  [USERS_SORT_KEY.ACCOUNT]: (row) => (row.name || row.email).toLowerCase(),
  [USERS_SORT_KEY.JOINED]: (row) => row.createdAt,
  [USERS_SORT_KEY.LAST_SEEN]: (row) => row.lastSeenAt,
  [USERS_SORT_KEY.ACTIVE_DAYS]: (row) => row.activeDays,
  [USERS_SORT_KEY.LAST_ACTIVE]: (row) => row.lastActiveDay,
  [USERS_SORT_KEY.VOICE]: (row) => row.voiceCalls,
  [USERS_SORT_KEY.ATTENTION]: (row) => row.attentionReviews,
} satisfies Record<UsersSortKey, (row: AdminUserListRow) => string | number | null>;

interface UsersSort {
  key: UsersSortKey;
  direction: SortDirection;
}

/**
 * The last sort chosen, remembered the way the sidebar's collapse is: locally,
 * so a refresh reopens the roster in the order it was left. A stored value the
 * sets above no longer name reads as no sort at all — the server's own order —
 * rather than a guess at what an old build meant by it.
 */
const USERS_SORT_STORAGE_KEY = "luke-admin-users-sort";

/** No sort key contains the separator, so the stored token splits back apart. */
const USERS_SORT_STORAGE_SEPARATOR = ":";

function usersSortLeft(): UsersSort | undefined {
  try {
    const stored = window.localStorage.getItem(USERS_SORT_STORAGE_KEY);
    if (stored === null) return undefined;
    const [key, direction] = stored.split(USERS_SORT_STORAGE_SEPARATOR);
    const knownKey = Object.values(USERS_SORT_KEY).find((candidate) => candidate === key);
    const knownDirection = Object.values(SORT_DIRECTION).find(
      (candidate) => candidate === direction,
    );
    if (knownKey === undefined || knownDirection === undefined) return undefined;
    return { key: knownKey, direction: knownDirection };
  } catch {
    return undefined;
  }
}

function rememberUsersSort(sort: UsersSort): void {
  try {
    window.localStorage.setItem(
      USERS_SORT_STORAGE_KEY,
      `${sort.key}${USERS_SORT_STORAGE_SEPARATOR}${sort.direction}`,
    );
  } catch {
    // Storage refused: the roster opens in the server's order on the next visit.
  }
}

/**
 * Orders the roster for one sort. No sort keeps the server's order — most
 * recently active first — and ties keep it too, since the sort is stable. An
 * account with no active day yet sits below the dated rows in either
 * direction: it has no place in a chronology, and flipping one should not
 * bury the answer under the blanks.
 */
function sortUsersRows(
  rows: readonly AdminUserListRow[],
  sort: UsersSort | undefined,
): readonly AdminUserListRow[] {
  if (!sort) return rows;
  const value = USERS_SORT_VALUE[sort.key];
  const flip = sort.direction === SORT_DIRECTION.DESCENDING ? -1 : 1;
  return [...rows].sort((a, b) => {
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
 * A header that sorts its column: a real button inside the cell so a keyboard
 * reaches it, `aria-sort` on the cell so a reader hears the order the pointer
 * sees drawn as the arrow.
 */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: UsersSortKey;
  sort: UsersSort | undefined;
  onSort: (key: UsersSortKey) => void;
  numeric?: boolean;
}): React.JSX.Element {
  const direction = sort?.key === sortKey ? sort.direction : undefined;
  return (
    <th className={`px-5 py-3 font-medium ${numeric ? "text-right" : ""}`} aria-sort={direction}>
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

function UsersTable({
  rows,
  windowDays,
  onOpen,
  onToggleFavorite,
}: {
  rows: readonly AdminUserListRow[];
  windowDays: number;
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
}): React.JSX.Element {
  const [sort, setSort] = useState<UsersSort | undefined>(usersSortLeft);
  const toggleSort = (key: UsersSortKey) => {
    const next: UsersSort =
      sort?.key === key
        ? {
            key,
            direction:
              sort.direction === SORT_DIRECTION.ASCENDING
                ? SORT_DIRECTION.DESCENDING
                : SORT_DIRECTION.ASCENDING,
          }
        : { key, direction: USERS_SORT_FIRST_DIRECTION[key] };
    rememberUsersSort(next);
    setSort(next);
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No account matches.
      </div>
    );
  }
  const sorted = sortUsersRows(rows, sort);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
            <th className="w-0 py-3 pr-0 pl-5">
              <span className="sr-only">Favorite</span>
            </th>
            <SortableHeader
              label="Account"
              sortKey={USERS_SORT_KEY.ACCOUNT}
              sort={sort}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Joined"
              sortKey={USERS_SORT_KEY.JOINED}
              sort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Last seen"
              sortKey={USERS_SORT_KEY.LAST_SEEN}
              sort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Active days"
              sortKey={USERS_SORT_KEY.ACTIVE_DAYS}
              sort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Last active"
              sortKey={USERS_SORT_KEY.LAST_ACTIVE}
              sort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Voice"
              sortKey={USERS_SORT_KEY.VOICE}
              sort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Attention"
              sortKey={USERS_SORT_KEY.ATTENTION}
              sort={sort}
              onSort={toggleSort}
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
              <td className="w-0 py-3 pr-0 pl-5">
                <button
                  type="button"
                  className="flex cursor-pointer text-muted-foreground opacity-0 transition-opacity duration-150 outline-offset-2 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[favorite=true]:text-attention data-[favorite=true]:opacity-100"
                  data-favorite={row.favorite}
                  aria-pressed={row.favorite}
                  aria-label={`${row.favorite ? "Unfavorite" : "Favorite"} ${row.name || row.email}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(row.id, !row.favorite);
                  }}
                >
                  <StarIcon filled={row.favorite} />
                </button>
              </td>
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
                      {row.name}
                      {row.admin ? (
                        <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                          Admin
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.email}</div>
                  </div>
                </a>
              </td>
              <td className="px-5 py-3 text-right tabular-nums">{formatDate(row.createdAt)}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                {row.lastSeenAt === null ? "—" : formatDate(row.lastSeenAt)}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(row.activeDays)}
                <span className="text-muted-foreground"> of {formatNumber(windowDays)}</span>
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                {row.lastActiveDay ? formatDayTick(row.lastActiveDay) : "—"}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.voiceCalls)}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(row.attentionReviews)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersPage({
  list,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onOpenAccount,
  onToggleFavorite,
  refreshing,
  onRefresh,
  now,
}: {
  list: AdminUserList;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
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
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-primary"
                checked={hideAdmins}
                onChange={(event) => onHideAdminsChange(event.target.checked)}
              />
              Hide admins
            </label>
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
          <UsersTable
            rows={rows}
            windowDays={list.windowDays}
            onOpen={onOpenAccount}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Every account the service holds, most recently active first, whether or not it ever
          touched the hosted tier — active days count the window's UTC days with hosted voice or
          attention, while last seen is the account's freshest sign-in session, which a plain
          sign-in moves without any hosted use. A heading sorts by its column, a row opens the
          account's own page, and a row's star favorites the account for you alone, following your
          sign-in rather than this browser.
          {list.total > list.rows.length
            ? ` Only the ${formatNumber(list.rows.length)} most recently active accounts are listed here, and the filter searches those alone.`
            : ""}
        </p>
      </div>
    </main>
  );
}

function UsersScreen({
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onOpenAccount,
  frame,
  now,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
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
    const path = hideAdmins
      ? USERS_PATH
      : `${USERS_PATH}?${ADMIN_METRICS_SCOPE_PARAM}=${ADMIN_METRICS_SCOPE.ALL}`;
    void (async () => {
      try {
        const next = await readUsersState(
          await fetch(path, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setState(next);
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", detail: ERROR_DETAIL.USERS });
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [hideAdmins]);

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
              status: "ready",
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
      return frame(<Centered title="Loading…">Reading the service's own tables.</Centered>);
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
          hideAdmins={hideAdmins}
          onHideAdminsChange={onHideAdminsChange}
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
    void (async () => {
      try {
        const next = await readDetailState(
          await fetch(`${USER_DETAIL_PATH}?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setState(next);
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", detail: ERROR_DETAIL.ACCOUNT });
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
      return frame(<Centered title="Loading…">Reading the account's own rows.</Centered>);
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

  // The address bar owns which view is open, so a tab or an account page can
  // be reloaded, shared, and left with the browser's own back button.
  const [view, setView] = useState<AdminView>(viewFromLocation);
  useEffect(() => {
    const onPopState = () => setView(viewFromLocation());
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
    const path = hideAdmins
      ? METRICS_PATH
      : `${METRICS_PATH}?${ADMIN_METRICS_SCOPE_PARAM}=${ADMIN_METRICS_SCOPE.ALL}`;
    void (async () => {
      try {
        const next = await readDashboardState(
          await fetch(path, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setState(next);
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", detail: ERROR_DETAIL.METRICS });
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [hideAdmins]);

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
        <Centered title="Loading…">Reading the service's own tables.</Centered>,
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
          hideAdmins={hideAdmins}
          onHideAdminsChange={changeHideAdmins}
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
