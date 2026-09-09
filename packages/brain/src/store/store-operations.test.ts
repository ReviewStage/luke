import assert from "node:assert/strict";
import test from "node:test";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { storeClient } from "./store-client.js";
import { STORE_OPERATIONS } from "./store-operations.js";
import type { StorePort } from "./wire.js";
import { serveStore } from "./worker-host.js";

/** A port that keeps what was posted and answers whatever the test hands back. */
function loopback() {
  const posted: unknown[] = [];
  let deliver: ((message: unknown) => void) | undefined;
  const port: StorePort = {
    postMessage: (message) => posted.push(message),
    on: (event, listener) => {
      // SAFETY: the "message" listener takes the wire values this test delivers; the others are never called.
      if (event === "message") deliver = listener as (message: unknown) => void;
    },
  };
  return { port, posted, deliver: (message: unknown) => deliver?.(message) };
}

test("every operation the table holds is a method of the client, and nothing else is", () => {
  const { port } = loopback();
  const client = storeClient(port);
  const methods = Object.keys(STORE_OPERATIONS).filter(
    (name) => typeof (client as Record<string, unknown>)[name] === "function",
  );
  assert.deepEqual(methods.sort(), Object.keys(STORE_OPERATIONS).sort());
});

test("a name the table does not hold is dropped, and an operation that throws answers with its own id while the next still answers", () => {
  const { port, posted, deliver } = loopback();
  serveStore(port);
  deliver({ id: 1, name: "history.destroy", params: {} });
  // A name outside the vocabulary reaches no operation and is answered by nothing.
  assert.deepEqual(posted, []);
  // The store is not open, so the operation throws; the error carries the request's id.
  deliver({ id: 2, name: "history.list", params: { sessionKey: MAIN_SESSION_KEY, now: 0 } });
  assert.deepEqual(posted, [{ id: 2, ok: false, error: "the brain's store is not open" }]);
  deliver({ id: 3, name: "conversations.list", params: {} });
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[1], { id: 3, ok: false, error: "the brain's store is not open" });
});
