import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_INTEGRATION,
  ADMIN_METRICS_WINDOW_DAYS,
  ADMIN_TREND_DAYS,
  type AdminMetrics,
  type AdminMetricsSource,
  adminIntegrations,
  buildAdminMetrics,
  countSignInMethods,
  handleAdminMetrics,
  lastNDayKeys,
  SIGN_IN_PROVIDER_ID,
} from "../server/admin/admin-metrics";
import {
  ADMIN_ERROR,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  type AdminMetricsScope,
  adminMetricsScope,
} from "../server/admin/http";
import { HOSTED_DAILY_LIMIT, HOSTED_METER } from "../server/hosted/quota";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

function source(overrides: Partial<AdminMetricsSource> = {}): AdminMetricsSource {
  return {
    users: {
      total: 0,
      activeSessions: 0,
      activeSessionUsers: 0,
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, activeUsersWindow: 0, topUsers: [] },
    reliability: { quotaLimitedUserDaysToday: 0, quotaLimitedUserDaysWindow: 0 },
    systemHealth: { database: { reachable: true, latencyMs: 4 }, integrations: [] },
    ...overrides,
  };
}

test("sign-in methods count accounts, not linked rows", () => {
  const methods = countSignInMethods([
    // One account holding both methods counts once under each.
    { userId: "user-1", providerId: SIGN_IN_PROVIDER_ID.GOOGLE },
    { userId: "user-1", providerId: SIGN_IN_PROVIDER_ID.GITHUB },
    { userId: "user-2", providerId: SIGN_IN_PROVIDER_ID.GITHUB },
    // Two rows of one provider are still one account with it linked.
    { userId: "user-3", providerId: SIGN_IN_PROVIDER_ID.GITHUB },
    { userId: "user-3", providerId: SIGN_IN_PROVIDER_ID.GITHUB },
    // Two unnamed providers pool into one `other` account, not two.
    { userId: "user-4", providerId: "sso-alpha" },
    { userId: "user-4", providerId: "sso-beta" },
  ]);
  assert.deepEqual(methods, { google: 1, github: 3, other: 1 });
});

test("an empty account table is zero on every method", () => {
  assert.deepEqual(countSignInMethods([]), { google: 0, github: 0, other: 0 });
});

test("the window is a contiguous run of day keys ending on today", () => {
  const keys = lastNDayKeys(NOON_UTC, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(keys.length, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(keys[0], "2026-07-19");
  assert.equal(keys[keys.length - 1], "2026-08-17");
});

test("the usage series is zero-filled and totalled across the window", () => {
  const metrics = buildAdminMetrics(
    source({
      usage: {
        byDay: new Map([
          ["2026-08-17", { voiceCalls: 3, attentionReviews: 41 }],
          ["2026-08-10", { voiceCalls: 5, attentionReviews: 0 }],
        ]),
        activeUsersToday: 2,
        activeUsersWindow: 9,
        topUsers: [],
      },
    }),
    NOON_UTC,
  );

  assert.equal(metrics.featureUsage.daily.length, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(metrics.featureUsage.voiceCallsToday, 3);
  assert.equal(metrics.featureUsage.attentionReviewsToday, 41);
  assert.equal(metrics.featureUsage.voiceCallsWindow, 8);
  assert.equal(metrics.featureUsage.attentionReviewsWindow, 41);
  assert.equal(metrics.featureUsage.activeUsersWindow, 9);
  const emptyDay = metrics.featureUsage.daily.find((day) => day.day === "2026-08-01");
  assert.deepEqual(emptyDay, { day: "2026-08-01", voiceCalls: 0, attentionReviews: 0 });
});

test("the signup series is zero-filled over the same window", () => {
  const metrics = buildAdminMetrics(
    source({
      users: {
        ...source().users,
        total: 12,
        signupsByDay: new Map([
          ["2026-08-17", 2],
          ["2026-07-19", 1],
        ]),
      },
    }),
    NOON_UTC,
  );
  assert.equal(metrics.users.total, 12);
  assert.equal(metrics.users.dailySignups.length, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(metrics.users.dailySignups[0]?.count, 1);
  assert.equal(metrics.users.dailySignups.at(-1)?.count, 2);
});

test("the window's signup count is the series' own sum, never a second reading", () => {
  const metrics = buildAdminMetrics(
    source({
      users: {
        ...source().users,
        signupsByDay: new Map([
          ["2026-08-17", 2],
          ["2026-08-02", 5],
          ["2026-07-19", 1],
          // Outside the window: the series drops it, so the total must too.
          ["2026-07-18", 99],
        ]),
      },
    }),
    NOON_UTC,
  );
  assert.equal(
    metrics.users.newInWindow,
    metrics.users.dailySignups.reduce((total, day) => total + day.count, 0),
  );
  assert.equal(metrics.users.newInWindow, 8);
});

test("the window holds both runs of a trend, so `prior` is never a truncated one", () => {
  assert.ok(ADMIN_TREND_DAYS * 2 <= ADMIN_METRICS_WINDOW_DAYS);
});

test("a trend is the trailing run beside the run immediately before it", () => {
  const metrics = buildAdminMetrics(
    source({
      users: {
        ...source().users,
        signupsByDay: new Map([
          // The recent run is 2026-08-11 through 2026-08-17; the prior run is
          // the seven days before it, and 2026-08-03 falls outside both.
          ["2026-08-17", 3],
          ["2026-08-11", 1],
          ["2026-08-10", 6],
          ["2026-08-04", 2],
          ["2026-08-03", 50],
        ]),
      },
      usage: {
        byDay: new Map([
          ["2026-08-12", { voiceCalls: 4, attentionReviews: 1 }],
          ["2026-08-05", { voiceCalls: 2, attentionReviews: 0 }],
        ]),
        activeUsersToday: 0,
        activeUsersWindow: 3,
        topUsers: [],
      },
    }),
    NOON_UTC,
  );

  assert.deepEqual(metrics.users.signupTrend, { days: ADMIN_TREND_DAYS, recent: 4, prior: 8 });
  assert.deepEqual(metrics.featureUsage.usageTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 5,
    prior: 2,
  });
});

test("a trend over an empty window is zero on both runs rather than absent", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC);
  assert.deepEqual(metrics.users.signupTrend, { days: ADMIN_TREND_DAYS, recent: 0, prior: 0 });
  assert.deepEqual(metrics.featureUsage.usageTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 0,
    prior: 0,
  });
  assert.equal(metrics.users.newInWindow, 0);
});

