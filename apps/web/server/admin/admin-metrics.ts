import { HOSTED_DAILY_LIMIT, HOSTED_METER, utcDayKey } from "../hosted/quota.js";
import type { AdminViewer } from "./admin-access.js";
import { ADMIN_ERROR, ADMIN_HTTP_STATUS, errorResponse, jsonResponse } from "./http.js";

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

/** How accounts reached the service, counted from their linked provider rows. */
export interface AdminSignInMethods {
  google: number;
  github: number;
  other: number;
}

/**
 * A heaviest user of the hosted tier over the window. This is the one place the
 * dashboard names an individual account, and it names it to the maintainer who
 * operates the service, from that service's own user row — the same two fields
 * the account already holds and the analytics person record already carries.
 */
export interface AdminTopUser {
  name: string;
  email: string;
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
    newLast7Days: number;
    newLast30Days: number;
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
    newLast7Days: number;
    newLast30Days: number;
    activeSessions: number;
    activeSessionUsers: number;
    signInMethods: AdminSignInMethods;
    signupsByDay: ReadonlyMap<string, number>;
  };
  usage: {
    byDay: ReadonlyMap<string, AdminUsageDay>;
    activeUsersToday: number;
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

  const voiceCallsWindow = daily.reduce((sum, day) => sum + day.voiceCalls, 0);
  const attentionReviewsWindow = daily.reduce((sum, day) => sum + day.attentionReviews, 0);
  const today = source.usage.byDay.get(todayKey);

  return {
    generatedAt: now,
    windowDays: ADMIN_METRICS_WINDOW_DAYS,
    users: {
      total: source.users.total,
      newLast7Days: source.users.newLast7Days,
      newLast30Days: source.users.newLast30Days,
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
   * `viewer.isAdmin` is the `admin_user` row read in the wrapper's seam.
   */
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  readMetrics: (now: number) => Promise<AdminMetrics>;
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
  if (!viewer.isAdmin) {
    return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
  }

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(ADMIN_HTTP_STATUS.OK, await options.readMetrics(now));
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
