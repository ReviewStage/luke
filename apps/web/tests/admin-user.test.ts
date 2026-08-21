import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_METRICS_WINDOW_DAYS,
  ADMIN_TREND_DAYS,
  type AdminUsageDay,
  lastNDayKeys,
} from "../server/admin/admin-metrics";
import {
  type AdminUserDetail,
  type AdminUserSource,
  buildAdminUserDetail,
  handleAdminUser,
} from "../server/admin/admin-user";
import { ADMIN_ERROR, ADMIN_USER_ID_PARAM, adminUserId } from "../server/admin/http";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

function userSource(usage: Partial<AdminUserSource["usage"]> = {}): AdminUserSource {
  return {
    account: {
      id: "user-9",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
      admin: false,
      createdAt: Date.parse("2026-06-01T08:00:00.000Z"),
      signInMethods: ["github"],
    },
    usage: {
      byDay: new Map(),
      allTime: {
        activeDays: 0,
        firstActiveDay: null,
        lastActiveDay: null,
        voiceCalls: 0,
        attentionReviews: 0,
      },
      quotaLimitedDaysWindow: 0,
      ...usage,
    },
  };
}

function build(usage: Partial<AdminUserSource["usage"]> = {}): AdminUserDetail {
  return buildAdminUserDetail(userSource(usage), NOON_UTC);
}

