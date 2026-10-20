/**
 * orpc-route.test.ts -- the oRPC route as the platform reaches it, through rewrite and dispatcher.
 *
 * The oRPC route as the platform reaches it: a client's URL rewritten by a
 * table the generator wrote, dispatched by the grouped function, and
 * answered by the hosted router behind it. Every path that is no route
 * file's reaches the router through the one fallback rewrite, which carries
 * the whole public path, segments and all, and the router matches it;
 * `/api/models` answers its refusals through the committed
 * table exactly as its old group did (`packages/service/src/accounts/models-procedures.test.ts`
 * holds the signed-in read, which needs a catalog and a database), and a plan's routes refuse the
 * same way, an unsigned caller before its body is read (`tasks-app.test.ts` holds the signed-in
 * reads and writes), and the inbox's paths reach theirs the same way, each with an id among
 * its segments.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HOSTED_ERRORS } from "@luke/features/contract";
import { HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import type { HostedContext } from "@luke/service/orpc/base";
import { hostedFetch } from "@luke/service/orpc/handler";
import { recordingSentry } from "@luke/service/testing/sentry-transport";
import { HTTP_METHOD } from "@luke/wire";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { hostedProcedureRoutes, type ProcedureRoute } from "../server/api-callers.js";
import { ORPC_ROUTE_KEY } from "../server/function-dispatch.js";
import { apiRewrites } from "../server/function-rewrites.js";
import { orpcRoute, routeFromHostedFetch } from "../server/orpc-route.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { dispatched, dispatchedBy } from "./support/platform-landing.js";

/** The web runtime's layer names a database; nothing here queries it, so it is never dialled (`route-effect.test.ts`). */
const PLACEHOLDER_DATABASE_URL = "postgresql://orpc:route@127.0.0.1:5432/luke";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

const ORIGIN = "https://luke.test";
/** The grouped function as it is deployed: the oRPC route under its key, which the fallback lands every other path on. */
const ORPC_ROUTES = new Map([[ORPC_ROUTE_KEY, orpcRoute]]);

const GROUPED = { file: "default", routes: [ORPC_ROUTE_KEY], dispatches: true } as const;

const partContract = {
  part: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/widgets/{id}/parts/{part}" }))
    .input(Schema.Struct({ id: Schema.String, part: Schema.String }))
    .output(Schema.flip(Schema.Struct({ id: Schema.String, part: Schema.String }))),
};

const parts = implement(partContract).$context<HostedContext>();

/** A test-only procedure on a path with two segments, answering the ones it was handed. */
const partRoute = routeFromHostedFetch(
  hostedFetch(
    parts.router({
      part: parts.part.handler(({ input }) => ({ id: input.id, part: input.part })),
    }),
  ),
);

/** A client's path landed by the generated fallback alone and dispatched to the test procedure. */
function partAnswer(path: string): Promise<Response> {
  return dispatchedBy(
    apiRewrites([GROUPED], []),
    new Request(`${ORIGIN}${path}`),
    new Map([[ORPC_ROUTE_KEY, partRoute]]),
  );
}

test("a parameterized oRPC procedure is reached through the fallback rewrite and the dispatcher at its own public path", async () => {
  const answer = await partAnswer("/api/widgets/W1/parts/p2?view=full");
  assert.equal(answer.status, HOSTED_HTTP_STATUS.OK);
  assert.deepEqual(await answer.json(), { id: "W1", part: "p2" });
});

test("a path no procedure matches is the router's own JSON 404 through the fallback, not the platform's", async () => {
  for (const path of ["/api/nope", "/api/widgets/W1/parts", "/api/widgets/W1/parts/p2/more"]) {
    const answer = await partAnswer(path);
    assert.equal(answer.status, HOSTED_HTTP_STATUS.NOT_FOUND, path);
    assert.equal(answer.headers.get("content-type"), "application/json", path);
    assert.equal(await answer.text(), '{"error":"not-found"}', path);
  }
});

