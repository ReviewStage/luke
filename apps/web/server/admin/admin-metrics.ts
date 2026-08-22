import { HOSTED_DAILY_LIMIT, HOSTED_METER, utcDayKey } from "../hosted/quota.js";
import { type AdminViewer, isAdminRole } from "./admin-access.js";
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

/**
 * What the admin dashboard reads about the service, and only what the service's
 * own tables can answer. Every number here is an aggregate of rows Luke already
 * stores for its own operation — signups and hosted-tier usage — read by a
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * How many trailing UTC weeks the retention grid covers — its cohort rows and
 * its offset columns alike, so the oldest cohort is the one row whose every
 * offset the calendar has already reached.
 */
export const ADMIN_RETENTION_WEEKS = 8;

export interface AdminUsageDay {
  voiceCalls: number;
  attentionReviews: number;
}

export interface AdminDailyUsage extends AdminUsageDay {
  /** The UTC day the counters cover, as YYYY-MM-DD. */
  day: string;
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
export const SIGN_IN_PROVIDER_ID = {
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
 * week, how many used the hosted tier during the week `offset` weeks after it.
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

/**
 * A most-active account of the hosted tier over the window, ordered by the
 * days it showed up rather than the volume it spent: the question the table
 * answers is who lives in Luke daily, which a single heavy day cannot fake.
 * The overview names an individual account here and nowhere else, and it
 * names it to the maintainer who operates the service, from that service's
 * own user row — the same fields the account already holds and the analytics
 * person record already carries. The id is carried so the row can open the
 * account's own page, and it goes back into the detail endpoint's gate,
 * never into a rendered string. The account fields match the roster row's,
 * because both tables draw one account cell.
 */
export interface AdminTopUser {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  /** Window days with a hosted-usage row — the account showed up that day. */
  activeDays: number;
  /** The account's most recent active day inside the window, as YYYY-MM-DD. */
  lastActiveDay: string;
  voiceCalls: number;
  attentionReviews: number;
  total: number;
}

export interface AdminDatabaseHealth {
  reachable: boolean;
  /** Round-trip of a trivial probe query, in milliseconds. */
  latencyMs: number;
}

/**
 * Whether one integration is wired, by the presence of its key alone — never
 * the value. A maintainer reads that recording is on or the hosted tier is off
 * without any secret crossing into the response.
 */
export interface AdminIntegration {
  key: string;
  label: string;
  configured: boolean;
}

/**
 * The integrations the dashboard reports on, each by the key whose presence in
 * the environment decides it. The label is the maintainer-facing name; the key
 * is stable for anything that keys off the row.
 */
export const ADMIN_INTEGRATION = {
  ANALYTICS_RECORDING: { key: "analytics-recording", label: "Product analytics recording" },
  ANALYTICS_ERASURE: { key: "analytics-erasure", label: "Analytics erasure on account delete" },
  HOSTED_TIER: { key: "hosted-tier", label: "Hosted voice & attention (OpenAI)" },
  GOOGLE_SIGN_IN: { key: "google-sign-in", label: "Google sign-in" },
  GITHUB_SIGN_IN: { key: "github-sign-in", label: "GitHub sign-in" },
} as const;

/** Whether each integration's configuration is present — never its value. */
export interface AdminIntegrationPresence {
  analyticsRecording: boolean;
  analyticsErasure: boolean;
  hostedTier: boolean;
  googleSignIn: boolean;
  githubSignIn: boolean;
}

/** The integration health list, in the fixed order the dashboard draws it. */
export function adminIntegrations(present: AdminIntegrationPresence): AdminIntegration[] {
  return [
    { ...ADMIN_INTEGRATION.HOSTED_TIER, configured: present.hostedTier },
    { ...ADMIN_INTEGRATION.ANALYTICS_RECORDING, configured: present.analyticsRecording },
    { ...ADMIN_INTEGRATION.ANALYTICS_ERASURE, configured: present.analyticsErasure },
    { ...ADMIN_INTEGRATION.GOOGLE_SIGN_IN, configured: present.googleSignIn },
    { ...ADMIN_INTEGRATION.GITHUB_SIGN_IN, configured: present.githubSignIn },
  ];
}

export interface AdminMetrics {
  generatedAt: number;
  windowDays: number;
  users: {
    total: number;
    /** Accounts created inside the window, the same rows the signup series draws. */
    newInWindow: number;
    signupTrend: AdminTrend;
    signInMethods: AdminSignInMethods;
    dailySignups: AdminDailySignups[];
  };
  featureUsage: {
    voiceCallsToday: number;
    attentionReviewsToday: number;
    voiceCallsWindow: number;
    attentionReviewsWindow: number;
    activeUsersToday: number;
    /** Distinct accounts that spent anything in the window — the engaged base behind today's number. */
    activeUsersWindow: number;
    usageTrend: AdminTrend;
    daily: AdminDailyUsage[];
    topUsers: AdminTopUser[];
  };
  retention: {
    weeks: number;
    /** Oldest cohort first; each row's cells stop at the current week. */
    cohorts: AdminRetentionCohort[];
  };
  reliability: {
    voiceDailyLimit: number;
    attentionDailyLimit: number;
    /** (user, day) rows that reached a ceiling — throttling made visible, since a rejected call still counts. */
    quotaLimitedUserDaysToday: number;
    quotaLimitedUserDaysWindow: number;
    /**
     * The analytics project's console, where the per-request error rates this
     * section cannot show actually live. Absent when the deployment names no
     * project, so the page states the absence rather than drawing a dead link.
     */
    analyticsConsoleUrl?: string;
  };
  systemHealth: {
    database: AdminDatabaseHealth;
    integrations: AdminIntegration[];
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
    signInMethods: AdminSignInMethods;
    signupsByDay: ReadonlyMap<string, number>;
  };
  usage: {
    byDay: ReadonlyMap<string, AdminUsageDay>;
    activeUsersToday: number;
    activeUsersWindow: number;
    topUsers: readonly AdminTopUser[];
  };
  retention: {
    /** Accounts created per UTC week, keyed by the week's Monday. */
    cohortSizes: ReadonlyMap<string, number>;
    /** Distinct accounts active per week, keyed by signup week then activity week. */
    activeByCohortWeek: ReadonlyMap<string, ReadonlyMap<string, number>>;
  };
  reliability: {
    quotaLimitedUserDaysToday: number;
    quotaLimitedUserDaysWindow: number;
    /** Read from the environment like the integrations, not from a table. */
    analyticsConsoleUrl?: string;
  };
  systemHealth: {
    database: AdminDatabaseHealth;
    integrations: readonly AdminIntegration[];
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
 * marked still accruing.
 */
function buildRetentionCohorts(
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

/** Shapes the queried source into the answer, zero-filling and totalling in one place. */
export function buildAdminMetrics(
  source: AdminMetricsSource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminMetrics {
  const dayKeys = lastNDayKeys(now, windowDays);
  // The trends read the same maps through their own trailing keys — the drawn
  // series' own tail whenever the window holds both runs, and the wider fetch's
  // when it does not — so a 7-day view still compares against the week before.
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);
  const todayKey = utcDayKey(now);

  const dailySignups = dayKeys.map((day) => ({
    day,
    count: source.users.signupsByDay.get(day) ?? 0,
  }));

  const daily = dayKeys.map((day) => {
    const row = source.usage.byDay.get(day);
    return {
      day,
      voiceCalls: row?.voiceCalls ?? 0,
      attentionReviews: row?.attentionReviews ?? 0,
    };
  });

  // Every windowed count is folded from the zero-filled series rather than
  // queried beside it: a rolling `now - 30 days` count and a series of whole
  // UTC days cover different spans, so two reads of "the last 30 days" would
  // disagree by the part-day between them and the page would contradict itself.
  const voiceCallsWindow = sum(daily.map((day) => day.voiceCalls));
  const attentionReviewsWindow = sum(daily.map((day) => day.attentionReviews));
  const today = source.usage.byDay.get(todayKey);

  return {
    generatedAt: now,
    windowDays,
    users: {
      total: source.users.total,
      newInWindow: sum(dailySignups.map((day) => day.count)),
      signupTrend: trailingTrend(
        trendKeys.map((day) => source.users.signupsByDay.get(day) ?? 0),
        ADMIN_TREND_DAYS,
      ),
      signInMethods: source.users.signInMethods,
      dailySignups,
    },
    featureUsage: {
      voiceCallsToday: today?.voiceCalls ?? 0,
      attentionReviewsToday: today?.attentionReviews ?? 0,
      voiceCallsWindow,
      attentionReviewsWindow,
      activeUsersToday: source.usage.activeUsersToday,
      activeUsersWindow: source.usage.activeUsersWindow,
      usageTrend: trailingTrend(
        trendKeys.map((day) => {
          const row = source.usage.byDay.get(day);
          return (row?.voiceCalls ?? 0) + (row?.attentionReviews ?? 0);
        }),
        ADMIN_TREND_DAYS,
      ),
      daily,
      topUsers: [...source.usage.topUsers],
    },
    retention: {
      weeks: ADMIN_RETENTION_WEEKS,
      cohorts: buildRetentionCohorts(source.retention, now),
    },
    reliability: {
      voiceDailyLimit: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL],
      attentionDailyLimit: HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW],
      quotaLimitedUserDaysToday: source.reliability.quotaLimitedUserDaysToday,
      quotaLimitedUserDaysWindow: source.reliability.quotaLimitedUserDaysWindow,
      analyticsConsoleUrl: source.reliability.analyticsConsoleUrl,
    },
    systemHealth: {
      database: source.systemHealth.database,
      integrations: [...source.systemHealth.integrations],
    },
  };
}

export interface AdminMetricsOptions {
  request: Request;
  /**
   * The signed-in browser viewer, or nothing when no valid session is present.
   * `viewer.role` is the account's own `role`, read from the session.
   */
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  readMetrics: (
    now: number,
    scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ) => Promise<AdminMetrics>;
  now?: () => number;
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
export async function handleAdminMetrics(options: AdminMetricsOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED, ADMIN_ERROR.METHOD_NOT_ALLOWED);
  }

  let viewer: AdminViewer | undefined;
  try {
    viewer = await options.resolveViewer(request);
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
  if (!viewer) {
    return errorResponse(ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_ERROR.NOT_SIGNED_IN);
  }
  if (!isAdminRole(viewer.role)) {
    return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
  }

  const windowDays = adminMetricsWindow(request.url);
  if (windowDays === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_WINDOW);
  }

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(
      ADMIN_HTTP_STATUS.OK,
      await options.readMetrics(now, adminMetricsScope(request.url), windowDays),
    );
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
