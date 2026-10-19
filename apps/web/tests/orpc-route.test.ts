/**
 * orpc-route.test.ts -- the oRPC route as the platform reaches it, through rewrite and dispatcher.
 *
 * The oRPC route as the platform reaches it: a client's URL rewritten by a
 * table the generator wrote, dispatched by the grouped function, and
 * answered by the hosted router behind it. A parameterized path reaches its
 * procedure only through a row marked oRPC, whose rewrite carries the whole
 * public path; `/api/models` answers its refusals through the committed
 * table exactly as its old group did (`packages/service/src/accounts/models-procedures.test.ts`
 * holds the signed-in read, which needs a catalog and a database); and the
 * inbox's paths, each with an id among its segments, reach their own
 * procedures the same way.
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

test("the inbox's parameterized paths reach their procedures through the committed table, the dispatcher and the deployed route", async () => {
  const routes = new Map(
    ["inbox", "inbox/item", "inbox/messages", "inbox/read", "plans/inbox", "agents/inbox"].map(
      (route) => [route, orpcRoute] as const,
    ),
  );
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
  assert.deepEqual(await answer(HTTP_METHOD.DELETE, "/api/inbox/read"), otherMethod);
});
