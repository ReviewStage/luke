import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_DAY_ACCOUNTS_LIMIT,
  type AdminDayDetail,
  type AdminDaySource,
  buildAdminDayDetail,
  handleAdminDay,
} from "../server/admin/admin-day";
import type { AdminMetricsScope } from "../server/admin/http";
import {
  ADMIN_DAY_PARAM,
  ADMIN_ERROR,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  adminDayKey,
  isUtcDayKey,
} from "../server/admin/http";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");
const DAY = "2026-08-14";

function daySource(overrides: Partial<AdminDaySource> = {}): AdminDaySource {
  return {
    accounts: [
      {
        id: "user-9",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
        admin: false,
        voiceCalls: 24,
        attentionReviews: 12,
        total: 36,
      },
      {
        id: "user-3",
        name: "Grace Hopper",
        email: "grace@example.com",
        image: null,
        admin: false,
        voiceCalls: 1,
        attentionReviews: 3,
        total: 4,
      },
    ],
    totals: { accounts: 2, voiceCalls: 25, attentionReviews: 15 },
    ...overrides,
  };
}

test("the builder stamps the day and bound, and totals fold from the day's own sums", () => {
  const detail = buildAdminDayDetail(daySource(), NOON_UTC, DAY);
  assert.equal(detail.generatedAt, NOON_UTC);
  assert.equal(detail.day, DAY);
  assert.equal(detail.limit, ADMIN_DAY_ACCOUNTS_LIMIT);
  assert.deepEqual(detail.totals, { accounts: 2, voiceCalls: 25, attentionReviews: 15, total: 40 });
  assert.deepEqual(detail.accounts, [...daySource().accounts]);
});

test("a day key is a real UTC calendar day or nothing", () => {
  assert.equal(isUtcDayKey("2026-08-14"), true);
  assert.equal(isUtcDayKey("2024-02-29"), true);
  assert.equal(isUtcDayKey("2026-02-29"), false);
  assert.equal(isUtcDayKey("2026-02-30"), false);
  assert.equal(isUtcDayKey("2026-13-01"), false);
  assert.equal(isUtcDayKey("2026-00-14"), false);
  assert.equal(isUtcDayKey("2026-08-00"), false);
  assert.equal(isUtcDayKey("2026-08-32"), false);
  assert.equal(isUtcDayKey("2026-8-14"), false);
  assert.equal(isUtcDayKey("20260814"), false);
  assert.equal(isUtcDayKey("2026-08-14T00:00:00.000Z"), false);
  assert.equal(isUtcDayKey(""), false);
  assert.equal(isUtcDayKey("yesterday"), false);
});

test("a day is read bounded from the query, or not at all", () => {
  assert.equal(adminDayKey(`https://luke.test/api/admin/day?date=${DAY}`), DAY);
  assert.equal(adminDayKey("https://luke.test/api/admin/day?date=2026-02-30"), undefined);
  assert.equal(adminDayKey("https://luke.test/api/admin/day?date="), undefined);
  assert.equal(adminDayKey("https://luke.test/api/admin/day"), undefined);
});

function dayRequest(day: string | null = DAY, method = "GET", scope?: string): Request {
  const params = new URLSearchParams();
  if (day !== null) params.set(ADMIN_DAY_PARAM, day);
  if (scope !== undefined) params.set(ADMIN_METRICS_SCOPE_PARAM, scope);
  const query = params.toString();
  return new Request(`https://luke.test/api/admin/day${query ? `?${query}` : ""}`, { method });
}

const ADMIN_VIEWER: AdminViewer = { userId: "user-1", role: "admin" };

const readDay = async (
  day: string,
  now: number,
  _scope: AdminMetricsScope,
): Promise<AdminDayDetail> => buildAdminDayDetail(daySource(), now, day);

test("the gate answers 405, 401, 403, 400, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminDay({
    request: dayRequest(DAY, "POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay,
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("cache-control"), "no-store");

  const anonymous = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => undefined,
    readDay,
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => ({ ...ADMIN_VIEWER, role: "user" }),
    readDay,
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  const unnamed = await handleAdminDay({
    request: dayRequest(null),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay,
  });
  assert.equal(unnamed.status, 400);
  assert.equal((await unnamed.json()).error, ADMIN_ERROR.INVALID_DAY);

  const unreal = await handleAdminDay({
    request: dayRequest("2026-02-30"),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay,
  });
  assert.equal(unreal.status, 400);
  assert.equal((await unreal.json()).error, ADMIN_ERROR.INVALID_DAY);

  const ok = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay,
    now: () => NOON_UTC,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  // SAFETY: handleAdminDay answered 200, whose body is an AdminDayDetail document.
  const body = (await ok.json()) as AdminDayDetail;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.day, DAY);
  assert.equal(body.totals.total, 40);
});

test("the day is read at the scope the request asked for, defaulting to non-admins", async () => {
  const scopes: AdminMetricsScope[] = [];
  const countingRead = async (day: string, now: number, scope: AdminMetricsScope) => {
    scopes.push(scope);
    return readDay(day, now, scope);
  };
  const respond = (scope?: string) =>
    handleAdminDay({
      request: dayRequest(DAY, "GET", scope),
      resolveViewer: async () => ADMIN_VIEWER,
      readDay: countingRead,
    });

  assert.equal((await respond()).status, 200);
  assert.equal((await respond(ADMIN_METRICS_SCOPE.ALL)).status, 200);
  assert.equal((await respond("everyone")).status, 200);
  assert.deepEqual(scopes, [
    ADMIN_METRICS_SCOPE.NON_ADMINS,
    ADMIN_METRICS_SCOPE.ALL,
    ADMIN_METRICS_SCOPE.NON_ADMINS,
  ]);
});

test("no day is read for a request that fails the gate or names no real day", async () => {
  const reads: string[] = [];
  const countingRead = async (day: string, now: number, scope: AdminMetricsScope) => {
    reads.push(day);
    return readDay(day, now, scope);
  };

  const anonymous = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => undefined,
    readDay: countingRead,
  });
  assert.equal(anonymous.status, 401);

  const unreal = await handleAdminDay({
    request: dayRequest("2026-13-01"),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay: countingRead,
  });
  assert.equal(unreal.status, 400);
  assert.deepEqual(reads, []);

  const ok = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay: countingRead,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(reads, [DAY]);
});

test("a quiet day is an ordinary answer with empty rows, never a 404", async () => {
  const response = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay: async (day, now) =>
      buildAdminDayDetail(
        { accounts: [], totals: { accounts: 0, voiceCalls: 0, attentionReviews: 0 } },
        now,
        day,
      ),
  });
  assert.equal(response.status, 200);
  // SAFETY: handleAdminDay answered 200, whose body is an AdminDayDetail document.
  const body = (await response.json()) as AdminDayDetail;
  assert.deepEqual(body.accounts, []);
  assert.deepEqual(body.totals, { accounts: 0, voiceCalls: 0, attentionReviews: 0, total: 0 });
});

test("a seam that throws is a 503 refusal rather than a crash", async () => {
  const viewerThrew = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => {
      throw new Error("auth is down");
    },
    readDay,
  });
  assert.equal(viewerThrew.status, 503);
  assert.equal((await viewerThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const readThrew = await handleAdminDay({
    request: dayRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readDay: async () => {
      throw new Error("database is down");
    },
  });
  assert.equal(readThrew.status, 503);
  assert.equal((await readThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);
});
