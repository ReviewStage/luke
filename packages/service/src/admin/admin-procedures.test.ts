/**
 * admin-procedures.test.ts -- the admin dashboard's routes, byte for byte, through the hosted oRPC handler.
 *
 * The admin resource answered as the web route answers it: the gate's 503,
 * 401, and 403 before any read runs or any input is read, a method an
 * address does not answer refused, each read's own refusals before its seam
 * is touched, a failed seam a 503 logged by its kind alone, and every answer,
 * refusals included, marked `no-store`. The seams are fakes; nothing here
 * reads a database.
 *
 * Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@luke/database/core/query";
import { noDatabase } from "@luke/database/testing/no-database";
import { HOSTED_API_ERROR } from "@luke/features";
import { ADMIN_ERROR } from "@luke/features/admin-wire";
import { type Context, Effect, Layer, Logger } from "effect";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import type { AdminViewer } from "./admin-access.js";
import type { AdminCost } from "./admin-cost-wire.js";
import { buildAdminDayDetail } from "./admin-day.js";
import type { AdminMetrics } from "./admin-metrics.js";
import { type AdminProcedureSeams, adminProcedures } from "./admin-procedures.js";
import type { AdminReliability } from "./admin-reliability.js";
import type { AdminUserDetail } from "./admin-user.js";
import { buildAdminUserList } from "./admin-users.js";
import type { AdminWorkspaceList } from "./admin-workspaces.js";
import { ADMIN_USERS_SEARCH_MAX_LENGTH } from "./http.js";

const ORIGIN = "https://luke.test";
const ADMIN: AdminViewer = { userId: "admin-1", role: "admin" };
const MEMBER: AdminViewer = { userId: "user-1", role: "user" };
const JSON_TYPE = "application/json";
const NO_STORE = "no-store";

/** Words an outage's error may carry that no log line may: a credential and an account's own. */
const SECRET = "sk-admin-leaked-0123456789abcdef and the developer said ship it";

/**
 * A read's answer as the seam hands it over: the route writes it as it came,
 * so a marker object stands in for the whole answer.
 */
function answerOf<Answer>(marker: { readonly generatedAt: number }): Answer {
  // SAFETY: the route never reads the answer's fields; it writes the object it was handed.
  return marker as Answer;
}

const METRICS = answerOf<AdminMetrics>({ generatedAt: 1 });
const COST = answerOf<AdminCost>({ generatedAt: 2 });
const RELIABILITY = answerOf<AdminReliability>({ generatedAt: 3 });
const WORKSPACES = answerOf<AdminWorkspaceList>({ generatedAt: 4 });
const USER = answerOf<AdminUserDetail>({ generatedAt: 5 });

/** No signed-in browser session. */
const SIGNED_OUT = null;

/** Every seam answering, each read recording what it was asked in `asked`. */
function seams(asked: string[], viewer: AdminViewer | null = ADMIN): AdminProcedureSeams {
  const record = <Answer>(line: string, answer: Answer) =>
    Effect.sync(() => {
      asked.push(line);
      return answer;
    });
  return {
    resolveViewer: () => Effect.succeed(viewer ?? undefined),
    readMetrics: (_now, scope, windowDays) => record(`metrics ${scope} ${windowDays}`, METRICS),
    readCost: (_now, scope, windowDays) => record(`cost ${scope} ${windowDays}`, COST),
    readUsers: (now, scope, viewerId, windowDays, search) =>
      record(
        `users ${scope} ${viewerId} ${windowDays} ${search}`,
        buildAdminUserList(
          {
            total: 0,
            signIn: { accounts: 0, methods: { github: 0, google: 0, other: 0 } },
            rows: [],
          },
          now,
          windowDays,
          search,
        ),
      ),
    readUser: (userId, _now, windowDays) =>
      record(`user ${userId} ${windowDays}`, userId === "user-2" ? USER : undefined),
    readDay: (day, now, scope) =>
      record(
        `day ${day} ${scope}`,
        buildAdminDayDetail({ accounts: [], totals: { accounts: 0, calls: 0 } }, now, day),
      ),
    readWorkspaces: (_now, scope, kind, search) =>
      record(`workspaces ${scope} ${kind} ${search}`, WORKSPACES),
    readReliability: (_now, scope, windowDays) =>
      record(`reliability ${scope} ${windowDays}`, RELIABILITY),
    writeFavorite: (adminId, userId, favorite) =>
      record(`favorite ${adminId} ${userId} ${favorite}`, userId !== "gone"),
  };
}

/** The answer as it left the handler: its status, the two headers a caller reads, and its bytes. */
interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

/** One request through the admin resource over the seams handed in, every line it logs kept in `logged`. */
const send = (handed: AdminProcedureSeams, request: Request, logged: string[] = []) =>
  Effect.gen(function* () {
    const capture = Logger.make((options) => {
      logged.push(JSON.stringify(options.message), String(options.cause));
    });
    const services = yield* Effect.context<DatabaseServices>().pipe(
      Effect.provide(Layer.merge(noDatabase, Logger.layer([capture]))),
    );
    // SAFETY: the admin procedures yield the database alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    const response = yield* Effect.promise(() =>
      hostedFetch({ admin: adminProcedures(handed) })(request, webServices),
    );
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });

