import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_INTEGRATION,
  ADMIN_RETENTION_WEEKS,
  ADMIN_TREND_DAYS,
  type AdminMetrics,
  type AdminMetricsSource,
  adminIntegrations,
  buildAdminMetrics,
  countSignInMethods,
  handleAdminMetrics,
  lastNDayKeys,
  lastNWeekStartKeys,
  SIGN_IN_PROVIDER_ID,
  utcWeekStartKey,
  windowFetchDays,
} from "../server/admin/admin-metrics";
import {
  ADMIN_ERROR,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  adminMetricsScope,
  adminMetricsWindow,
} from "../server/admin/http";
import { posthogProjectConsoleUrl } from "../server/hosted/posthog";
import { HOSTED_DAILY_LIMIT, HOSTED_METER } from "../server/hosted/quota";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

function source(overrides: Partial<AdminMetricsSource> = {}): AdminMetricsSource {
  return {
    users: {
      total: 0,
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, activeUsersWindow: 0, topUsers: [] },
    retention: { cohortSizes: new Map(), activeByCohortWeek: new Map() },
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
  const keys = lastNDayKeys(NOON_UTC, ADMIN_METRICS_WINDOW.MONTH);
  assert.equal(keys.length, ADMIN_METRICS_WINDOW.MONTH);
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
    ADMIN_METRICS_WINDOW_DEFAULT,
  );

  assert.equal(metrics.featureUsage.daily.length, ADMIN_METRICS_WINDOW_DEFAULT);
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
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.equal(metrics.users.total, 12);
  assert.equal(metrics.users.dailySignups.length, ADMIN_METRICS_WINDOW_DEFAULT);
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
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.equal(
    metrics.users.newInWindow,
    metrics.users.dailySignups.reduce((total, day) => total + day.count, 0),
  );
  assert.equal(metrics.users.newInWindow, 8);
});

test("the fetch holds both runs of a trend, so `prior` is never a truncated one", () => {
  for (const windowDays of Object.values(ADMIN_METRICS_WINDOW)) {
    assert.ok(ADMIN_TREND_DAYS * 2 <= windowFetchDays(windowDays));
    assert.ok(windowDays <= windowFetchDays(windowDays));
  }
  assert.equal(windowFetchDays(ADMIN_METRICS_WINDOW.WEEK), ADMIN_TREND_DAYS * 2);
  assert.equal(windowFetchDays(ADMIN_METRICS_WINDOW.QUARTER), ADMIN_METRICS_WINDOW.QUARTER);
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
    ADMIN_METRICS_WINDOW_DEFAULT,
  );

  assert.deepEqual(metrics.users.signupTrend, { days: ADMIN_TREND_DAYS, recent: 4, prior: 8 });
  assert.deepEqual(metrics.featureUsage.usageTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 5,
    prior: 2,
  });
});

test("a 7-day window narrows the series while its trend still sees the week before", () => {
  const metrics = buildAdminMetrics(
    source({
      users: {
        ...source().users,
        signupsByDay: new Map([
          // Inside the 7-day window (2026-08-11 through 2026-08-17).
          ["2026-08-17", 2],
          // Outside the window but inside the trend's prior run.
          ["2026-08-06", 5],
        ]),
      },
      usage: {
        byDay: new Map([
          ["2026-08-16", { voiceCalls: 3, attentionReviews: 1 }],
          ["2026-08-05", { voiceCalls: 2, attentionReviews: 0 }],
        ]),
        activeUsersToday: 0,
        activeUsersWindow: 1,
        topUsers: [],
      },
    }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW.WEEK,
  );

  assert.equal(metrics.windowDays, ADMIN_METRICS_WINDOW.WEEK);
  assert.equal(metrics.users.dailySignups.length, ADMIN_METRICS_WINDOW.WEEK);
  assert.equal(metrics.featureUsage.daily.length, ADMIN_METRICS_WINDOW.WEEK);
  assert.equal(metrics.users.newInWindow, 2);
  assert.equal(metrics.featureUsage.voiceCallsWindow, 3);
  assert.equal(metrics.featureUsage.attentionReviewsWindow, 1);
  assert.deepEqual(metrics.users.signupTrend, { days: ADMIN_TREND_DAYS, recent: 2, prior: 5 });
  assert.deepEqual(metrics.featureUsage.usageTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 4,
    prior: 2,
  });
});

test("a 90-day window widens the series to its own length", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW.QUARTER);
  assert.equal(metrics.windowDays, ADMIN_METRICS_WINDOW.QUARTER);
  assert.equal(metrics.users.dailySignups.length, ADMIN_METRICS_WINDOW.QUARTER);
  assert.equal(metrics.featureUsage.daily.length, ADMIN_METRICS_WINDOW.QUARTER);
});

test("a trend over an empty window is zero on both runs rather than absent", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW_DEFAULT);
  assert.deepEqual(metrics.users.signupTrend, { days: ADMIN_TREND_DAYS, recent: 0, prior: 0 });
  assert.deepEqual(metrics.featureUsage.usageTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 0,
    prior: 0,
  });
  assert.equal(metrics.users.newInWindow, 0);
});

