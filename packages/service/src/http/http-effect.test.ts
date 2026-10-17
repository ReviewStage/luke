// http-effect.test.ts -- the cache header hosted JSON answers carry.
import assert from "node:assert/strict";
import { HttpServerResponse } from "effect/http";
import { test } from "vitest";
import { hostedJsonResponse } from "./http-effect.js";

test("a hosted JSON answer is private and never stored unless its route says otherwise", async () => {
  const answer = HttpServerResponse.toWeb(hostedJsonResponse(200, { ok: true }));

  assert.equal(answer.headers.get("cache-control"), "private, no-store");
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { ok: true });
});

test("a route's own cache-control wins over the default", () => {
  const answer = HttpServerResponse.toWeb(
    hostedJsonResponse(200, { ok: true }, { cacheControl: "public, max-age=60" }),
  );

  assert.equal(answer.headers.get("cache-control"), "public, max-age=60");
});
