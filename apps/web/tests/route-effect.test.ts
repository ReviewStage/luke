import assert from "node:assert/strict";
import { authApp } from "@luke/service/auth/auth-app";
import { HostedEnvironment } from "@luke/service/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  type UserIdResolver,
} from "@luke/service/http/http-effect";
import { ANY_METHOD } from "@luke/service/route";
import { HTTP_METHOD } from "@luke/wire";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { afterEach, beforeEach, test, vi } from "vitest";
import { DISPATCH_QUERY, dispatchRoutes } from "../server/function-dispatch.js";
import { routeFromHttpRouter } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";

/**
 * The adaptor's proof: a route built from a route layer reads the request it
 * was handed and the services the web runtime built, answers the gate's own
 * refusals, and answers the bounded body read's statuses on the answer and on
 * every refusal; and a state-changing request a browser's cookie carried from
 * a page the deployment does not serve is refused before any route answers it.
 */

/**
 * The web runtime's layer names a database, so building it needs a connection
 * string. `pg` connects on its first query and nothing here queries, so this
 * one is never dialled — the placeholder `tests/web-runtime.test.ts` and
 * `auth:generate` use for the same reason.
 */
const PLACEHOLDER_DATABASE_URL = "postgresql://route:effect@127.0.0.1:5432/luke";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
  vi.stubEnv(OPENAI_API_KEY, API_KEY);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

const OPENAI_API_KEY = "OPENAI_API_KEY";
const GATE_PATH = "/api/gate";
const GATE = `https://luke.test${GATE_PATH}`;
const API_KEY = "sk-test";
const USER_ID = "user-1";
const AUTHORIZATION = "Bearer token";

/** The deployment's own origin, which the guard reads from the address production registers. */
const OWN_ORIGIN = "https://luke.test";
const FOREIGN_ORIGIN = "https://evil.example";
const SESSION_COOKIE = "__Secure-better-auth.session_token=fixture";
const WRITE_PATH = "/api/write";
const WRITE_ROUTE_KEY = "write";

/** Names the deployment production at its own origin, whatever environment the suite runs in. */
function stubProduction(): void {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", OWN_ORIGIN);
}

function post(path: string, headers: Record<string, string>): Request {
  return new Request(`${OWN_ORIGIN}${path}`, { method: "POST", headers });
}

/** A route whose one path answers whatever reaches it, beside the hosted vocabulary's own not-found. */
function writeRoute() {
  return routeFromHttpRouter(
    Layer.mergeAll(
      HttpRouter.add(ANY_METHOD, WRITE_PATH, hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {})),
      hostedNotFoundRoute,
    ),
  );
}

/**
 * The gate every hosted group runs its requests through, as one route: the
 * method, the tier switched on, and the caller signed in. The key is the
 * environment's, which is what `HostedEnvironment` reads as the runtime's
 * services are built, so a case naming another key ends the runtime before
 * it asks for the next.
 */
function gateRoute(resolveUserId: UserIdResolver<string | undefined>) {
  return routeFromHttpRouter(
    HttpRouter.add(
      ANY_METHOD,
      GATE_PATH,
      hostedRefusing(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== HTTP_METHOD.GET) {
            return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
          }
          const environment = yield* HostedEnvironment;
          if (environment.openAiKey === undefined) {
            return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
          }
          const account = yield* resolveUserId(request.headers.authorization);
          if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
          return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { userId: account.value });
        }),
      ),
    ),
  );
}

function gateRequest(method: string): Request {
  return new Request(GATE, { method, headers: { authorization: AUTHORIZATION } });
}

const CASES = [
  { method: "GET", apiKey: API_KEY, userId: USER_ID, status: HOSTED_HTTP_STATUS.OK },
  {
    method: "POST",
    apiKey: API_KEY,
    userId: USER_ID,
    status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  },
  {
    method: "GET",
    apiKey: undefined,
    userId: USER_ID,
    status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  },
  { method: "GET", apiKey: API_KEY, userId: undefined, status: HOSTED_HTTP_STATUS.UNAUTHORIZED },
] as const;

test("the route reads a bearer the request carries", async () => {
  const seen: (string | undefined)[] = [];
  const route = gateRoute((authorization) => {
    seen.push(authorization);
    return Effect.succeedSome(USER_ID);
  });
  const response = await route.fetch(gateRequest("GET"));
  assert.equal(response.status, HOSTED_HTTP_STATUS.OK);
  assert.deepEqual(seen, [AUTHORIZATION]);
});

test("the route built from a route layer answers the gate's own refusals", async () => {
  const gate: number[] = [];
  for (const entry of CASES) {
    vi.stubEnv(OPENAI_API_KEY, entry.apiKey ?? "");
    gate.push(
      (
        await gateRoute(() => Effect.succeed(Option.fromUndefinedOr(entry.userId))).fetch(
          gateRequest(entry.method),
        )
      ).status,
    );
    await disposeWebRuntime();
  }
  assert.deepEqual(
    gate,
    CASES.map((entry) => entry.status),
  );
});

test("a route refuses a cookie POST a foreign page sent, and answers its own page's and the desktop's", async () => {
  stubProduction();
  const route = writeRoute();

  const foreign = await route.fetch(
    post(WRITE_PATH, { cookie: SESSION_COOKIE, origin: FOREIGN_ORIGIN }),
  );
  assert.equal(foreign.status, HOSTED_HTTP_STATUS.FORBIDDEN);
  assert.deepEqual(await foreign.json(), { error: HOSTED_API_ERROR.NOT_PERMITTED });

  const unnamed = await route.fetch(post(WRITE_PATH, { cookie: SESSION_COOKIE }));
  assert.equal(unnamed.status, HOSTED_HTTP_STATUS.FORBIDDEN);

  const own = await route.fetch(post(WRITE_PATH, { cookie: SESSION_COOKIE, origin: OWN_ORIGIN }));
  assert.equal(own.status, HOSTED_HTTP_STATUS.OK);

  const desktop = await route.fetch(post(WRITE_PATH, { authorization: AUTHORIZATION }));
  assert.equal(desktop.status, HOSTED_HTTP_STATUS.OK);
});

test("a dispatch that names Better Auth's path on another route reaches none of that route's handlers", async () => {
  stubProduction();
  const dispatcher = dispatchRoutes(new Map([[WRITE_ROUTE_KEY, writeRoute()]]));
  const dispatched = (query: string) =>
    post(`/api/default.js?${DISPATCH_QUERY.ROUTE}=${WRITE_ROUTE_KEY}${query}`, {
      cookie: SESSION_COOKIE,
      origin: FOREIGN_ORIGIN,
    });

  const named = await dispatcher.fetch(dispatched(`&${DISPATCH_QUERY.PATH}=auth/sign-in/social`));
  assert.equal(named.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  assert.deepEqual(await named.json(), HOSTED_REFUSAL.NOT_FOUND);

  const plain = await dispatcher.fetch(dispatched(""));
  assert.equal(plain.status, HOSTED_HTTP_STATUS.FORBIDDEN);
});

test("Better Auth's own route takes a cookie POST a foreign page sent, and answers it itself", async () => {
  stubProduction();
  const route = routeFromHttpRouter(
    authApp(async () => Response.json({ handled: true }, { status: HOSTED_HTTP_STATUS.OK })),
  );

  const answered = await route.fetch(
    post("/api/auth/sign-in/social", { cookie: SESSION_COOKIE, origin: FOREIGN_ORIGIN }),
  );
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  assert.deepEqual(await answered.json(), { handled: true });
});