test("a week is named by its Monday, whichever day the instant falls on", () => {
  // 2026-08-17 is itself a Monday; 2026-08-20 is the Thursday of its week.
  assert.equal(utcWeekStartKey(NOON_UTC), "2026-08-17");
  assert.equal(utcWeekStartKey(Date.parse("2026-08-20T09:00:00.000Z")), "2026-08-17");
  assert.equal(utcWeekStartKey(Date.parse("2026-08-16T23:59:59.999Z")), "2026-08-10");

  const keys = lastNWeekStartKeys(NOON_UTC, ADMIN_RETENTION_WEEKS);
  assert.equal(keys.length, ADMIN_RETENTION_WEEKS);
  assert.equal(keys[0], "2026-06-29");
  assert.equal(keys.at(-1), "2026-08-17");
});

test("retention cohorts are the trailing weeks, and unreached weeks are absent", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW_DEFAULT);
  assert.equal(metrics.retention.weeks, ADMIN_RETENTION_WEEKS);
  assert.equal(metrics.retention.cohorts.length, ADMIN_RETENTION_WEEKS);
  assert.equal(metrics.retention.cohorts[0]?.weekStart, "2026-06-29");
  assert.equal(metrics.retention.cohorts.at(-1)?.weekStart, "2026-08-17");
  // The triangle: each cohort's cells run from its own week to the current
  // one, so the oldest cohort holds every offset and the newest only Wk 0.
  for (const [index, cohort] of metrics.retention.cohorts.entries()) {
    assert.equal(cohort.cells.length, ADMIN_RETENTION_WEEKS - index);
    assert.deepEqual(
      cohort.cells.map((cell) => cell.offset),
      cohort.cells.map((_, offset) => offset),
    );
  }
});

