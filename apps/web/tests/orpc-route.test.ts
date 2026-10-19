/**
 * orpc-route.test.ts -- the oRPC route as the platform reaches it, through rewrite and dispatcher.
 *
 * The oRPC route as the platform reaches it: a client's URL rewritten by a
 * table the generator wrote, dispatched by the grouped function, and
 * answered by the hosted router behind it. A parameterized path reaches its
 * procedure only through a row marked oRPC, whose rewrite carries the whole
 * public path; `/api/models` answers its refusals through the committed
 * table exactly as its old group did (`packages/service/src/accounts/models-procedures.test.ts`
 * holds the signed-in read, which needs a catalog and a database), and a plan's routes refuse the
 * same way, an unsigned caller before its body is read (`tasks-app.test.ts` holds the signed-in
 * reads and writes), and one issue's path reaches its procedure the same way.
 */

import assert from "node:assert/strict";
import { HOSTED_ERRORS } from "@luke/features/contract";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import type { HostedContext } from "@luke/service/orpc/base";
import { hostedFetch } from "@luke/service/orpc/handler";
import { HTTP_METHOD } from "@luke/wire";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { apiRewrites, type SegmentRewrite } from "../server/function-rewrites.js";
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
const PART_ROUTE = "widgets/part";
const PART_SRC = "/api/widgets/([^/]+)/parts/([^/]+)";
const GROUPED = { file: "default", routes: [PART_ROUTE], dispatches: true } as const;

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

/** The generated rewrite of one segment row, landed and dispatched to the test procedure. */
async function partAnswer(row: SegmentRewrite): Promise<Response> {
  const path = "/api/widgets/W1/parts/p2?view=full";
  return dispatchedBy(
    apiRewrites([GROUPED], [row]),
    new Request(`${ORIGIN}${path}`),
    new Map([[PART_ROUTE, partRoute]]),
  );
}

test("a parameterized oRPC procedure is reached through its rewrite and the dispatcher at its own public path", async () => {
  const answer = await partAnswer({
    src: PART_SRC,
    route: PART_ROUTE,
    query: "id=$1&part=$2",
    orpc: true,
  });
  assert.equal(answer.status, HOSTED_HTTP_STATUS.OK);
  assert.deepEqual(await answer.json(), { id: "W1", part: "p2" });
});

test("a segment row not marked oRPC lands on the flattened route key, which the router does not serve", async () => {
  const answer = await partAnswer({ src: PART_SRC, route: PART_ROUTE, query: "id=$1&part=$2" });
  assert.equal(answer.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  assert.deepEqual(await answer.json(), { error: HOSTED_API_ERROR.NOT_FOUND });
});

test("/api/models refuses through the committed table, the dispatcher and the deployed route as its old group did", async () => {
  const routes = new Map([["models", orpcRoute]]);
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
  const routes = new Map([
    ["automations/automation", orpcRoute],
    ["automations/runs", orpcRoute],
  ]);
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
  const routes = new Map([
    ["agents/messages", orpcRoute],
    ["agents/subagent-messages", orpcRoute],
    ["plans/messages", orpcRoute],
    ["plans/subagent-messages", orpcRoute],
    ["workspaces/chat", orpcRoute],
  ]);
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
  const routes = new Map([
    ["account/integrations/connect", orpcRoute],
    ["account/integrations/rename", orpcRoute],
  ]);
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
  const routes = new Map([
    ["plans/plan", orpcRoute],
    ["plans/board", orpcRoute],
  ]);
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
  const routes = new Map([
    ["github/repositories/tree", orpcRoute],
    ["github/connect", orpcRoute],
  ]);
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

test("/api/issues/:id reaches its procedure through the committed table and the dispatcher at its public path, refusing an unsigned caller as its old group did", async () => {
  const routes = new Map([["issues/issue", orpcRoute]]);
  const path = "/api/issues/3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
  for (const method of [HTTP_METHOD.GET, HTTP_METHOD.PATCH]) {
    const unsigned = await dispatched(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === HTTP_METHOD.PATCH ? { body: JSON.stringify({ title: 7 }) } : undefined),
      }),
      routes,
    );
    assert.equal(unsigned.status, HOSTED_HTTP_STATUS.UNAUTHORIZED, method);
    assert.equal(unsigned.headers.get("cache-control"), null);
    assert.equal(await unsigned.text(), '{"error":"invalid-token"}');
  }
  const deleted = await dispatched(
    new Request(`${ORIGIN}${path}`, { method: HTTP_METHOD.DELETE }),
    routes,
  );
  assert.equal(deleted.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
  assert.equal(await deleted.text(), '{"error":"method-not-allowed"}');
});

test("a plan's comment thread path reaches its procedure through the committed table, the dispatcher and the deployed route", async () => {
  const plan = "0f8e2b7a-4c1d-4e5f-9a6b-7c8d9e0f1a2b";
  const thread = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const routes = new Map([["plans/comment-thread", orpcRoute]]);
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