function request(path: string, method = "GET"): Request {
  return new Request(new URL(path, ORIGIN), { method });
}

/** A refusal's bytes, as the old group answered it. */
function refused(status: number, error: string): Bytes {
  return { status, contentType: JSON_TYPE, cacheControl: NO_STORE, text: `{"error":"${error}"}` };
}

/** A read's bytes, as the old group answered it. */
function read<Body>(body: Body): Bytes {
  return {
    status: 200,
    contentType: JSON_TYPE,
    cacheControl: NO_STORE,
    text: JSON.stringify(body),
  };
}

it.effect("the gate answers 503, 401, and 403 as distinct refusals, each no-store", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const outage = {
      ...seams(asked),
      resolveViewer: () => Effect.die(new Error("auth is down")),
    };
    assert.deepEqual(
      yield* send(outage, request("/api/admin/metrics")),
      refused(503, ADMIN_ERROR.UNAVAILABLE),
    );
    assert.deepEqual(
      yield* send(seams(asked, SIGNED_OUT), request("/api/admin/metrics")),
      refused(401, ADMIN_ERROR.NOT_SIGNED_IN),
    );
    assert.deepEqual(
      yield* send(seams(asked, MEMBER), request("/api/admin/users")),
      refused(403, ADMIN_ERROR.NOT_AUTHORIZED),
    );
    assert.deepEqual(asked, []);
  }),
);

it.effect("nothing behind the gate runs for a caller it refuses, a write included", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    for (const path of [
      "/api/admin/metrics",
      "/api/admin/cost",
      "/api/admin/reliability",
      "/api/admin/users",
      "/api/admin/user?id=user-2",
      "/api/admin/day?date=2026-10-01",
      "/api/admin/workspaces",
    ]) {
      assert.equal((yield* send(seams(asked, MEMBER), request(path))).status, 403);
    }
    for (const method of ["PUT", "DELETE"]) {
      const answer = yield* send(
        seams(asked, MEMBER),
        request("/api/admin/favorite?id=user-2", method),
      );
      assert.equal(answer.status, 403);
    }
    assert.deepEqual(asked, []);
  }),
);

it.effect(
  "the gate runs before the input is read: a non-admin's malformed query is still a 403",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* send(seams([], MEMBER), request("/api/admin/metrics?window=7&window=30")),
        refused(403, ADMIN_ERROR.NOT_AUTHORIZED),
      );
      assert.deepEqual(
        yield* send(seams([], SIGNED_OUT), request("/api/admin/metrics?window=7&window=30")),
        refused(401, ADMIN_ERROR.NOT_SIGNED_IN),
      );
    }),
);

it.effect(
  "an auth seam or a read that died is logged by its kind, and nothing its error said",
  () =>
    Effect.gen(function* () {
      const logged: string[] = [];
      const auth = yield* send(
        { ...seams([]), resolveViewer: () => Effect.die(new TypeError(SECRET)) },
        request("/api/admin/metrics"),
        logged,
      );
      assert.equal(auth.status, 503);
      const readFailed = yield* send(
        { ...seams([]), readMetrics: () => Effect.die(new RangeError(SECRET)) },
        request("/api/admin/metrics"),
        logged,
      );
      assert.deepEqual(readFailed, refused(503, ADMIN_ERROR.UNAVAILABLE));

      assert.ok(
        logged.some((line) => line.includes("TypeError")),
        logged.join("\n"),
      );
      assert.ok(
        logged.some((line) => line.includes("RangeError")),
        logged.join("\n"),
      );
      for (const line of logged) assert.ok(!line.includes(SECRET), line);
    }),
);

it.effect("a method an address does not answer is a 405, before the gate", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const methodNotAllowed: Bytes = {
      status: 405,
      contentType: JSON_TYPE,
      cacheControl: null,
      text: `{"error":"${ADMIN_ERROR.METHOD_NOT_ALLOWED}"}`,
    };
    assert.deepEqual(
      yield* send(seams(asked, SIGNED_OUT), request("/api/admin/metrics", "POST")),
      methodNotAllowed,
    );
    assert.deepEqual(
      yield* send(seams(asked), request("/api/admin/favorite", "GET")),
      methodNotAllowed,
    );
    assert.deepEqual(asked, []);
  }),
);

