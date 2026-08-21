import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import { ADMIN_METRICS_WINDOW_DAYS } from "../server/admin/admin-metrics";
import {
  ADMIN_USERS_LIMIT,
  type AdminUserList,
  type AdminUserListSource,
  buildAdminUserList,
  handleAdminUsers,
} from "../server/admin/admin-users";
import {
  ADMIN_ERROR,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  type AdminMetricsScope,
} from "../server/admin/http";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

const ROW = {
  id: "user-9",
  name: "Ada Lovelace",
  email: "ada@example.com",
  admin: false,
  createdAt: Date.parse("2026-06-01T08:00:00.000Z"),
  activeDays: 12,
  lastActiveDay: "2026-08-17",
  lastSeenAt: Date.parse("2026-08-17T09:30:00.000Z"),
  voiceCalls: 120,
  attentionReviews: 400,
  favorite: false,
};

function listSource(overrides: Partial<AdminUserListSource> = {}): AdminUserListSource {
  return { total: 1, rows: [ROW], ...overrides };
}

test("the roster is stamped with the window its aggregates cover", () => {
  const list = buildAdminUserList(listSource({ total: 340 }), NOON_UTC);
  assert.equal(list.generatedAt, NOON_UTC);
  assert.equal(list.windowDays, ADMIN_METRICS_WINDOW_DAYS);
  assert.equal(list.limit, ADMIN_USERS_LIMIT);
  assert.equal(list.total, 340);
  assert.deepEqual(list.rows, [ROW]);
});

function usersRequest(method = "GET", query = ""): Request {
  return new Request(`https://luke.test/api/admin/users${query}`, { method });
}

const ADMIN_VIEWER: AdminViewer = { userId: "user-1", role: "admin" };

const readUsers = async (now: number): Promise<AdminUserList> =>
  buildAdminUserList(listSource(), now);

test("the gate answers 405, 401, 403, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminUsers({
    request: usersRequest("POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readUsers,
  });
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => undefined,
    readUsers,
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => ({ ...ADMIN_VIEWER, role: "user" }),
    readUsers,
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  const ok = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readUsers,
    now: () => NOON_UTC,
  });
  assert.equal(ok.status, 200);
  // SAFETY: handleAdminUsers answered 200, whose body is an AdminUserList document.
  const body = (await ok.json()) as AdminUserList;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.rows[0]?.id, "user-9");
});

test("the roster is read at the scope the request asked for, as the viewer, and not past a failed gate", async () => {
  const scopes: AdminMetricsScope[] = [];
  const viewerIds: string[] = [];
  const countingRead = async (
    now: number,
    scope: AdminMetricsScope,
    viewerId: string,
  ): Promise<AdminUserList> => {
    scopes.push(scope);
    viewerIds.push(viewerId);
    return readUsers(now);
  };
  const respond = (request: Request) =>
    handleAdminUsers({ request, resolveViewer: async () => ADMIN_VIEWER, readUsers: countingRead });

  assert.equal((await respond(usersRequest())).status, 200);
  const widened = usersRequest("GET", `?${ADMIN_METRICS_SCOPE_PARAM}=${ADMIN_METRICS_SCOPE.ALL}`);
  assert.equal((await respond(widened)).status, 200);
  assert.deepEqual(scopes, [ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_METRICS_SCOPE.ALL]);
  assert.deepEqual(viewerIds, [ADMIN_VIEWER.userId, ADMIN_VIEWER.userId]);

  const gated = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => undefined,
    readUsers: countingRead,
  });
  assert.equal(gated.status, 401);
  assert.equal(scopes.length, 2);
});

test("a seam that throws is a 503 refusal rather than a crash", async () => {
  const viewerThrew = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => {
      throw new Error("auth is down");
    },
    readUsers,
  });
  assert.equal(viewerThrew.status, 503);
  assert.equal((await viewerThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const readThrew = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => ADMIN_VIEWER,
    readUsers: async () => {
      throw new Error("database is down");
    },
  });
  assert.equal(readThrew.status, 503);
  assert.equal((await readThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);
});
