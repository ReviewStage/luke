import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import {
  ADMIN_USERS_LIMIT,
  type AdminUserList,
  type AdminUserListSource,
  buildAdminUserList,
  handleAdminUsers,
  lastSeenInstant,
  searchLikePattern,
} from "../server/admin/admin-users";
import {
  ADMIN_ERROR,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  ADMIN_USERS_SEARCH_PARAM,
  type AdminMetricsScope,
  type AdminMetricsWindow,
} from "../server/admin/http";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

const ROW = {
  id: "user-9",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
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
  const list = buildAdminUserList(
    listSource({ total: 340 }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW.MONTH,
    undefined,
  );
  assert.equal(list.generatedAt, NOON_UTC);
  assert.equal(list.windowDays, ADMIN_METRICS_WINDOW.MONTH);
  assert.equal(list.limit, ADMIN_USERS_LIMIT);
  assert.equal(list.total, 340);
  assert.equal(list.search, undefined);
  assert.deepEqual(list.rows, [ROW]);

  const quarter = buildAdminUserList(
    listSource(),
    NOON_UTC,
    ADMIN_METRICS_WINDOW.QUARTER,
    undefined,
  );
  assert.equal(quarter.windowDays, ADMIN_METRICS_WINDOW.QUARTER);
});

test("a searched roster echoes the term its rows and total were filtered by", () => {
  const searched = buildAdminUserList(
    listSource({ total: 3 }),
    NOON_UTC,
    ADMIN_METRICS_WINDOW.MONTH,
    "ada",
  );
  assert.equal(searched.search, "ada");
  assert.equal(searched.total, 3);
  assert.equal(searched.limit, ADMIN_USERS_LIMIT);
  assert.deepEqual(searched.rows, [ROW]);
});

test("last seen is the freshest of the session write and the last usage day", () => {
  const agingSessionWrite = new Date("2026-08-10T09:30:00.000Z");
  // Desktop activity rides bearer tokens that never touch a session row, so a
  // later usage day must win: this is what keeps the roster's "Last seen"
  // from trailing the account page's "Last active".
  assert.equal(
    lastSeenInstant(agingSessionWrite, "2026-08-17"),
    Date.parse("2026-08-17T00:00:00.000Z"),
  );
  const freshSessionWrite = new Date("2026-08-17T09:30:00.000Z");
  assert.equal(lastSeenInstant(freshSessionWrite, "2026-08-17"), freshSessionWrite.getTime());
  assert.equal(lastSeenInstant(agingSessionWrite, null), agingSessionWrite.getTime());
  assert.equal(lastSeenInstant(null, "2026-08-17"), Date.parse("2026-08-17T00:00:00.000Z"));
  assert.equal(lastSeenInstant(null, null), null);
});

test("a search pattern matches the term literally, wildcards escaped", () => {
  assert.equal(searchLikePattern("ada"), "%ada%");
  assert.equal(searchLikePattern("100%"), "%100\\%%");
  assert.equal(searchLikePattern("a_b"), "%a\\_b%");
  assert.equal(searchLikePattern("back\\slash"), "%back\\\\slash%");
  assert.equal(searchLikePattern("%_\\"), "%\\%\\_\\\\%");
});

function usersRequest(method = "GET", query = ""): Request {
  return new Request(`https://luke.test/api/admin/users${query}`, { method });
}

const ADMIN_VIEWER: AdminViewer = { userId: "user-1", role: "admin" };

const readUsers = async (now: number): Promise<AdminUserList> =>
  buildAdminUserList(listSource(), now, ADMIN_METRICS_WINDOW_DEFAULT, undefined);