test("the most active accounts pass through the builder untouched", () => {
  const topUsers = [
    {
      id: "user-9",
      name: "Ada Lovelace",
      email: "ada@example.com",
      activeDays: 12,
      lastActiveDay: "2026-08-17",
      voiceCalls: 3,
      attentionReviews: 40,
      total: 43,
    },
  ];
  const metrics = buildAdminMetrics(source({ usage: { ...source().usage, topUsers } }), NOON_UTC);
  assert.deepEqual(metrics.featureUsage.topUsers, topUsers);
});

test("the daily ceilings are reported from the hosted quota, not restated", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC);
  assert.equal(metrics.reliability.voiceDailyLimit, HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL]);
  assert.equal(
    metrics.reliability.attentionDailyLimit,
    HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW],
  );
  assert.equal(metrics.windowDays, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(metrics.generatedAt, NOON_UTC);
});

test("integration health reads presence, in a fixed order, never a value", () => {
  const rows = adminIntegrations({
    hostedTier: true,
    analyticsRecording: false,
    analyticsErasure: false,
    googleSignIn: true,
    githubSignIn: true,
    authSecret: true,
  });
  assert.equal(rows[0]?.key, ADMIN_INTEGRATION.HOSTED_TIER.key);
  assert.equal(rows[0]?.configured, true);
  assert.equal(rows[1]?.key, ADMIN_INTEGRATION.ANALYTICS_RECORDING.key);
  assert.equal(rows[1]?.configured, false);
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((row) => row.configured).length, 4);
  for (const row of rows) {
    assert.ok(row.label.length > 0);
    assert.ok(row.key.length > 0);
  }
});

function metricsRequest(method = "GET"): Request {
  return new Request("https://luke.test/api/admin/metrics", { method });
}

const ADMIN_VIEWER: AdminViewer = {
  userId: "user-1",
  role: "admin",
};

function emptyMetrics(now: number): AdminMetrics {
  return buildAdminMetrics(source(), now);
}

test("the gate answers 405, 401, 403, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminMetrics({
    request: metricsRequest("POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, ADMIN_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => undefined,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => ({ ...ADMIN_VIEWER, role: "user" }),
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  const ok = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: async (now) => emptyMetrics(now),
    now: () => NOON_UTC,
  });
  assert.equal(ok.status, 200);
  // SAFETY: handleAdminMetrics answered 200, whose body is an AdminMetrics document.
  const body = (await ok.json()) as AdminMetrics;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.windowDays, ADMIN_METRICS_WINDOW_DAYS);
});

test("the scope defaults to hiding admins; only the explicit `all` widens it", () => {
  assert.equal(
    adminMetricsScope("https://luke.test/api/admin/metrics"),
    ADMIN_METRICS_SCOPE.NON_ADMINS,
  );
  assert.equal(
    adminMetricsScope("https://luke.test/api/admin/metrics?scope=all"),
    ADMIN_METRICS_SCOPE.ALL,
  );
  assert.equal(
    adminMetricsScope("https://luke.test/api/admin/metrics?scope=everyone"),
    ADMIN_METRICS_SCOPE.NON_ADMINS,
  );
});

test("the handler reads metrics at the scope the request asked for", async () => {
  const scopes: AdminMetricsScope[] = [];
  const readMetrics = async (now: number, scope: AdminMetricsScope): Promise<AdminMetrics> => {
    scopes.push(scope);
    return emptyMetrics(now);
  };
  const respond = (request: Request) =>
    handleAdminMetrics({ request, resolveViewer: async () => ADMIN_VIEWER, readMetrics });

  assert.equal((await respond(metricsRequest())).status, 200);
  const widened = new Request(
    `https://luke.test/api/admin/metrics?${ADMIN_METRICS_SCOPE_PARAM}=${ADMIN_METRICS_SCOPE.ALL}`,
  );
  assert.equal((await respond(widened)).status, 200);
  assert.deepEqual(scopes, [ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_METRICS_SCOPE.ALL]);
});

test("metrics are not read for a request that fails the gate", async () => {
  let reads = 0;
  const response = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => undefined,
    readMetrics: async (now) => {
      reads += 1;
      return emptyMetrics(now);
    },
  });
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

test("a seam that throws is a 503 refusal rather than a crash", async () => {
  const viewerThrew = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => {
      throw new Error("auth is down");
    },
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(viewerThrew.status, 503);
  assert.equal((await viewerThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const readThrew = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: async () => {
      throw new Error("database is down");
    },
  });
  assert.equal(readThrew.status, 503);
  assert.equal((await readThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);
});
