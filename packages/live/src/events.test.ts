import assert from "node:assert/strict";
import { test } from "vitest";
import { LIVE_DELEGATION_TARGET, LIVE_SERVER_EVENT, parseLiveServerEvent } from "./events.js";

test("a transcript delta keeps its text exactly, whitespace included", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    event_id: "event_1",
    delta: " is",
    start_ms: 1_000,
    end_ms: 1_200,
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA) assert.fail(event.type);
  assert.equal(event.delta, " is");
  assert.equal(event.delta.length, 3);
});

test("a delegation is read for its id, target, and offset, never for words", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
    event_id: "event_delegation",
    offset_ms: 1_000,
    delegation: { id: "item_9tA2bF3h7K9m2P5q8R1s4", type: "delegation", target: "client" },
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.DELEGATION_CREATED) assert.fail(event.type);
  assert.equal(event.delegation.id, "item_9tA2bF3h7K9m2P5q8R1s4");
  assert.equal(event.delegation.target, LIVE_DELEGATION_TARGET.CLIENT);
  assert.equal(event.offset_ms, 1_000);
  assert.deepEqual(Object.keys(event.delegation).sort(), ["id", "target"]);
});
