import type { DatabaseServices } from "@luke/database/core/query";
import { utcDayKey } from "@luke/database/models/quota";
import { Clock, Effect } from "effect";
import { DAY_MS } from "../core.js";
import type { AdminOverview } from "./admin-overview.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  adminMetricsScope,
  adminMetricsWindow,
  errorResponse,
  jsonResponse,
} from "./http.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

/**
 * What the admin dashboard reads about the service, and only what the service's
 * own tables can answer. Every number here is an aggregate of rows Luke already
 * stores for its own operation — signups, hosted-tier usage, and what
 * `admin-overview.ts` reads of tasks, agents, and calls — read by a
 * maintainer on their own service. It is not the desktop observing
 * sessions and it widens no analytics event: the product-event allowlist and
 * `PRIVACY.md` govern what leaves a user's machine, where this reads counts
 * that already landed.
 */

/**
 * The trailing run each trend compares against the run immediately before it.
 * The trend keeps this length whatever window the read asked for — a 7-day
 * view still asks "up from last week?" — so the fetch, not the window, must
 * hold both runs.
 */
export const ADMIN_TREND_DAYS = 7;

/**
 * The days a source read must cover: the window itself, and both of a trend's
 * runs even when the window is shorter than they are, or `prior` would be the
 * truncated head of one and read as a fall that never happened.
 */
export function windowFetchDays(windowDays: AdminMetricsWindow): number {
  return Math.max(windowDays, ADMIN_TREND_DAYS * 2);
}

const WEEK_MS = 7 * DAY_MS;

/**
 * How many trailing UTC weeks the retention grid covers — its cohort rows and
 * its offset columns alike, so the oldest cohort is the one row whose every
 * offset the calendar has already reached.
 */
export const ADMIN_RETENTION_WEEKS = 8;

export interface AdminDailyUsage {
  /** The UTC day the count covers, as YYYY-MM-DD. */
  day: string;
  calls: number;
}

export interface AdminDailySignups {
  day: string;
  count: number;
}

/**
 * A trailing run of days beside the run before it — the one thing a count on
 * its own cannot say, which is whether it is going up. Both runs are folded
 * from the same zero-filled series the page draws, so the comparison can never
 * disagree with the bars above it.
 */
export interface AdminTrend {
  /** The length of each run, in whole UTC days. */
  days: number;
  recent: number;
  prior: number;
}

/** The provider ids the dashboard names; every other linked provider pools into `other`. */
const SIGN_IN_PROVIDER_ID = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

/**
 * How many accounts linked each sign-in method. An account that linked more
 * than one method counts once under each, so the methods can legitimately sum
 * past the account total — never past it per method.
 */
export interface AdminSignInMethods {
  google: number;
  github: number;
  other: number;
}

/**
 * Folds the linked (account, provider) pairs the query reads into per-method
 * account counts. The dedupe lives here rather than in a grouped SQL count
 * because `other` pools every unnamed provider: an account that linked two of
 * them is still one account, which per-provider counts summed after the fact
 * would state as two.
 */
export function countSignInMethods(
  links: readonly { userId: string; providerId: string }[],
): AdminSignInMethods {
  const google = new Set<string>();
  const github = new Set<string>();
  const other = new Set<string>();
  for (const link of links) {
    if (link.providerId === SIGN_IN_PROVIDER_ID.GOOGLE) google.add(link.userId);
    else if (link.providerId === SIGN_IN_PROVIDER_ID.GITHUB) github.add(link.userId);
    else other.add(link.userId);
  }
  return { google: google.size, github: github.size, other: other.size };
}

/**
 * One cell of the retention grid: of the accounts created in the cohort's
 * week, how many were retained — by the grid's basis, a hosted-tier call or
 * a meaningful action — during the week `offset` weeks after it.
 * `share` is null for a cohort with nobody to take a share of — a percentage
 * of nothing would pose as precision — and a week the calendar has not
 * reached is no cell at all rather than a zero.
 */
export interface AdminRetentionCell {
  offset: number;
  activeAccounts: number;
  share: number | null;
  /** The cell's week is the one `generatedAt` falls in, still accruing. */
  inProgress: boolean;
}

export interface AdminRetentionCohort {
  /** The cohort's UTC week, named by its Monday as YYYY-MM-DD. */
  weekStart: string;
  /** Accounts created during this week. */
  size: number;
  cells: AdminRetentionCell[];
}

export interface AdminMetrics {
  generatedAt: number;
  windowDays: number;
  users: {
    total: number;
    /** Accounts created inside the window, the same rows the signup series draws. */
    newInWindow: number;
    signupTrend: AdminTrend;
    dailySignups: AdminDailySignups[];
  };
  /** Tasks, agents, pull requests, calls, and who is active, as `admin-overview.ts` shapes them. */
  overview: AdminOverview;
  /** Signup cohorts retained by any hosted-tier call; the overview carries the meaningful basis. */
  retention: {
    weeks: number;
    /** Oldest cohort first; each row's cells stop at the current week. */
    cohorts: AdminRetentionCohort[];
  };
}

/**
 * The raw shape the queries produce, before the pure builder zero-fills the
 * series and folds the window totals. Split out so the shaping — the part with
 * off-by-one risk in a day window — is testable without a database.
 */
export interface AdminMetricsSource {
  users: {
    total: number;
    signupsByDay: ReadonlyMap<string, number>;
  };
  retention: {
    /** Accounts created per UTC week, keyed by the week's Monday. */
    cohortSizes: ReadonlyMap<string, number>;
    /** Distinct accounts active per week, keyed by signup week then activity week. */
    activeByCohortWeek: ReadonlyMap<string, ReadonlyMap<string, number>>;
  };
}