test("the daily series is zero-filled and the window counts fold from it", () => {
  const detail = build({
    byDay: new Map([
      ["2026-08-17", { voiceCalls: 2, attentionReviews: 1 }],
      ["2026-08-10", { voiceCalls: 5, attentionReviews: 0 }],
      ["2026-07-19", { voiceCalls: 0, attentionReviews: 7 }],
    ]),
  });

  assert.equal(detail.windowDays, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(detail.activity.daily.length, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(detail.activity.activeDaysWindow, 3);
  assert.equal(detail.activity.voiceCallsWindow, 7);
  assert.equal(detail.activity.attentionReviewsWindow, 8);
  const emptyDay = detail.activity.daily.find((day) => day.day === "2026-08-01");
  assert.deepEqual(emptyDay, { day: "2026-08-01", voiceCalls: 0, attentionReviews: 0 });
});

test("a streak ending today counts back to its first gap", () => {
  const detail = build({
    byDay: new Map([
      ["2026-08-17", { voiceCalls: 1, attentionReviews: 0 }],
      ["2026-08-16", { voiceCalls: 1, attentionReviews: 0 }],
      ["2026-08-15", { voiceCalls: 0, attentionReviews: 3 }],
      // 2026-08-14 is the gap; this day must not extend the streak.
      ["2026-08-13", { voiceCalls: 9, attentionReviews: 9 }],
    ]),
  });
  assert.equal(detail.activity.currentStreakDays, 3);
});

test("a quiet today does not break a streak that ran through yesterday", () => {
  const detail = build({
    byDay: new Map([
      ["2026-08-16", { voiceCalls: 1, attentionReviews: 0 }],
      ["2026-08-15", { voiceCalls: 1, attentionReviews: 0 }],
    ]),
  });
  assert.equal(detail.activity.currentStreakDays, 2);
});

test("a streak broken before yesterday is over, whatever came earlier", () => {
  const detail = build({
    byDay: new Map([
      ["2026-08-14", { voiceCalls: 1, attentionReviews: 0 }],
      ["2026-08-13", { voiceCalls: 1, attentionReviews: 0 }],
    ]),
  });
  assert.equal(detail.activity.currentStreakDays, 0);
});

test("a streak covering the whole window reports the window's length", () => {
  const byDay = new Map<string, AdminUsageDay>(
    lastNDayKeys(NOON_UTC, ADMIN_METRICS_WINDOW_DAYS).map((day) => [
      day,
      { voiceCalls: 1, attentionReviews: 0 },
    ]),
  );
  const detail = build({ byDay });
  assert.equal(detail.activity.currentStreakDays, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(detail.activity.activeDaysWindow, ADMIN_METRICS_WINDOW_DAYS);
});

test("the active-days trend counts days present, not volume spent", () => {
  const detail = build({
    byDay: new Map([
      // The recent run is 2026-08-11 through 2026-08-17; one loud day cannot
      // outweigh two quiet ones the week before.
      ["2026-08-16", { voiceCalls: 500, attentionReviews: 500 }],
      ["2026-08-09", { voiceCalls: 1, attentionReviews: 0 }],
      ["2026-08-07", { voiceCalls: 1, attentionReviews: 0 }],
    ]),
  });
  assert.deepEqual(detail.activity.activeDaysTrend, {
    days: ADMIN_TREND_DAYS,
    recent: 1,
    prior: 2,
  });
});

test("the account and its all-time history pass through untouched", () => {
  const allTime = {
    activeDays: 41,
    firstActiveDay: "2026-06-02",
    lastActiveDay: "2026-08-17",
    voiceCalls: 120,
    attentionReviews: 900,
  };
  const detail = build({ allTime, quotaLimitedDaysWindow: 2 });
  assert.equal(detail.generatedAt, NOON_UTC);
  assert.deepEqual(detail.account, userSource().account);
  assert.deepEqual(detail.activity.allTime, allTime);
  assert.equal(detail.activity.quotaLimitedDaysWindow, 2);
});

test("an account id is read bounded from the query, or not at all", () => {
  assert.equal(adminUserId("https://luke.test/api/admin/user?id=user-9"), "user-9");
  assert.equal(adminUserId("https://luke.test/api/admin/user?id=%20user-9%20"), "user-9");
  assert.equal(adminUserId("https://luke.test/api/admin/user"), undefined);
  assert.equal(adminUserId("https://luke.test/api/admin/user?id="), undefined);
  assert.equal(adminUserId(`https://luke.test/api/admin/user?id=${"x".repeat(129)}`), undefined);
});

function userRequest(id: string | null = "user-9", method = "GET"): Request {
  const query = id === null ? "" : `?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`;
  return new Request(`https://luke.test/api/admin/user${query}`, { method });
}

const ADMIN_VIEWER: AdminViewer = { userId: "user-1", role: "admin" };

const readUser = async (userId: string, now: number): Promise<AdminUserDetail | undefined> =>
  userId === "user-9" ? buildAdminUserDetail(userSource(), now) : undefined;

test("the gate answers 405, 401, 403, 400, 404, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminUser({
    request: userRequest("user-9", "POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser,
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("cache-control"), "no-store");

  const anonymous = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => undefined,
    readUser,
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => ({ ...ADMIN_VIEWER, role: "user" }),
    readUser,
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  const unnamed = await handleAdminUser({
    request: userRequest(null),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser,
  });
  assert.equal(unnamed.status, 400);
  assert.equal((await unnamed.json()).error, ADMIN_ERROR.MISSING_USER_ID);

  const missing = await handleAdminUser({
    request: userRequest("user-gone"),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser,
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, ADMIN_ERROR.USER_NOT_FOUND);

  const ok = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser,
    now: () => NOON_UTC,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  // SAFETY: handleAdminUser answered 200, whose body is an AdminUserDetail document.
  const body = (await ok.json()) as AdminUserDetail;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.account.id, "user-9");
});

test("no account is read for a request that fails the gate or names none", async () => {
  const reads: string[] = [];
  const countingRead = async (userId: string, now: number) => {
    reads.push(userId);
    return readUser(userId, now);
  };

  const anonymous = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => undefined,
    readUser: countingRead,
  });
  assert.equal(anonymous.status, 401);

  const unnamed = await handleAdminUser({
    request: userRequest(null),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser: countingRead,
  });
  assert.equal(unnamed.status, 400);
  assert.deepEqual(reads, []);

  const ok = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser: countingRead,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(reads, ["user-9"]);
});

test("a seam that throws is a 503 refusal rather than a crash", async () => {
  const viewerThrew = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => {
      throw new Error("auth is down");
    },
    readUser,
  });
  assert.equal(viewerThrew.status, 503);
  assert.equal((await viewerThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const readThrew = await handleAdminUser({
    request: userRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readUser: async () => {
      throw new Error("database is down");
    },
  });
  assert.equal(readThrew.status, 503);
  assert.equal((await readThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);
});