test("/api/models refuses through the committed table, the dispatcher and the deployed route as its old group did", async () => {
  const routes = ORPC_ROUTES;
  const unsigned = await dispatched(new Request(`${ORIGIN}/api/models`), routes);
  assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(unsigned.headers.get("content-type"), "application/json");
  assert.equal(unsigned.headers.get("cache-control"), null);
  assert.equal(await unsigned.text(), '{"error":"invalid-token"}');

  const posted = await dispatched(
    new Request(`${ORIGIN}/api/models`, {
      method: HTTP_METHOD.POST,
      headers: { authorization: "Bearer t" },
    }),
    routes,
  );
  assert.equal(posted.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(posted.headers.get("cache-control"), null);
  assert.equal(await posted.text(), '{"error":"method-not-allowed"}');
});

test("an automation's own paths reach the automation procedures through the committed table and the dispatcher, refusing an unsigned caller as the old group did, its malformed body unread", async () => {
  const id = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
  const routes = ORPC_ROUTES;
  const runs = await dispatched(new Request(`${ORIGIN}/api/automations/${id}/runs`), routes);
  assert.equal(runs.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(runs.headers.get("content-type"), "application/json");
  assert.equal(runs.headers.get("cache-control"), null);
  assert.equal(await runs.text(), '{"error":"invalid-token"}');

  const changed = await dispatched(
    new Request(`${ORIGIN}/api/automations/${id}`, {
      method: HTTP_METHOD.PATCH,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes", owner: "someone-else" }),
    }),
    routes,
  );
  assert.equal(changed.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(await changed.text(), '{"error":"invalid-token"}');
});

test("the held message reads are reached at their public paths through the committed table, their segments in the path the router matches", async () => {
  const agent = "4b0d6b5e-0a8f-4a8e-9a43-1c5f7f8b2a10";
  const routes = ORPC_ROUTES;
  for (const path of [
    `/api/agents/${agent}/messages?after=0:0`,
    `/api/agents/${agent}/subagents/call-1/messages?after=0:0`,
    `/api/plans/${agent}/messages`,
    `/api/plans/${agent}/subagents/call-1/messages?after=0:0`,
    `/api/workspaces/chat?workspaceId=${agent}&after=0`,
  ]) {
    const unsigned = await dispatched(new Request(`${ORIGIN}${path}`), routes);
    assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED, path);
    assert.equal(await unsigned.text(), '{"error":"invalid-token"}', path);
  }
  // A worker's transcript takes no write: matched at its public path, it is refused by method rather than not found.
  const posted = await dispatched(
    new Request(`${ORIGIN}/api/plans/${agent}/subagents/call-1/messages`, {
      method: HTTP_METHOD.POST,
      headers: { authorization: "Bearer t" },
    }),
    routes,
  );
  assert.equal(posted.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(await posted.text(), '{"error":"method-not-allowed"}');
});

test("an integration's parameterized path reaches its procedure through the committed table, the dispatcher and the deployed route, which refuses as its old group did", async () => {
  const routes = ORPC_ROUTES;
  const unsigned = await dispatched(
    new Request(`${ORIGIN}/api/account/integrations/slack/connect?add=true`, {
      method: HTTP_METHOD.POST,
    }),
    routes,
  );
  assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(unsigned.headers.get("cache-control"), null);
  assert.equal(await unsigned.text(), '{"error":"invalid-token"}');

  const fetched = await dispatched(
    new Request(`${ORIGIN}/api/account/integrations/slack/rename?connection=slack`),
    routes,
  );
  assert.equal(fetched.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(await fetched.text(), '{"error":"method-not-allowed"}');
});

test("a plan's routes refuse through the committed table, the dispatcher and the deployed route as their old group did, an unsigned caller before its body is read", async () => {
  const plan = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const routes = ORPC_ROUTES;
  const bytes = async (response: Response) => ({
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    text: await response.text(),
  });
  const unsigned = {
    status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
    contentType: "application/json",
    cacheControl: null,
    text: '{"error":"invalid-token"}',
  };

  assert.deepEqual(
    await bytes(await dispatched(new Request(`${ORIGIN}/api/plans/${plan}/board`), routes)),
    unsigned,
  );
  assert.deepEqual(
    await bytes(
      await dispatched(
        new Request(`${ORIGIN}/api/plans/${plan}`, {
          method: HTTP_METHOD.PATCH,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ unknown: true }),
        }),
        routes,
      ),
    ),
    unsigned,
  );
  assert.deepEqual(
    await bytes(
      await dispatched(
        new Request(`${ORIGIN}/api/plans/${plan}/board`, {
          method: HTTP_METHOD.POST,
          headers: { authorization: "Bearer t" },
        }),
        routes,
      ),
    ),
    {
      status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      contentType: "application/json",
      cacheControl: null,
      text: '{"error":"method-not-allowed"}',
    },
  );
});

test("the GitHub routes refuse through the committed table, the dispatcher and the deployed route as their old groups did", async () => {
  const routes = ORPC_ROUTES;
  const unsigned = await dispatched(
    new Request(`${ORIGIN}/api/github/repositories/tree?workspaceId=a&workspaceId=b`),
    routes,
  );
  assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(unsigned.headers.get("cache-control"), null);
  assert.equal(await unsigned.text(), '{"error":"invalid-token"}');

  const read = await dispatched(new Request(`${ORIGIN}/api/github/connect`), routes);
  assert.equal(read.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(await read.text(), '{"error":"method-not-allowed"}');
});

test("a plan's comment thread path reaches its procedure through the committed table, the dispatcher and the deployed route", async () => {
  const plan = "0f8e2b7a-4c1d-4e5f-9a6b-7c8d9e0f1a2b";
  const thread = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const routes = ORPC_ROUTES;
  const unsigned = await dispatched(
    new Request(`${ORIGIN}/api/plans/${plan}/comments/${thread}`, {
      method: HTTP_METHOD.POST,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resolve" }),
    }),
    routes,
  );
  assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
  assert.equal(unsigned.headers.get("cache-control"), null);
  assert.equal(await unsigned.text(), '{"error":"invalid-token"}');

  const read = await dispatched(
    new Request(`${ORIGIN}/api/plans/${plan}/comments/${thread}`),
    routes,
  );
  assert.equal(read.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(await read.text(), '{"error":"method-not-allowed"}');
});

test("an agent's Pull request tab is reached at its public paths through the committed table, the dispatcher and the deployed route, and refuses an unsigned caller as its old group did", async () => {
  const agentId = "8a7c2a1e-3b9f-4c62-9d1e-0f4b5a6c7d8e";
  const routes = ORPC_ROUTES;
  for (const sent of [
    new Request(`${ORIGIN}/api/agents/${agentId}/overview/checks?number=12`),
    new Request(`${ORIGIN}/api/agents/${agentId}/pull-request/action?number=12`, {
      method: HTTP_METHOD.POST,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "ready-for-review" }),
    }),
  ]) {
    const unsigned = await dispatched(sent, routes);
    assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
    assert.equal(unsigned.headers.get("content-type"), "application/json");
    assert.equal(unsigned.headers.get("cache-control"), null);
    assert.equal(await unsigned.text(), '{"error":"invalid-token"}');
  }
});

test("an agent's shells refuse an unsigned caller through the committed table, the dispatcher and the deployed route at their public path", async () => {
  const routes = ORPC_ROUTES;
  const agent = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const shell = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
  for (const path of [
    `/api/agents/${agent}/terminals`,
    `/api/agents/${agent}/terminals/${shell}`,
  ]) {
    const unsigned = await dispatched(
      new Request(`${ORIGIN}${path}`, { method: HTTP_METHOD.DELETE }),
      routes,
    );
    const expected = path.endsWith(shell)
      ? { status: HOSTED_HTTP_STATUS.UNAUTHORIZED, text: '{"error":"invalid-token"}' }
      : { status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, text: '{"error":"method-not-allowed"}' };
    assert.deepEqual({ status: unsigned.status, text: await unsigned.text() }, expected, path);
  }
});

test("the inbox's parameterized paths reach their procedures through the committed table, the dispatcher and the deployed route", async () => {
  const routes = ORPC_ROUTES;
  const id = "5d2b8f0e-1a3c-4e6f-9b7d-2c4e6a8b0d1f";
  const answer = async (method: string, path: string) => {
    const response = await dispatched(new Request(`${ORIGIN}${path}`, { method }), routes);
    return [response.status, await response.text()];
  };
  const unsigned = [HOSTED_HTTP_STATUS.UNAUTHORIZED, '{"error":"invalid-token"}'];
  const otherMethod = [HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, '{"error":"method-not-allowed"}'];

  assert.deepEqual(await answer(HTTP_METHOD.GET, `/api/plans/${id}/inbox?after=0`), unsigned);
  assert.deepEqual(await answer(HTTP_METHOD.GET, `/api/agents/${id}/inbox?after=0`), unsigned);
  assert.deepEqual(await answer(HTTP_METHOD.GET, "/api/inbox?after=0"), unsigned);
  assert.deepEqual(await answer(HTTP_METHOD.PUT, `/api/inbox/${id}/read`), unsigned);
  assert.deepEqual(await answer(HTTP_METHOD.DELETE, `/api/inbox/${id}/read`), unsigned);
  assert.deepEqual(await answer(HTTP_METHOD.PUT, "/api/inbox/read"), unsigned);
  // A method no procedure takes at a matched path is the hosted 405, so each path is the procedure's own.
  assert.deepEqual(await answer(HTTP_METHOD.POST, `/api/inbox/${id}/read`), otherMethod);
  assert.deepEqual(await answer(HTTP_METHOD.GET, `/api/inbox/${id}`), otherMethod);
  assert.deepEqual(await answer(HTTP_METHOD.GET, `/api/inbox/${id}/messages`), otherMethod);
  assert.deepEqual(await answer(HTTP_METHOD.GET, `/api/inbox/${id}/close`), otherMethod);
  assert.deepEqual(await answer(HTTP_METHOD.DELETE, "/api/inbox/read"), otherMethod);
});

it.effect(
  "what an oRPC route throws on to the platform is captured by Sentry, and thrown on as it was",
  () =>
    Effect.gen(function* () {
      const route = routeFromHostedFetch(async (request) => {
        if (new URL(request.url).pathname === "/api/throws") throw new RangeError("no runtime");
        return new Response(null, { status: 204 });
      });
      // Note that the web runtime is built first, because building it starts the deployment's own Sentry, which the recording one then stands in for.
      const answered = yield* Effect.promise(() =>
        route.fetch(new Request(`${ORIGIN}/api/answers`)),
      );
      const sentry = recordingSentry();

      yield* Effect.promise(() =>
        assert.rejects(route.fetch(new Request(`${ORIGIN}/api/throws`)), {
          name: "RangeError",
          message: "no runtime",
        }),
      ).pipe(Effect.provide(sentry.layer));

      assert.equal(answered.status, 204);
      assert.deepEqual(
        sentry.sent
          .filter((item) => item.type === "event")
          .flatMap((item) => (item.payload.exception?.values ?? []).map((value) => value.type)),
        ["RangeError"],
      );
    }),
);

test("a path of every hosted resource reaches its own procedure through the committed fallback and the deployed router, which answers it rather than not finding it", async () => {
  const firstOfResource = new Map<string, ProcedureRoute>();
  for (const procedure of hostedProcedureRoutes()) {
    const [resource = ""] = procedure.key;
    if (!firstOfResource.has(resource)) firstOfResource.set(resource, procedure);
  }
  for (const procedure of firstOfResource.values()) {
    const path = procedure.path.replaceAll(
      /\{\+?[^{}]+\}/gu,
      "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60",
    );
    const answer = await dispatched(
      new Request(`${ORIGIN}${path}`, { method: procedure.method }),
      ORPC_ROUTES,
    );
    const text = await answer.text();
    assert.notEqual(text, '{"error":"not-found"}', procedure.key.join("."));
  }
});