test("a cohort's shares are its active accounts over its size, week by week", () => {
  const metrics = buildAdminMetrics(
    source({
      retention: {
        cohortSizes: new Map([["2026-06-29", 4]]),
        activeByCohortWeek: new Map([
          [
            "2026-06-29",
            new Map([
              ["2026-06-29", 4],
              ["2026-07-06", 3],
              ["2026-07-20", 1],
              // Before the cohort's own week: no cell exists to carry it.
              ["2026-06-22", 2],
            ]),
          ],
        ]),
      },
    }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW_DEFAULT,
  );

  const cohort = metrics.retention.cohorts[0];
  assert.equal(cohort?.size, 4);
  assert.deepEqual(
    cohort?.cells.map((cell) => [cell.activeAccounts, cell.share]),
    [
      [4, 1],
      [3, 0.75],
      [0, 0],
      [1, 0.25],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
});

test("only the current week's cells are in progress, in every cohort", () => {
  const metrics = buildAdminMetrics(
    source({
      retention: {
        cohortSizes: new Map([
          ["2026-06-29", 2],
          ["2026-08-17", 5],
        ]),
        activeByCohortWeek: new Map([["2026-08-17", new Map([["2026-08-17", 3]])]]),
      },
    }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW_DEFAULT,
  );

  for (const cohort of metrics.retention.cohorts) {
    const last = cohort.cells.at(-1);
    assert.equal(last?.inProgress, true);
    for (const cell of cohort.cells.slice(0, -1)) assert.equal(cell.inProgress, false);
  }
  const current = metrics.retention.cohorts.at(-1);
  assert.equal(current?.size, 5);
  assert.deepEqual(current?.cells, [
    { offset: 0, activeAccounts: 3, share: 0.6, inProgress: true },
  ]);
});

test("a cohort with no accounts keeps its count and states no share", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW_DEFAULT);
  for (const cohort of metrics.retention.cohorts) {
    assert.equal(cohort.size, 0);
    for (const cell of cohort.cells) {
      assert.equal(cell.activeAccounts, 0);
      assert.equal(cell.share, null);
    }
  }
});

test("the most active accounts pass through the builder untouched", () => {
  const topUsers = [
    {
      id: "user-9",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
      admin: false,
      activeDays: 12,
      lastActiveDay: "2026-08-17",
      voiceCalls: 3,
      attentionReviews: 40,
      total: 43,
    },
  ];
  const metrics = buildAdminMetrics(
    source({ usage: { ...source().usage, topUsers } }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.deepEqual(metrics.featureUsage.topUsers, topUsers);
});

test("the daily ceilings are reported from the hosted quota, not restated", () => {
  const metrics = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW_DEFAULT);
  assert.equal(metrics.reliability.voiceDailyLimit, HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL]);
  assert.equal(
    metrics.reliability.attentionDailyLimit,
    HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW],
  );
  assert.equal(metrics.windowDays, ADMIN_METRICS_WINDOW_DEFAULT);
  assert.equal(metrics.generatedAt, NOON_UTC);
});

test("the analytics console address rides through when configured and stays absent when not", () => {
  const configured = buildAdminMetrics(
    source({
      reliability: {
        quotaLimitedUserDaysToday: 0,
        quotaLimitedUserDaysWindow: 0,
        analyticsConsoleUrl: posthogProjectConsoleUrl("12345"),
      },
    }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.equal(configured.reliability.analyticsConsoleUrl, "https://us.posthog.com/project/12345");

  const overriddenHost = buildAdminMetrics(
    source({
      reliability: {
        quotaLimitedUserDaysToday: 0,
        quotaLimitedUserDaysWindow: 0,
        // A deployment on another region's host must link to its own console.
        analyticsConsoleUrl: posthogProjectConsoleUrl("12345", "https://eu.posthog.com/"),
      },
    }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.equal(
    overriddenHost.reliability.analyticsConsoleUrl,
    "https://eu.posthog.com/project/12345",
  );

  const absent = buildAdminMetrics(source(), NOON_UTC, ADMIN_METRICS_WINDOW_DEFAULT);
  assert.equal(absent.reliability.analyticsConsoleUrl, undefined);
});

test("integration health reads presence, in a fixed order, never a value", () => {
  const rows = adminIntegrations({
    hostedTier: true,
    analyticsRecording: false,
    analyticsErasure: false,
    googleSignIn: true,
    githubSignIn: true,
  });
  assert.equal(rows[0]?.key, ADMIN_INTEGRATION.HOSTED_TIER.key);
  assert.equal(rows[0]?.configured, true);
  assert.equal(rows[1]?.key, ADMIN_INTEGRATION.ANALYTICS_RECORDING.key);
  assert.equal(rows[1]?.configured, false);
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((row) => row.configured).length, 3);
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

function emptyMetrics(
  now: number,
  windowDays: AdminMetricsWindow = ADMIN_METRICS_WINDOW_DEFAULT,
): AdminMetrics {
  return buildAdminMetrics(source(), now, windowDays);
}

test("the gate answers 405, 401, 403, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminMetrics({
    request: metricsRequest("POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("cache-control"), "no-store");
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
  assert.equal(ok.headers.get("cache-control"), "no-store");
  // SAFETY: handleAdminMetrics answered 200, whose body is an AdminMetrics document.
  const body = (await ok.json()) as AdminMetrics;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.windowDays, ADMIN_METRICS_WINDOW_DEFAULT);
  // An unconfigured analytics project travels as absence, never a placeholder.
  assert.ok(!("analyticsConsoleUrl" in body.reliability));
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

test("the window defaults to 30 days; anything outside the set is nothing, never a guess", () => {
  assert.equal(
    adminMetricsWindow("https://luke.test/api/admin/metrics"),
    ADMIN_METRICS_WINDOW_DEFAULT,
  );
  assert.equal(
    adminMetricsWindow("https://luke.test/api/admin/metrics?window=7"),
    ADMIN_METRICS_WINDOW.WEEK,
  );
  assert.equal(
    adminMetricsWindow("https://luke.test/api/admin/metrics?window=90"),
    ADMIN_METRICS_WINDOW.QUARTER,
  );
  assert.equal(adminMetricsWindow("https://luke.test/api/admin/metrics?window=13"), undefined);
  assert.equal(adminMetricsWindow("https://luke.test/api/admin/metrics?window="), undefined);
  assert.equal(adminMetricsWindow("https://luke.test/api/admin/metrics?window=quarter"), undefined);
});

test("the handler reads metrics at the window the request asked for", async () => {
  const windows: AdminMetricsWindow[] = [];
  const readMetrics = async (
    now: number,
    _scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ): Promise<AdminMetrics> => {
    windows.push(windowDays);
    return emptyMetrics(now, windowDays);
  };
  const respond = (request: Request) =>
    handleAdminMetrics({ request, resolveViewer: async () => ADMIN_VIEWER, readMetrics });

  assert.equal((await respond(metricsRequest())).status, 200);
  const week = new Request(
    `https://luke.test/api/admin/metrics?${ADMIN_METRICS_WINDOW_PARAM}=${ADMIN_METRICS_WINDOW.WEEK}`,
  );
  const okWeek = await respond(week);
  assert.equal(okWeek.status, 200);
  // SAFETY: handleAdminMetrics answered 200, whose body is an AdminMetrics document.
  assert.equal(((await okWeek.json()) as AdminMetrics).windowDays, ADMIN_METRICS_WINDOW.WEEK);
  assert.deepEqual(windows, [ADMIN_METRICS_WINDOW_DEFAULT, ADMIN_METRICS_WINDOW.WEEK]);
});

test("a window outside the set is a 400 that reads nothing", async () => {
  let reads = 0;
  const response = await handleAdminMetrics({
    request: new Request(`https://luke.test/api/admin/metrics?${ADMIN_METRICS_WINDOW_PARAM}=13`),
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: async (now) => {
      reads += 1;
      return emptyMetrics(now);
    },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, ADMIN_ERROR.INVALID_WINDOW);
  assert.equal(reads, 0);
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
