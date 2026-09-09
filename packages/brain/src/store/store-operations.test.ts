import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime/vocabulary";
import { unparsedWire } from "@sidecar/wire";
import { STORE_LIFECYCLE, STORE_OPERATIONS } from "./store-operations.js";
import { type StoreMessage, type StorePort, storeRequestFromWire } from "./wire.js";
import { serveStore } from "./worker-host.js";

/** A port that keeps what the worker posted and delivers whatever a test sends. */
function loopback() {
  const posted: StoreMessage[] = [];
  let deliver: ((message: StoreMessage) => void) | undefined;
  const port: StorePort = {
    postMessage: (message) => posted.push(message),
    on: (event, listener) => {
      if (event !== "message") return;
      // SAFETY: the "message" listener takes what this test delivers; the others are never called.
      deliver = listener as (message: StoreMessage) => void;
    },
  };
  return { port, posted, deliver: (message: StoreMessage) => deliver?.(message) };
}

const OPEN_PARAMS = {
  agentRoot: "/agents/main",
  agentId: DEFAULT_AGENT_ID,
  sessionKey: MAIN_SESSION_KEY,
  conversationName: MAIN_CONVERSATION_NAME,
  now: 1_800_000_000_000,
};

test("the wire admits every name the table holds and no other, and reads the open's own parameters", () => {
  for (const name of Object.keys(STORE_OPERATIONS)) {
    assert.equal(storeRequestFromWire(unparsedWire({ id: 1, name, params: {} }))?.name, name);
  }
  assert.equal(
    storeRequestFromWire(unparsedWire({ id: 1, name: STORE_LIFECYCLE.CLOSE, params: {} }))?.name,
    STORE_LIFECYCLE.CLOSE,
  );
  const open = { id: 1, name: STORE_LIFECYCLE.OPEN, params: OPEN_PARAMS };
  assert.deepEqual(storeRequestFromWire(unparsedWire(open)), open);
  // The open is the one payload the worker acts on before any operation, so
  // it is read rather than assumed: a request missing a field of it is none.
  const { agentRoot: _root, ...incomplete } = OPEN_PARAMS;
  assert.equal(
    storeRequestFromWire(unparsedWire({ id: 1, name: STORE_LIFECYCLE.OPEN, params: incomplete })),
    undefined,
  );
  for (const name of ["history.destroy", "brain", "", "open.close"]) {
    assert.equal(storeRequestFromWire(unparsedWire({ id: 1, name, params: {} })), undefined);
  }
  assert.equal(storeRequestFromWire(unparsedWire({ name: "history.list" })), undefined);
});

test("a name the table does not hold is answered by nothing, and an operation that throws answers with its own id while the next still answers", () => {
  const { port, posted, deliver } = loopback();
  serveStore(port);
  // SAFETY: the test sends an unadmitted name on purpose; the read is what refuses it.
  deliver({ id: 1, name: "history.destroy", params: {} } as unknown as StoreMessage);
  assert.deepEqual(posted, []);
  // The store is not open, so the operation throws; the error carries the request's id.
  deliver({ id: 2, name: "history.list", params: { sessionKey: MAIN_SESSION_KEY, now: 0 } });
  deliver({ id: 3, name: "conversations.list", params: {} });
  assert.deepEqual(posted, [
    { id: 2, ok: false, error: "the brain's store is not open" },
    { id: 3, ok: false, error: "the brain's store is not open" },
  ]);
});
