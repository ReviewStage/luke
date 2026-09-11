import assert from "node:assert/strict";
import { Effect } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { brainApp } from "../server/brain-app.js";
import {
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readJsonBody as readJsonBodyPromise,
} from "../server/hosted/http.js";
import {
  hostedJsonResponse,
  hostedRefusalResponse,
  readJsonBodyEffect,
} from "../server/hosted/http-effect.js";
import { routeFromHttpApp } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";

/**
 * The adaptor's proof: a route built from an `HttpApp` answers what the
 * promise-shaped route beside it answers, byte for byte, on the answer and on
 * every refusal of the gate.
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
const CAPABILITIES = "https://luke.test/api/brain/capabilities";
const BODIES = "https://luke.test/api/bodies";
const BODY_BOUND_BYTES = 64;
const API_KEY = "sk-test";
const USER_ID = "user-1";
const AUTHORIZATION = "Bearer token";

/**
 * The group as one function serves it. The key is the environment's, which is
 * what `HostedEnvironment` reads as the runtime's services are built, so a
 * case naming another key ends the runtime before it asks for the next.
 */
function capabilitiesRoute(userId: string | undefined) {
  return routeFromHttpApp(
    brainApp({
      resolveUserId: () => Promise.resolve(userId),
      spend: () => Promise.reject(new Error("capabilities spend nothing")),
    }),
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

function capabilitiesRequest(method: string): Request {
  return new Request(CAPABILITIES, { method, headers: { authorization: AUTHORIZATION } });
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
  const route = routeFromHttpApp(
    brainApp({
      resolveUserId: (authorization) => {
        seen.push(authorization);
        return Promise.resolve(USER_ID);
      },
      spend: () => Promise.reject(new Error("capabilities spend nothing")),
    }),
  );
  const response = await route.fetch(capabilitiesRequest("GET"));
  assert.equal(response.status, HOSTED_HTTP_STATUS.OK);
  assert.deepEqual(seen, [AUTHORIZATION]);
});

function bodyRoute() {
  return routeFromHttpApp(
    readJsonBodyEffect(BODY_BOUND_BYTES).pipe(
      Effect.map((value) => hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { read: value })),
      Effect.catchAll((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
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

test("the route built from an HttpApp answers the gate's own refusals", async () => {
  const gate: number[] = [];
  for (const entry of CASES) {
    vi.stubEnv(OPENAI_API_KEY, entry.apiKey ?? "");
    gate.push(
      (await capabilitiesRoute(entry.userId).fetch(capabilitiesRequest(entry.method))).status,
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
