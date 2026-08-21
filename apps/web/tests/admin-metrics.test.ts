import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_INTEGRATION,
  ADMIN_METRICS_WINDOW_DAYS,
  adminIntegrations,
  type AdminMetrics,
  type AdminMetricsSource,
  buildAdminMetrics,
  handleAdminMetrics,
  lastNDayKeys,
} from "../server/admin/admin-metrics";
import { ADMIN_ERROR } from "../server/admin/http";
import { HOSTED_DAILY_LIMIT, HOSTED_METER } from "../server/hosted/quota";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

function source(overrides: Partial<AdminMetricsSource> = {}): AdminMetricsSource {
  return {
    users: {
      total: 0,
      newLast7Days: 0,
      newLast30Days: 0,
      activeSessions: 0,
      activeSessionUsers: 0,
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, topUsers: [] },
    reliability: { quotaLimitedUserDaysToday: 0, quotaLimitedUserDaysWindow: 0 },
    systemHealth: { database: { reachable: true, latencyMs: 4 }, integrations: [] },
    ...overrides,
  };
}

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
  for (const row of rows) {
    assert.equal(typeof row.configured, "boolean");
    assert.ok(row.label.length > 0);
  }
});

function metricsRequest(method = "GET"): Request {
  return new Request("https://luke.test/api/admin/metrics", { method });
}

const ADMIN_VIEWER: AdminViewer = {
  userId: "user-1",
  email: "dean@example.com",
  githubAccountIds: ["29683763"],
};

function emptyMetrics(now: number): AdminMetrics {
  return buildAdminMetrics(source(), now);
}

test("the gate answers 405, 401, 403, and 200 as three distinct outcomes", async () => {
  const wrongMethod = await handleAdminMetrics({
    request: metricsRequest("POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    isAdmin: () => true,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, ADMIN_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => undefined,
    isAdmin: () => true,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => ({ ...ADMIN_VIEWER, githubAccountIds: [], email: "x@example.com" }),
    isAdmin: () => false,
    readMetrics: async (now) => emptyMetrics(now),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  let readFor: string | undefined;
  const ok = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    isAdmin: (viewer) => {
      readFor = viewer.userId;
      return true;
    },
    readMetrics: async (now) => emptyMetrics(now),
    now: () => NOON_UTC,
  });
  assert.equal(ok.status, 200);
  assert.equal(readFor, "user-1");
  const body = (await ok.json()) as AdminMetrics;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.windowDays, ADMIN_METRICS_WINDOW_DAYS);
});

test("metrics are not read for a request that fails the gate", async () => {
  let reads = 0;
  const response = await handleAdminMetrics({
    request: metricsRequest(),
    resolveViewer: async () => undefined,
    isAdmin: () => true,
    readMetrics: async (now) => {
      reads += 1;
      return emptyMetrics(now);
    },
  });
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});
