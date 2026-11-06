import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { auth } from "@repo/service/auth/auth";
import { requestUserId, resolveHostedUserId } from "@repo/service/auth/bearer";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@repo/service/http/http";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  resolvedAccount,
  type UserIdResolver,
} from "@repo/service/http/http-effect";
import { ANY_METHOD } from "@repo/service/route";
import { openWorkspacePlugin } from "@repo/service/testing/workspace-plugin";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { afterEach, beforeEach, vi } from "vitest";
import { hostedProcedureRoutes } from "../server/api-callers.js";
import { ORPC_ROUTE_KEY } from "../server/function-dispatch.js";
import { orpcRoute } from "../server/orpc-route.js";
import { routeFromHttpRouter } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { dispatched } from "./support/platform-landing.js";

const { OWN_ORIGIN } = vi.hoisted(() => {
  const own = "https://app.test";
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", own);
  return { OWN_ORIGIN: own };
});

const PLACEHOLDER_DATABASE_URL = "postgresql://route:effect@127.0.0.1:5432/app";

const FOREIGN_ORIGIN = "https://evil.example";
const ACCOUNT_PATH = "/api/account-under-test";

const ORPC_ROUTES = new Map([[ORPC_ROUTE_KEY, orpcRoute]]);

const UNHELD_COOKIE = "__Secure-better-auth.session_token=fixture";

const PATH_PARAMETER_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", OWN_ORIGIN);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const openSignedIn = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  ).pipe(Effect.provide(plugin.database));
  const resolveUserId: UserIdResolver = (request) =>
    requestUserId(request, () => Effect.succeed(undefined), plugin.resolveSessionUserId);
  return { plugin, userId, cookie: yield* plugin.sessionCookieOf(userId), resolveUserId };
});

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
            const account = yield* resolvedAccount(resolveUserId, request);
            if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
            return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { userId: account.value });
          }),
        ),
      ),
      hostedNotFoundRoute,
    ),
  );
}

const answered = (route: ReturnType<typeof routeFromHttpRouter>, request: Request) =>
  Effect.promise(async () => {
    const response = await route.fetch(request);
    const body = (await response.json()) as WireBoundaryInput;
    return { status: response.status, body };
  });

function sent(method: string, headers: Record<string, string>): Request {
  return new Request(new URL(ACCOUNT_PATH, OWN_ORIGIN), { method, headers });
}

const deployedOrpc = { fetch: (request: Request) => dispatched(request, ORPC_ROUTES) };

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
    vi.spyOn(auth.api, "getSession").mockImplementation(
      async (context) =>
        (await plugin.api.getSession({ headers: context?.headers ?? new Headers() })) as Awaited<
          ReturnType<typeof auth.api.getSession>
        >,
    );
    const asked = () =>
      new Request(new URL(HOSTED_SERVICE_PATH.MAC_COMMANDS, OWN_ORIGIN), { headers: { cookie } });

    assert.deepEqual(yield* resolveHostedUserId(asked()), Option.some(userId));
    assert.deepEqual(yield* answered(orpcRoute, asked()), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
  }),
);

it.effect(
  "the deployed oRPC route refuses a write a foreign page's cookie carried before any procedure reads it, whichever procedure it names",
  () =>
    Effect.gen(function* () {
      const refused = {
        status: HOSTED_HTTP_STATUS.FORBIDDEN,
        body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
      };
      const writes = hostedProcedureRoutes().filter(
        (procedure) => procedure.method !== HTTP_METHOD.GET,
      );
      assert.ok(writes.length > 0);
      for (const procedure of writes) {
        const path = procedure.path.replaceAll(/\{\+?[^{}]+\}/gu, PATH_PARAMETER_ID);
        const request = new Request(new URL(path, OWN_ORIGIN), {
          method: procedure.method,
          headers: { cookie: UNHELD_COOKIE, origin: FOREIGN_ORIGIN },
        });
        assert.deepEqual(yield* answered(deployedOrpc, request), refused, procedure.key.join("."));
      }
    }),
);

it.effect(
  "a write to the deployed oRPC route from the deployment's own page, or from a desktop, goes on to its procedure, which answers for its caller itself; a cookie's from any other page is refused",
  () =>
    Effect.gen(function* () {
      const deleteAccount = (headers: Record<string, string>) =>
        answered(
          deployedOrpc,
          new Request(new URL(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, OWN_ORIGIN), {
            method: HTTP_METHOD.POST,
            headers,
          }),
        );
      const callerChecked = {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      };
      const refused = {
        status: HOSTED_HTTP_STATUS.FORBIDDEN,
        body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
      };

      assert.deepEqual(
        yield* deleteAccount({ cookie: UNHELD_COOKIE, origin: OWN_ORIGIN }),
        callerChecked,
      );
      assert.deepEqual(
        yield* deleteAccount({ cookie: UNHELD_COOKIE, "sec-fetch-site": "same-origin" }),
        callerChecked,
      );
      assert.deepEqual(
        yield* deleteAccount({ authorization: "Bearer not-a-token" }),
        callerChecked,
      );
      assert.deepEqual(yield* deleteAccount({ cookie: UNHELD_COOKIE }), refused);
      assert.deepEqual(
        yield* deleteAccount({
          cookie: UNHELD_COOKIE,
          origin: FOREIGN_ORIGIN,
          authorization: "Bearer not-a-token",
        }),
        refused,
        "an Authorization beside the cookie buys nothing",
      );
    }),
);
