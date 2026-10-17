// http-effect.test.ts -- the cache header hosted JSON answers carry.
import assert from "node:assert/strict";
import { HttpServerResponse } from "effect/http";
import { test } from "vitest";
import { hostedJsonResponse } from "./http-effect.js";

test("a hosted JSON answer is private and never stored", async () => {
  const answer = HttpServerResponse.toWeb(hostedJsonResponse(200, { ok: true }));

  assert.equal(answer.headers.get("cache-control"), "private, no-store");
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { ok: true });
});
