import assert from "node:assert/strict";
import { Effect } from "effect";
import { HttpEffect } from "effect/unstable/http";
import { test } from "vitest";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { ratingApp } from "../server/rating-app";
import { noDatabase } from "./support/no-database";

/**
 * The path `server/function-dispatch.ts`'s `dispatchRoutes` actually hands
 * this function: not the client's `/api/conversation/messages/{id}/rating`,
 * whose captured id `server/function-rewrites.ts` moves into the `id` query
 * instead, but the fixed route key `dispatchRoutes` restores the pathname
 * to. A router matched against the client-facing, id-carrying path would
 * never see a request, since that path never reaches the group at all.
 */
const MESSAGE_ID = "2b000000-0000-4000-8000-000000000012";

function ratingRequest(init: { method?: string; path?: string } = {}): Request {
  const path = init.path ?? "/api/conversation/messages/rating";
  const url = new URL(`https://luke.test${path}`);
  url.searchParams.set("id", MESSAGE_ID);
  return new Request(url, { method: init.method ?? "PUT" });
}

const handler = HttpEffect.toWebHandler(Effect.provide(ratingApp(), noDatabase));

function answer(request: Request): Promise<Response> {
  return handler(request);
}

test("the path server/function-dispatch.ts actually restores reaches the handler, not the group's own not-found", async () => {
  const response = await answer(ratingRequest());
  // SAFETY: the hosted error vocabulary's own answer, read back for its slug.
  const body = (await response.json()) as { error: string };
  assert.equal(response.status, 401);
  assert.equal(body.error, HOSTED_API_ERROR.INVALID_TOKEN);
});

test("a wrong method on the restored path still reaches the handler's own 405, not the group's not-found", async () => {
  const response = await answer(ratingRequest({ method: "GET" }));
  // SAFETY: the hosted error vocabulary's own answer, read back for its slug.
  const body = (await response.json()) as { error: string };
  assert.equal(response.status, 405);
  assert.equal(body.error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
});

test("a path the rewrite never restores this function to is the group's own not-found", async () => {
  const response = await answer(
    ratingRequest({ path: `/api/conversation/messages/${MESSAGE_ID}/rating` }),
  );
  // SAFETY: the hosted error vocabulary's own answer, read back for its slug.
  const body = (await response.json()) as { error: string };
  assert.equal(response.status, 404);
  assert.equal(body.error, HOSTED_API_ERROR.NOT_FOUND);
});