/**
 * The window's UTC day keys, oldest first and ending on `now`'s own day, as the
 * usage table's YYYY-MM-DD keys. The series the dashboard draws is built from
 * this rather than from the rows, so a day with no row is a zero in the line
 * rather than a gap the eye reads as continuity.
 */
export function lastNDayKeys(now: number, days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(utcDayKey(now - offset * DAY_MS));
  }
  return keys;
}

/**
 * The Monday of the UTC week holding `instant`, as its YYYY-MM-DD key. Weeks
 * start on Monday because Postgres's `date_trunc('week')` lands there, and
 * the queries and this fold must name a week identically or every cohort
 * would shear against its own activity.
 */
export function utcWeekStartKey(instant: number): string {
  const daysSinceEpoch = Math.floor(instant / DAY_MS);
  // The epoch, 1970-01-01, was a Thursday: three days past its week's Monday.
  const daysSinceMonday = (daysSinceEpoch + 3) % 7;
  return utcDayKey((daysSinceEpoch - daysSinceMonday) * DAY_MS);
}

/** The trailing weeks' Monday keys, oldest first and ending on `now`'s own week. */
export function lastNWeekStartKeys(now: number, weeks: number): string[] {
  const keys: string[] = [];
  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    keys.push(utcWeekStartKey(now - offset * WEEK_MS));
  }
  return keys;
}

/**
 * Folds the queried cohort counts into the grid the dashboard draws. Each
 * cohort's cells run from its own week to the current one and no further:
 * a week the calendar has not reached is absent rather than a zero, which is
 * what shapes the triangle, and the current week's cell in every row is
 * marked still accruing. Both of the grid's bases fold through it.
 */
export function buildRetentionCohorts(
  retention: AdminMetricsSource["retention"],
  now: number,
): AdminRetentionCohort[] {
  const weekKeys = lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS);
  const currentWeek = utcWeekStartKey(now);

  return weekKeys.map((weekStart, index) => {
    const size = retention.cohortSizes.get(weekStart) ?? 0;
    const activeByWeek = retention.activeByCohortWeek.get(weekStart);
    const cells = weekKeys.slice(index).map((week, offset) => {
      const activeAccounts = activeByWeek?.get(week) ?? 0;
      return {
        offset,
        activeAccounts,
        share: size === 0 ? null : activeAccounts / size,
        inProgress: week === currentWeek,
      };
    });
    return { weekStart, size, cells };
  });
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The last `days` of a windowed series beside the `days` before them. */
export function trailingTrend(counts: readonly number[], days: number): AdminTrend {
  return {
    days,
    recent: sum(counts.slice(-days)),
    prior: sum(counts.slice(-days * 2, -days)),
  };
}

/**
 * Shapes the queried source into the answer, zero-filling and totalling in one
 * place. The overview is shaped beside it by `buildAdminOverview`, which reads
 * this module's day keys and trends, so the route joins the two.
 */
export function buildAdminMetrics(
  source: AdminMetricsSource,
  now: number,
  windowDays: AdminMetricsWindow,
): Omit<AdminMetrics, "overview"> {
  const dayKeys = lastNDayKeys(now, windowDays);
  // The trends read the same maps through their own trailing keys — the drawn
  // series' own tail whenever the window holds both runs, and the wider fetch's
  // when it does not — so a 7-day view still compares against the week before.
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);

  const dailySignups = dayKeys.map((day) => ({
    day,
    count: source.users.signupsByDay.get(day) ?? 0,
  }));

  return {
    generatedAt: now,
    windowDays,
    users: {
      total: source.users.total,
      // Note that the window's count is folded from the zero-filled series
      // rather than queried beside it: a rolling `now - 30 days` count and a
      // series of whole UTC days cover different spans, so two reads of "the
      // last 30 days" would disagree by the part-day between them.
      newInWindow: sum(dailySignups.map((day) => day.count)),
      signupTrend: trailingTrend(
        trendKeys.map((day) => source.users.signupsByDay.get(day) ?? 0),
        ADMIN_TREND_DAYS,
      ),
      dailySignups,
    },
    retention: {
      weeks: ADMIN_RETENTION_WEEKS,
      cohorts: buildRetentionCohorts(source.retention, now),
    },
  };
}

export interface AdminMetricsOptions {
  request: Request;
  readMetrics: (
    now: number,
    scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ) => AdminSeamEffect<AdminMetrics>;
}

/**
 * Answers the dashboard's read, gated in steps that stay distinct: an anonymous
 * request is a 401 the page answers with a sign-in, a signed-in non-admin is a
 * 403 the page answers with a plain refusal, a window outside the fixed set is
 * a 400, and metrics are read only past all three. A seam that throws — auth or
 * the database not answering — is a 503 JSON refusal rather than an unhandled
 * crash, so the page can say "try again" instead of failing to parse a platform
 * error page.
 */
export function handleAdminMetrics(
  options: AdminMetricsOptions,
): Effect.Effect<Response, never, DatabaseServices> {
  const { request } = options;

  const windowDays = adminMetricsWindow(request.url);
  if (windowDays === undefined) {
    return Effect.succeed(errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_WINDOW));
  }

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options.readMetrics(now, adminMetricsScope(request.url), windowDays).pipe(
      Effect.map((metrics) => jsonResponse(ADMIN_HTTP_STATUS.OK, metrics)),
      Effect.catchCause((cause) => unavailableSeam("admin metrics read failed", cause)),
    ),
  );
}