test("the gate answers 405, 401, 403, and 200 as distinct outcomes", async () => {
  const wrongMethod = await handleAdminUsers({
    request: usersRequest("POST"),
    resolveViewer: async () => ADMIN_VIEWER,
    readUsers,
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("cache-control"), "no-store");

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
  assert.equal(ok.headers.get("cache-control"), "no-store");
  // SAFETY: handleAdminUsers answered 200, whose body is an AdminUserList document.
  const body = (await ok.json()) as AdminUserList;
  assert.equal(body.generatedAt, NOON_UTC);
  assert.equal(body.rows[0]?.id, "user-9");
});

test("the roster is read at the scope and window the request asked for, as the viewer, and not past a failed gate", async () => {
  const scopes: AdminMetricsScope[] = [];
  const viewerIds: string[] = [];
  const windows: AdminMetricsWindow[] = [];
  const countingRead = async (
    now: number,
    scope: AdminMetricsScope,
    viewerId: string,
    windowDays: AdminMetricsWindow,
    search: string | undefined,
  ): Promise<AdminUserList> => {
    scopes.push(scope);
    viewerIds.push(viewerId);
    windows.push(windowDays);
    return buildAdminUserList(listSource(), now, windowDays, search);
  };
  const respond = (request: Request) =>
    handleAdminUsers({ request, resolveViewer: async () => ADMIN_VIEWER, readUsers: countingRead });

  assert.equal((await respond(usersRequest())).status, 200);
  const widened = usersRequest("GET", `?${ADMIN_METRICS_SCOPE_PARAM}=${ADMIN_METRICS_SCOPE.ALL}`);
  assert.equal((await respond(widened)).status, 200);
  const week = usersRequest("GET", `?${ADMIN_METRICS_WINDOW_PARAM}=${ADMIN_METRICS_WINDOW.WEEK}`);
  const okWeek = await respond(week);
  assert.equal(okWeek.status, 200);
  // SAFETY: handleAdminUsers answered 200, whose body is an AdminUserList document.
  assert.equal(((await okWeek.json()) as AdminUserList).windowDays, ADMIN_METRICS_WINDOW.WEEK);
  assert.deepEqual(scopes, [
    ADMIN_METRICS_SCOPE.NON_ADMINS,
    ADMIN_METRICS_SCOPE.ALL,
    ADMIN_METRICS_SCOPE.NON_ADMINS,
  ]);
  assert.deepEqual(viewerIds, [ADMIN_VIEWER.userId, ADMIN_VIEWER.userId, ADMIN_VIEWER.userId]);
  assert.deepEqual(windows, [
    ADMIN_METRICS_WINDOW_DEFAULT,
    ADMIN_METRICS_WINDOW_DEFAULT,
    ADMIN_METRICS_WINDOW.WEEK,
  ]);

  const gated = await handleAdminUsers({
    request: usersRequest(),
    resolveViewer: async () => undefined,
    readUsers: countingRead,
  });
  assert.equal(gated.status, 401);
  assert.equal(scopes.length, 3);

  const invalid = await respond(usersRequest("GET", `?${ADMIN_METRICS_WINDOW_PARAM}=13`));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, ADMIN_ERROR.INVALID_WINDOW);
  assert.equal(scopes.length, 3);
});

test("the roster is searched by the term the request carried, trimmed, and only a real one", async () => {
  const searches: (string | undefined)[] = [];
  const countingRead = async (
    now: number,
    _scope: AdminMetricsScope,
    _viewerId: string,
    windowDays: AdminMetricsWindow,
    search: string | undefined,
  ): Promise<AdminUserList> => {
    searches.push(search);
    return buildAdminUserList(listSource({ total: 3 }), now, windowDays, search);
  };
  const respond = (query: string) =>
    handleAdminUsers({
      request: usersRequest("GET", query),
      resolveViewer: async () => ADMIN_VIEWER,
      readUsers: countingRead,
    });

  const searched = await respond(`?${ADMIN_USERS_SEARCH_PARAM}=${encodeURIComponent(" Ada ")}`);
  assert.equal(searched.status, 200);
  // SAFETY: handleAdminUsers answered 200, whose body is an AdminUserList document.
  const body = (await searched.json()) as AdminUserList;
  assert.equal(body.search, "Ada");
  assert.equal(body.total, 3);

  assert.equal((await respond("")).status, 200);
  assert.equal((await respond(`?${ADMIN_USERS_SEARCH_PARAM}=`)).status, 200);
  assert.equal(
    (await respond(`?${ADMIN_USERS_SEARCH_PARAM}=${encodeURIComponent("   ")}`)).status,
    200,
  );
  assert.deepEqual(searches, ["Ada", undefined, undefined, undefined]);
});

test("a term past the length bound is a 400 refusal that reaches no read", async () => {
  let reads = 0;
  const countingRead = async (now: number): Promise<AdminUserList> => {
    reads += 1;
    return buildAdminUserList(listSource(), now, ADMIN_METRICS_WINDOW_DEFAULT, undefined);
  };
  const respond = (term: string) =>
    handleAdminUsers({
      request: usersRequest("GET", `?${ADMIN_USERS_SEARCH_PARAM}=${encodeURIComponent(term)}`),
      resolveViewer: async () => ADMIN_VIEWER,
      readUsers: countingRead,
    });

  const atBound = await respond("a".repeat(ADMIN_USERS_SEARCH_MAX_LENGTH));
  assert.equal(atBound.status, 200);
  assert.equal(reads, 1);

  const pastBound = await respond("a".repeat(ADMIN_USERS_SEARCH_MAX_LENGTH + 1));
  assert.equal(pastBound.status, 400);
  assert.equal((await pastBound.json()).error, ADMIN_ERROR.INVALID_SEARCH);
  assert.equal(reads, 1);
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