it.effect(
  "each read answers its seam's value as it came, no-store, at the scope and window asked",
  () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const handed = seams(asked);
      assert.deepEqual(yield* send(handed, request("/api/admin/metrics")), read(METRICS));
      assert.deepEqual(
        yield* send(handed, request("/api/admin/cost?scope=all&window=7")),
        read(COST),
      );
      assert.deepEqual(
        yield* send(handed, request("/api/admin/reliability?scope=everyone&window=7")),
        read(RELIABILITY),
      );
      assert.deepEqual(
        yield* send(handed, request("/api/admin/workspaces?kind=all&search=%20north%20")),
        read(WORKSPACES),
      );
      assert.deepEqual(
        yield* send(handed, request("/api/admin/user?id=%20user-2%20&window=90")),
        read(USER),
      );
      assert.deepEqual(asked, [
        "metrics non-admins 30",
        "cost all 7",
        "reliability non-admins 7",
        "workspaces non-admins all north",
        "user user-2 90",
      ]);
    }),
);

it.effect(
  "the roster and a day are written as the old group wrote them, an absent search left out",
  () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const roster = yield* send(seams(asked), request("/api/admin/users?window=7&scope=all"));
      assert.equal(roster.status, 200);
      assert.equal(roster.cacheControl, NO_STORE);
      assert.ok(!roster.text.includes('"search"'), roster.text);
      assert.match(
        roster.text,
        /^\{"generatedAt":\d+,"windowDays":7,"total":0,"limit":200,"signIn":/u,
      );

      const day = yield* send(seams(asked), request("/api/admin/day?date=2026-10-01"));
      assert.equal(day.status, 200);
      assert.match(
        day.text,
        /^\{"generatedAt":\d+,"day":"2026-10-01","limit":50,"totals":\{"accounts":0,"calls":0\},"accounts":\[\]\}$/u,
      );
      assert.deepEqual(asked, ["users all admin-1 7 undefined", "day 2026-10-01 non-admins"]);
    }),
);

it.effect("each read refuses its own malformed query before its seam is touched", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const handed = seams(asked);
    const tooLong = "w".repeat(ADMIN_USERS_SEARCH_MAX_LENGTH + 1);
    const cases: readonly [string, Bytes][] = [
      ["/api/admin/metrics?window=12", refused(400, ADMIN_ERROR.INVALID_WINDOW)],
      ["/api/admin/cost?window=12", refused(400, ADMIN_ERROR.INVALID_WINDOW)],
      ["/api/admin/reliability?window=90", refused(400, ADMIN_ERROR.INVALID_WINDOW)],
      ["/api/admin/users?window=12", refused(400, ADMIN_ERROR.INVALID_WINDOW)],
      [`/api/admin/users?search=${tooLong}`, refused(400, ADMIN_ERROR.INVALID_SEARCH)],
      [`/api/admin/workspaces?search=${tooLong}`, refused(400, ADMIN_ERROR.INVALID_SEARCH)],
      ["/api/admin/user", refused(400, ADMIN_ERROR.MISSING_USER_ID)],
      ["/api/admin/user?id=%20", refused(400, ADMIN_ERROR.MISSING_USER_ID)],
      ["/api/admin/user?id=user-2&window=12", refused(400, ADMIN_ERROR.INVALID_WINDOW)],
      ["/api/admin/day", refused(400, ADMIN_ERROR.INVALID_DAY)],
      ["/api/admin/day?date=2026-02-30", refused(400, ADMIN_ERROR.INVALID_DAY)],
    ];
    for (const [path, expected] of cases) {
      assert.deepEqual(yield* send(handed, request(path)), expected, path);
    }
    assert.deepEqual(asked, []);
  }),
);

it.effect("an account no user row carries is a 404, after the read", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    assert.deepEqual(
      yield* send(seams(asked), request("/api/admin/user?id=gone")),
      refused(404, ADMIN_ERROR.USER_NOT_FOUND),
    );
    assert.deepEqual(asked, ["user gone 30"]);
  }),
);

it.effect("the star is set by PUT and taken back by DELETE, for the signed-in admin alone", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const handed = seams(asked);
    assert.deepEqual(
      yield* send(handed, request("/api/admin/favorite?id=user-2", "PUT")),
      read({ favorite: true }),
    );
    assert.deepEqual(
      yield* send(handed, request("/api/admin/favorite?id=user-2&adminId=user-9", "DELETE")),
      read({ favorite: false }),
    );
    assert.deepEqual(
      yield* send(handed, request("/api/admin/favorite?id=gone", "PUT")),
      refused(404, ADMIN_ERROR.USER_NOT_FOUND),
    );
    assert.deepEqual(
      yield* send(handed, request("/api/admin/favorite", "DELETE")),
      refused(400, ADMIN_ERROR.MISSING_USER_ID),
    );
    assert.deepEqual(asked, [
      "favorite admin-1 user-2 true",
      "favorite admin-1 user-2 false",
      "favorite admin-1 gone true",
    ]);
  }),
);

it.effect(
  "behavior change: a query key named twice is refused as an invalid request, where the old group read the first",
  () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      assert.deepEqual(
        yield* send(seams(asked), request("/api/admin/metrics?window=7&window=30")),
        refused(400, HOSTED_API_ERROR.INVALID_REQUEST),
      );
      assert.deepEqual(asked, []);
    }),
);
