import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { ActionsGroupHandlers, HostedActionHandler } from "../server/actions-app.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import { routeFromHttpApp } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import {
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The group carries each of the six endpoints' own answer unchanged, so what
 * this holds is that carrying: the same request object reaches the handler,
 * and the handler's own response is what the function answers. The admission
 * gauntlet, the roster, and the refusal vocabulary in
 * `server/hosted/action-session.ts` are exercised by `hosted-actions.test.ts`
 * already and are untouched here.
 *
 * The module is imported dynamically, after `DATABASE_URL` is stubbed: it
 * reaches `server/hosted/vault-route.ts`, which reaches `server/auth.ts`,
 * whose Better Auth instance reads the database at module load rather than
 * lazily, so a static import here would run before the stub took effect.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/actions-route");

/** The layer names a database and nothing here queries one, as in `web-runtime.test.ts`. */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";

const ACTIONS_ORIGIN = "https://luke.test";

interface StubbedHandler {
  handle: HostedActionHandler;
  requests: Request[];
}

/** A handler that answers from the script it was given, recording what it was handed. */
function stubbedHandler(answer: () => Response): StubbedHandler {
  const requests: Request[] = [];
  return {
    requests,
    handle: async (route) => {
      requests.push(route.request);
      return answer();
    },
  };
}

function acceptedAnswer(): Response {
  return new Response(JSON.stringify({ result: "accepted", providerSessionId: "session-1" }), {
    status: HOSTED_HTTP_STATUS.OK,
    headers: { "content-type": "application/json" },
  });
}

function rejectedAnswer(): Response {
  return new Response(
    JSON.stringify({
      result: "rejected",
      reason: "No provider key stored. Add a key for this provider in settings.",
    }),
    { status: HOSTED_HTTP_STATUS.OK, headers: { "content-type": "application/json" } },
  );
}

function messageRequest(): Request {
  return new Request(`${ACTIONS_ORIGIN}/api/actions/message`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify({ providerId: "conductor", providerSessionId: "session-1", text: "hi" }),
  });
}

function workspaceRequest(): Request {
  return new Request(`${ACTIONS_ORIGIN}/api/actions/workspace`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify({ providerId: "conductor", providerProjectId: "project-1" }),
  });
}

interface Exchange {
  name: string;
  answer: () => Response;
  request: () => Request;
  handlers: (stub: HostedActionHandler) => ActionsGroupHandlers;
}

function handlersWith(
  named: keyof ActionsGroupHandlers,
  stub: HostedActionHandler,
): ActionsGroupHandlers {
  const untouched: HostedActionHandler = async () => {
    throw new Error("only the exchange's own endpoint should be reached");
  };
  return {
    message: untouched,
    control: untouched,
    agent: untouched,
    renameSession: untouched,
    renameWorkspace: untouched,
    workspace: untouched,
    [named]: stub,
  };
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "accepted",
    answer: acceptedAnswer,
    request: messageRequest,
    handlers: (stub) => handlersWith("message", stub),
  },
  {
    name: "rejected",
    answer: rejectedAnswer,
    request: workspaceRequest,
    handlers: (stub) => handlersWith("workspace", stub),
  },
];

let buildActionsApp: typeof import("../server/actions-app.js").buildActionsApp;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
  ({ buildActionsApp } = await import("../server/actions-app.js"));
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

test("the group answers what the named endpoint's handler answered", async () => {
  for (const exchange of EXCHANGES) {
    const stub = stubbedHandler(exchange.answer);
    const request = exchange.request();
    const answered = await routeFromHttpApp(buildActionsApp(exchange.handlers(stub.handle))).fetch(
      request,
    );
    const carried = await recordedResponse(answered);
    const direct = await recordedResponse(exchange.answer());

    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0], request);
    assert.deepEqual(carried, direct);
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});

test("a path the group declares no route for is refused without reaching any handler", async () => {
  const stub = stubbedHandler(acceptedAnswer);
  const handlers = handlersWith("message", stub.handle);
  const answered = await routeFromHttpApp(buildActionsApp(handlers)).fetch(
    new Request(`${ACTIONS_ORIGIN}/api/not-the-actions-group`),
  );
  const carried = await recordedResponse(answered);

  assert.deepEqual(stub.requests, []);
  assert.equal(carried.status, HOSTED_HTTP_STATUS.NOT_FOUND);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = EXCHANGES.map((exchange) => exchange.name).sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
