import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime/vocabulary";
import { type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import { STORE_LIFECYCLE, STORE_OPERATIONS } from "./store-operations.js";
import { type StoreMessage, type StorePort, storeRequestFromWire } from "./wire.js";
import { serveStore, UNREADABLE_REQUEST } from "./worker-host.js";

/**
 * A port that keeps what the worker posted and delivers whatever a test
 * sends. What it sends is boundary input, admitted or not, because the read
 * on the other side is the thing under test.
 */
function loopback() {
  const posted: StoreMessage[] = [];
  let deliver: ((message: UnparsedWireValue) => void) | undefined;
  const port: StorePort = {
    postMessage: (message) => posted.push(message),
    on: (event, listener) => {
      if (event !== "message") return;
      // SAFETY: the "message" listener takes the wire values this test delivers; the others are never called.
      deliver = listener as (message: UnparsedWireValue) => void;
    },
  };
  return { port, posted, deliver: (message: UnparsedWireValue) => deliver?.(message) };
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
  assert.equal(storeRequestFromWire(unparsedWire({ name: "conversation.list" })), undefined);
});

test("every request that named an id is answered under it, readable or not, and one that named none is dropped", () => {
  const { port, posted, deliver } = loopback();
  serveStore(port);
  // A name outside the table, and an open whose parameters the read refuses:
  // neither reaches an operation, and both are still answered, because a
  // caller waiting on an id it minted would otherwise wait forever.
  deliver({ id: 1, name: "history.destroy", params: {} });
  deliver({ id: 2, name: STORE_LIFECYCLE.OPEN, params: {} });
  assert.deepEqual(posted, [
    { id: 1, ok: false, error: UNREADABLE_REQUEST },
    { id: 2, ok: false, error: UNREADABLE_REQUEST },
  ]);
  // A message that named no id can only be dropped: there is nothing to answer under.
  deliver({ name: "history.destroy" });
  assert.equal(posted.length, 2);
  // The store is not open, so the operation throws; the error carries the request's id.
  deliver({ id: 3, name: "conversation.list", params: { sessionKey: MAIN_SESSION_KEY, now: 0 } });
  deliver({ id: 4, name: "conversations.list", params: {} });
  assert.deepEqual(posted.slice(2), [
    { id: 3, ok: false, error: "the brain's store is not open" },
    { id: 4, ok: false, error: "the brain's store is not open" },
  ]);
});
