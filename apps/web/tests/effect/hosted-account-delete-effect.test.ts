import assert from "node:assert/strict";
import test from "node:test";
import * as Exit from "effect/Exit";
import {
  accountDeleteEffect,
  handleAccountDelete,
  runAccountDelete,
} from "../../server/hosted/account-delete";
import { runPromiseExit } from "../../src/effect/runtime-bridge";

function deleteRequest(): Request {
  return new Request("https://luke.test/api/account/delete", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
  });
}

function options() {
  return {
    request: deleteRequest(),
    resolveUserId: async () => "user-1",
    deleteUser: async () => {},
  };
}

test("accountDeleteEffect matches handleAccountDelete", async () => {
  const [promiseResponse, effectExit] = await Promise.all([
    handleAccountDelete(options()),
    runPromiseExit(accountDeleteEffect(options())),
  ]);

  assert.equal(Exit.isSuccess(effectExit), true);
  if (!Exit.isSuccess(effectExit)) return;

  const effectResponse = effectExit.value;
  assert.equal(effectResponse.status, promiseResponse.status);
  assert.deepEqual(await effectResponse.json(), await promiseResponse.json());
});

test("runAccountDelete resolves the same response as handleAccountDelete", async () => {
  const [promiseResponse, bridgeResponse] = await Promise.all([
    handleAccountDelete(options()),
    runAccountDelete(options()),
  ]);

  assert.equal(bridgeResponse.status, promiseResponse.status);
  assert.deepEqual(await bridgeResponse.json(), await promiseResponse.json());
});
