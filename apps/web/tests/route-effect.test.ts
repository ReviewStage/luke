import assert from "node:assert/strict";
import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { afterEach, beforeEach, test, vi } from "vitest";
import { HTTP_METHOD } from "../server/core.js";
import { HostedEnvironment } from "../server/hosted/environment.js";
import {
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readJsonBody as readJsonBodyPromise,
} from "../server/hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedMethod,
  hostedRefusalResponse,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../server/hosted/http-effect.js";
import { ANY_METHOD, ANY_PATH } from "../server/route.js";
import { routeFromHttpRouter } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";

/**
 * The adaptor's proof: a route built from a route layer reads the request it
 * was handed and the services the web runtime built, answers the gate's own
 * refusals, and answers what the promise-shaped body read beside it answers,
 * byte for byte, on the answer and on every refusal.
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
const BODIES = "https://luke.test/api/bodies";
const BODY_BOUND_BYTES = 64;
const API_KEY = "sk-test";
const USER_ID = "user-1";
const AUTHORIZATION = "Bearer token";

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
      Effect.gen(function* () {
        yield* hostedMethod(HTTP_METHOD.GET);
        const environment = yield* HostedEnvironment;
        if (environment.openAiKey === undefined) {
          return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
        }
        const request = yield* HttpServerRequest.HttpServerRequest;
        const account = yield* resolveUserId(request.headers.authorization);
        if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
        return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { userId: account.value });
      }).pipe(Effect.catch((refusal) => Effect.succeed(hostedRefusalResponse(refusal)))),
    ),
  );
}

interface RecordedResponse {
  status: number;
  contentType: string | null;
  body: string;
}

async function recorded(response: Response): Promise<RecordedResponse> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
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

function bodyRoute() {
  return routeFromHttpRouter(
    HttpRouter.add(
      ANY_METHOD,
      ANY_PATH,
      readJsonBodyEffect(BODY_BOUND_BYTES).pipe(
        Effect.map((value) => hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { read: value })),
        Effect.catch((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
      ),
    ),
  );
}

function bodyPromised(request: Request): Promise<Response> {
  return readJsonBodyPromise(request, BODY_BOUND_BYTES).then((read) =>
    read instanceof Response ? read : jsonResponse(HOSTED_HTTP_STATUS.OK, { read }),
  );
}

function bodyRequest(body: string): Request {
  return new Request(BODIES, { method: "POST", body });
}

const BODIES_UNDER_TEST = [
  JSON.stringify({ hello: "world" }),
  JSON.stringify({ padding: "x".repeat(BODY_BOUND_BYTES) }),
  "{not json",
  "",
] as const;

test("the bounded body read refuses what the promise-shaped read refuses", async () => {
  for (const body of BODIES_UNDER_TEST) {
    const converted = await recorded(await bodyRoute().fetch(bodyRequest(body)));
    const promised = await recorded(await bodyPromised(bodyRequest(body)));
    assert.deepEqual(converted, promised);
  }
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

test("the body read answers the statuses the promise-shaped read answers", async () => {
  const bodies: number[] = [];
  for (const body of BODIES_UNDER_TEST) {
    bodies.push((await bodyRoute().fetch(bodyRequest(body))).status);
  }
  assert.deepEqual(bodies, [
    HOSTED_HTTP_STATUS.OK,
    HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
    HOSTED_HTTP_STATUS.BAD_REQUEST,
    HOSTED_HTTP_STATUS.BAD_REQUEST,
  ]);
});
