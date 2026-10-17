import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { auth } from "@luke/service/auth/auth";
import { requestUserId, resolveHostedUserId } from "@luke/service/auth/bearer";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  type UserIdResolver,
} from "@luke/service/http/http-effect";
import { ANY_METHOD } from "@luke/service/route";
import { openWorkspacePlugin } from "@luke/service/testing/workspace-plugin";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { afterEach, beforeEach, vi } from "vitest";
import { routeFromHttpRouter } from "../server/route-effect.js";
import macCommandsRoute from "../server/routes/mac-commands.js";
import { disposeWebRuntime } from "../server/runtime.js";

/**
 * A browser's session cookie on the hosted routes, through the adaptor every
 * function exports its routes through: a read names the cookie's account
 * from any page, a write names it only from one of the deployment's own
 * pages, since the adaptor's origin guard refuses any other before a route
 * reads the cookie, and an `Authorization` beside the cookie that does not
 * verify names nobody. The Mac's commands route takes the Mac's bearer
 * alone, so a cookie every account route takes is refused there.
 *
 * The cookie is Better Auth's over a PGlite of its own; the userinfo
 * endpoint, which no request here satisfies, refuses every bearer.
 * Synthetic accounts and sessions throughout.
 */

/**
 * The web runtime's layer names a database, so building it needs a
 * connection string; this one is never dialled, as in `route-effect.test.ts`.
 */
const PLACEHOLDER_DATABASE_URL = "postgresql://route:effect@127.0.0.1:5432/luke";

/** The deployment's own origin, which the guard reads from the address production registers. */
const OWN_ORIGIN = "https://luke.test";
const FOREIGN_ORIGIN = "https://evil.example";
const ACCOUNT_PATH = "/api/account-under-test";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", OWN_ORIGIN);
  // The guard says what it refused at warn; the suite keeps those lines off its own output.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** One account signed in on a browser of its own, on Better Auth over its own PGlite. */
const openSignedIn = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
  ).pipe(Effect.provide(plugin.database));
  const resolveUserId: UserIdResolver = (request) =>
    requestUserId(request, () => Effect.succeed(undefined), plugin.resolveSessionUserId);
  return { plugin, userId, cookie: yield* plugin.sessionCookieOf(userId), resolveUserId };
});

/** A route whose one path answers the account its request names, or refuses it as unauthenticated. */
function accountRoute(resolveUserId: UserIdResolver) {
  return routeFromHttpRouter(
    Layer.mergeAll(
      HttpRouter.add(
        ANY_METHOD,
        ACCOUNT_PATH,
        hostedRefusing(
          Effect.gen(function* () {
            const incoming = yield* HttpServerRequest.HttpServerRequest;
            const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
            const account = yield* resolveUserId(request);
            if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
            return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { userId: account.value });
          }),
        ),
      ),
      hostedNotFoundRoute,
    ),
  );
}

/** What a route answered one request with: its status and its JSON body. */
const answered = (route: ReturnType<typeof routeFromHttpRouter>, request: Request) =>
  Effect.promise(async () => {
    const response = await route.fetch(request);
    // SAFETY: every route here answers JSON; the test compares it as the wire value it is.
    const body = (await response.json()) as WireBoundaryInput;
    return { status: response.status, body };
  });

function sent(method: string, headers: Record<string, string>): Request {
  return new Request(new URL(ACCOUNT_PATH, OWN_ORIGIN), { method, headers });
}

it.effect(
  "a session cookie names its account on a read from any page, and on a write from the deployment's own",
  () =>
    Effect.gen(function* () {
      const { userId, cookie, resolveUserId } = yield* openSignedIn;
      const route = accountRoute(resolveUserId);
      const named = { status: HOSTED_HTTP_STATUS.OK, body: { userId } };

      assert.deepEqual(yield* answered(route, sent("GET", { cookie })), named);
      assert.deepEqual(
        yield* answered(route, sent("GET", { cookie, origin: FOREIGN_ORIGIN })),
        named,
      );
      assert.deepEqual(yield* answered(route, sent("POST", { cookie, origin: OWN_ORIGIN })), named);
      assert.deepEqual(
        yield* answered(route, sent("POST", { cookie, "sec-fetch-site": "same-origin" })),
        named,
      );
    }),
);

it.effect(
  "a session cookie on a write from a foreign page, or from a page that names none, is refused by the guard",
  () =>
    Effect.gen(function* () {
      const { cookie, resolveUserId } = yield* openSignedIn;
      const route = accountRoute(resolveUserId);
      const refused = {
        status: HOSTED_HTTP_STATUS.FORBIDDEN,
        body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
      };

      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.deepEqual(
          yield* answered(route, sent(method, { cookie, origin: FOREIGN_ORIGIN })),
          refused,
          method,
        );
      }
      assert.deepEqual(yield* answered(route, sent("POST", { cookie })), refused);
      assert.deepEqual(
        yield* answered(route, sent("POST", { cookie, "sec-fetch-site": "cross-site" })),
        refused,
      );
    }),
);

it.effect(
  "an Authorization that does not verify is refused on the deployment's own page, whatever session the cookie names",
  () =>
    Effect.gen(function* () {
      const { cookie, resolveUserId } = yield* openSignedIn;
      const route = accountRoute(resolveUserId);
      const unauthenticated = {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      };

      for (const method of ["GET", "POST"]) {
        assert.deepEqual(
          yield* answered(
            route,
            sent(method, { cookie, origin: OWN_ORIGIN, authorization: "Bearer not-a-token" }),
          ),
          unauthenticated,
          method,
        );
      }
    }),
);

it.effect("the Mac's commands route refuses a session cookie every account route takes", () =>
  Effect.gen(function* () {
    const { plugin, userId, cookie } = yield* openSignedIn;
    // The deployment's auth service keeps its sessions in a database this suite never reaches, so it reads the cookie as Better Auth over the plugin's PGlite does.
    vi.spyOn(auth.api, "getSession").mockImplementation(
      // SAFETY: the deployment reads the session's user id alone (`browser-session.ts`), which both instances answer from the same row.
      async (context) =>
        (await plugin.api.getSession({ headers: context?.headers ?? new Headers() })) as Awaited<
          ReturnType<typeof auth.api.getSession>
        >,
    );
    const asked = () =>
      new Request(new URL(HOSTED_SERVICE_PATH.MAC_COMMANDS, OWN_ORIGIN), { headers: { cookie } });

    assert.deepEqual(yield* resolveHostedUserId(asked()), Option.some(userId));
    assert.deepEqual(yield* answered(macCommandsRoute, asked()), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
  }),
);
