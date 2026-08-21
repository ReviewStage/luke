import { HOSTED_DAILY_LIMIT, HOSTED_METER, utcDayKey } from "../hosted/quota.js";
import { type AdminViewer, isAdminRole } from "./admin-access.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  adminMetricsScope,
  errorResponse,
  jsonResponse,
} from "./http.js";

/**
 * What the admin dashboard reads about the service, and only what the service's
 * own tables can answer. Every number here is an aggregate of rows Luke already
 * stores for its own operation — signups, active sessions, hosted-tier usage —
 * read by a maintainer on their own service. It is not the desktop observing
 * sessions and it widens no analytics event: the product-event allowlist and
 * `PRIVACY.md` govern what leaves a user's machine, where this reads counts
 * that already landed.
 */

/** The trailing window every rate and series here covers, in whole UTC days. */
export const ADMIN_METRICS_WINDOW_DAYS = 30;

/**
 * The trailing run each trend compares against the run immediately before it.
 * The window must hold both runs, or `prior` would be the truncated head of one
 * and read as a fall that never happened.
 */
export const ADMIN_TREND_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * A most-active account of the hosted tier over the window, ordered by the
 * days it showed up rather than the volume it spent: the question the table
 * answers is who lives in Luke daily, which a single heavy day cannot fake.
 * The overview names an individual account here and nowhere else, and it
 * names it to the maintainer who operates the service, from that service's
 * own user row — the same fields the account already holds and the analytics
 * person record already carries. The id is carried so the row can open the
 * account's own page, and it goes back into the detail endpoint's gate,
 * never into a rendered string.
 */
export interface AdminTopUser {
  id: string;
  name: string;
  email: string;
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
  AUTH_SECRET: { key: "auth-secret", label: "Auth session secret" },
} as const;

/** Whether each integration's configuration is present — never its value. */
export interface AdminIntegrationPresence {
  analyticsRecording: boolean;
  analyticsErasure: boolean;
  hostedTier: boolean;
  googleSignIn: boolean;
  githubSignIn: boolean;
  authSecret: boolean;
}

/** The integration health list, in the fixed order the dashboard draws it. */
export function adminIntegrations(present: AdminIntegrationPresence): AdminIntegration[] {
  return [
    { ...ADMIN_INTEGRATION.HOSTED_TIER, configured: present.hostedTier },
    { ...ADMIN_INTEGRATION.ANALYTICS_RECORDING, configured: present.analyticsRecording },
    { ...ADMIN_INTEGRATION.ANALYTICS_ERASURE, configured: present.analyticsErasure },
    { ...ADMIN_INTEGRATION.GOOGLE_SIGN_IN, configured: present.googleSignIn },
    { ...ADMIN_INTEGRATION.GITHUB_SIGN_IN, configured: present.githubSignIn },
    { ...ADMIN_INTEGRATION.AUTH_SECRET, configured: present.authSecret },
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
    activeSessions: number;
    activeSessionUsers: number;
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
  reliability: {
    voiceDailyLimit: number;
    attentionDailyLimit: number;
    /** (user, day) rows that reached a ceiling — throttling made visible, since a rejected call still counts. */
    quotaLimitedUserDaysToday: number;
    quotaLimitedUserDaysWindow: number;
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
    activeSessions: number;
    activeSessionUsers: number;
    signInMethods: AdminSignInMethods;
    signupsByDay: ReadonlyMap<string, number>;
  };
  usage: {
    byDay: ReadonlyMap<string, AdminUsageDay>;
    activeUsersToday: number;
    activeUsersWindow: number;
    topUsers: readonly AdminTopUser[];
  };
  reliability: {
    quotaLimitedUserDaysToday: number;
    quotaLimitedUserDaysWindow: number;
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
export function buildAdminMetrics(source: AdminMetricsSource, now: number): AdminMetrics {
  const dayKeys = lastNDayKeys(now, ADMIN_METRICS_WINDOW_DAYS);
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
  const signupCounts = dailySignups.map((day) => day.count);
  const voiceCallsWindow = sum(daily.map((day) => day.voiceCalls));
  const attentionReviewsWindow = sum(daily.map((day) => day.attentionReviews));
  const today = source.usage.byDay.get(todayKey);

  return {
    generatedAt: now,
    windowDays: ADMIN_METRICS_WINDOW_DAYS,
    users: {
      total: source.users.total,
      newInWindow: sum(signupCounts),
      signupTrend: trailingTrend(signupCounts, ADMIN_TREND_DAYS),
      activeSessions: source.users.activeSessions,
      activeSessionUsers: source.users.activeSessionUsers,
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
        daily.map((day) => day.voiceCalls + day.attentionReviews),
        ADMIN_TREND_DAYS,
      ),
      daily,
      topUsers: [...source.usage.topUsers],
    },
    reliability: {
      voiceDailyLimit: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL],
      attentionDailyLimit: HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW],
      quotaLimitedUserDaysToday: source.reliability.quotaLimitedUserDaysToday,
      quotaLimitedUserDaysWindow: source.reliability.quotaLimitedUserDaysWindow,
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
  readMetrics: (now: number, scope: AdminMetricsScope) => Promise<AdminMetrics>;
  now?: () => number;
}

/**
 * Answers the dashboard's read, gated in steps that stay distinct: an anonymous
 * request is a 401 the page answers with a sign-in, a signed-in non-admin is a
 * 403 the page answers with a plain refusal, and metrics are read only past
 * both. A seam that throws — auth or the database not answering — is a 503 JSON
 * refusal rather than an unhandled crash, so the page can say "try again"
 * instead of failing to parse a platform error page.
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

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(
      ADMIN_HTTP_STATUS.OK,
      await options.readMetrics(now, adminMetricsScope(request.url)),
    );
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
