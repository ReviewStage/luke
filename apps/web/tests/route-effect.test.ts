import assert from "node:assert/strict";
import { Effect } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { brainCapabilitiesApp, handleBrainCapabilities } from "../server/hosted/brain-v2.js";
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
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

const CAPABILITIES = "https://luke.test/api/brain/capabilities";
const BODIES = "https://luke.test/api/bodies";
const BODY_BOUND_BYTES = 64;
const API_KEY = "sk-test";
const USER_ID = "user-1";
const AUTHORIZATION = "Bearer token";

function capabilitiesRoute(apiKey: string | undefined, userId: string | undefined) {
  return routeFromHttpApp(
    brainCapabilitiesApp({
      apiKey,
      resolveUserId: () => Promise.resolve(userId),
    }),
  );
}

function capabilitiesPromised(
  request: Request,
  apiKey: string | undefined,
  userId: string | undefined,
): Promise<Response> {
  return handleBrainCapabilities({
    request,
    apiKey,
    resolveUserId: () => Promise.resolve(userId),
  });
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
  { method: "GET", apiKey: API_KEY, userId: USER_ID },
  { method: "POST", apiKey: API_KEY, userId: USER_ID },
  { method: "GET", apiKey: undefined, userId: USER_ID },
  { method: "GET", apiKey: API_KEY, userId: undefined },
] as const;

test("the route built from an HttpApp answers what the promise-shaped route answers", async () => {
  for (const entry of CASES) {
    const route = capabilitiesRoute(entry.apiKey, entry.userId);
    const converted = await recorded(await route.fetch(capabilitiesRequest(entry.method)));
    const promised = await recorded(
      await capabilitiesPromised(capabilitiesRequest(entry.method), entry.apiKey, entry.userId),
    );
    assert.deepEqual(converted, promised);
  }
});

test("the route reads a bearer the request carries", async () => {
  const seen: (string | undefined)[] = [];
  const route = routeFromHttpApp(
    brainCapabilitiesApp({
      apiKey: API_KEY,
      resolveUserId: (authorization) => {
        seen.push(authorization);
        return Promise.resolve(USER_ID);
      },
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

test("the cases under test cover the statuses the gate and the body read answer", async () => {
  const gate: number[] = [];
  for (const entry of CASES) {
    const route = capabilitiesRoute(entry.apiKey, entry.userId);
    gate.push((await route.fetch(capabilitiesRequest(entry.method))).status);
  }
  assert.deepEqual(gate, [
    HOSTED_HTTP_STATUS.OK,
    HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
    HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    HOSTED_HTTP_STATUS.UNAUTHORIZED,
  ]);
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
