import assert from "node:assert/strict";
import test from "node:test";
import * as Exit from "effect/Exit";
import { handleUsage, runUsage, usageEffect } from "../../server/hosted/usage";
import { runPromiseExit } from "../../src/effect/runtime-bridge";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

function options() {
  const answer = {
    voice: { used: 1, limit: 50, remaining: 49, resetsAt: NOON_UTC + 43_200_000 },
    attention: { used: 2, limit: 500, remaining: 498, resetsAt: NOON_UTC + 43_200_000 },
  };
  return {
    request: new Request("https://luke.test/api/usage"),
    resolveUserId: async () => "user-1",
    readUsage: async () => answer,
  };
}

test("usageEffect matches handleUsage", async () => {
  const [promiseResponse, effectExit] = await Promise.all([
    handleUsage(options()),
    runPromiseExit(usageEffect(options())),
  ]);

  assert.equal(Exit.isSuccess(effectExit), true);
  if (!Exit.isSuccess(effectExit)) return;

  const effectResponse = effectExit.value;
  assert.equal(effectResponse.status, promiseResponse.status);
  assert.deepEqual(await effectResponse.json(), await promiseResponse.json());
});

test("runUsage resolves the same response as handleUsage", async () => {
  const [promiseResponse, bridgeResponse] = await Promise.all([
    handleUsage(options()),
    runUsage(options()),
  ]);

  assert.equal(bridgeResponse.status, promiseResponse.status);
  assert.deepEqual(await bridgeResponse.json(), await promiseResponse.json());
});
