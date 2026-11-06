import assert from "node:assert/strict";
import path from "node:path";
import { unreachedWorkspaceSeams } from "@repo/database/testing";
import { authApp, type WebRequestHandler } from "@repo/service/auth/auth-app";
import { HOSTED_HTTP_STATUS } from "@repo/service/http/http";
import { afterEach, beforeEach, test, vi } from "vitest";
import { routeFromHttpRouter } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { recordedResponse, settleResponseGolden } from "./support/response-golden.js";

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/auth-route");

const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/app";

const AUTH_ORIGIN = "https://app.test";

interface StubbedHandler {
  handle: WebRequestHandler;
  requests: Request[];
}

function stubbedHandler(answer: () => Response): StubbedHandler {
  const requests: Request[] = [];
  return {
    requests,
    handle: async (request) => {
      requests.push(request);
      return answer();
    },
  };
}

function signedInAnswer(): Response {
  const headers = new Headers({ "content-type": "application/json", "x-better-auth": "1" });
  headers.append("set-cookie", "app.session_token=abc; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "app.session_data=def; Path=/; HttpOnly");
  return new Response(JSON.stringify({ redirect: false, token: "abc" }), {
    status: HOSTED_HTTP_STATUS.OK,
    headers,
  });
}

function providerRedirect(): Response {
  return Response.redirect(`${AUTH_ORIGIN}/sign-in.html?ok=1`, 302);
}

function unknownEndpointAnswer(): Response {
  return new Response(JSON.stringify({ message: "Not Found" }), {
    status: HOSTED_HTTP_STATUS.NOT_FOUND,
    headers: { "content-type": "application/json" },
  });
}

function methodRefusedAnswer(): Response {
  return new Response(JSON.stringify({ message: "Method Not Allowed" }), {
    status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

interface Exchange {
  name: string;
  answer: () => Response;
  request: () => Request;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "round-trip",
    answer: signedInAnswer,
    request: () =>
      new Request(`${AUTH_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "developer@app.test", password: "fixture" }),
      }),
  },
  {
    name: "provider-redirect",
    answer: providerRedirect,
    request: () => new Request(`${AUTH_ORIGIN}/api/auth/callback/google?code=fixture&state=state`),
  },
  {
    name: "unknown-endpoint",
    answer: unknownEndpointAnswer,
    request: () => new Request(`${AUTH_ORIGIN}/api/auth/not-an-endpoint`),
  },
  {
    name: "method-refused",
    answer: methodRefusedAnswer,
    request: () => new Request(`${AUTH_ORIGIN}/api/auth/sign-in/email`, { method: "DELETE" }),
  },
];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

test("the group answers what the handler answered, as the handler answered it", async () => {
  for (const exchange of EXCHANGES) {
    const stub = stubbedHandler(exchange.answer);
    const request = exchange.request();
    const answered = await routeFromHttpRouter(authApp(stub.handle, unreachedWorkspaceSeams)).fetch(
      request,
    );
    const carried = await recordedResponse(answered);
    const direct = await recordedResponse(await stub.handle(exchange.request()));

    assert.equal(stub.requests[0], request);
    assert.deepEqual(carried, direct);
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});
