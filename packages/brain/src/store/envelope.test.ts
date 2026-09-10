import assert from "node:assert/strict";
import test from "node:test";
import { freshBrainState } from "../envelope.js";
import { BRAIN_REQUEST_STATUS } from "../requests.js";
import { brainStateSave, SAVE_KIND } from "./envelope.js";
import { NOW, populatedState, receipt, request } from "./testing.js";

test("a first save and a new generation are whole envelopes naming what they replace", () => {
  const first = populatedState("gen-1");
  assert.deepEqual(brainStateSave(undefined, undefined, first), {
    kind: SAVE_KIND.REPLACE,
    state: first,
  });
  const second = freshBrainState("gen-2", NOW + 1);
  assert.deepEqual(brainStateSave(first, "gen-1", second), {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-1",
    state: second,
  });
  // An unreadable generation is still named as what the repair replaces.
  assert.deepEqual(brainStateSave(undefined, "gen-broken", second), {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-broken",
    state: second,
  });
});

test("within a generation a save carries only what changed, keyed the way the tables are", () => {
  const before = populatedState("gen-1");
  const after = {
    ...before,
    items: [...before.items, { type: "message", role: "assistant", content: "reply" }],
    compactionCount: before.compactionCount + 1,
    requests: [
      before.requests[0],
      request("run-2", { status: BRAIN_REQUEST_STATUS.SUCCEEDED, revision: 3, settledAt: NOW + 9 }),
    ].filter((r) => r !== undefined),
    journal: [receipt("run-2", "call-2", { outputJson: "{}", settledAt: NOW + 8 })],
  };
  const save = brainStateSave(before, "gen-1", after);
  assert.equal(save.kind, SAVE_KIND.AMEND);
  assert.ok(save.kind === SAVE_KIND.AMEND);
  assert.equal(save.generationId, "gen-1");
  assert.deepEqual(save.delta.items, { keepPrefix: 3, append: [after.items[3]] });
  assert.equal(save.delta.compactionCount, after.compactionCount);
  assert.deepEqual(save.delta.requests, {
    upsert: [{ ordinal: 1, record: after.requests[1] }],
    remove: [],
  });
  // The first receipt left, so the second moved up and is rewritten at its new place.
  assert.deepEqual(save.delta.journal, {
    upsert: [{ ordinal: 0, entry: after.journal[0] }],
    remove: [{ runId: "run-1", callId: "call-1" }],
  });
});

test("a rollback that shortens the items replaces from the divergence point, and an unchanged envelope carries nothing", () => {
  const before = populatedState("gen-1");
  const shorter = { ...before, items: before.items.slice(0, 1) };
  const save = brainStateSave(before, "gen-1", shorter);
  assert.ok(save.kind === SAVE_KIND.AMEND);
  assert.deepEqual(save.delta.items, { keepPrefix: 1, append: [] });
  const same = brainStateSave(before, "gen-1", { ...before, items: [...before.items] });
  assert.ok(same.kind === SAVE_KIND.AMEND);
  assert.deepEqual(same.delta, {});
});

test("a stamp that changes travels in the delta, cleared as well as set, and an unchanged one does not", () => {
  const before = populatedState("gen-1");
  const stamped = { ...before, checkpointFormat: "tool-loop@2:openai-responses-input/1" };
  const set = brainStateSave(before, "gen-1", stamped);
  assert.ok(set.kind === SAVE_KIND.AMEND);
  assert.deepEqual(set.delta.checkpointFormat, { stamp: stamped.checkpointFormat });
  const { checkpointFormat: _cleared, ...unstamped } = stamped;
  const cleared = brainStateSave(stamped, "gen-1", unstamped);
  assert.ok(cleared.kind === SAVE_KIND.AMEND);
  assert.deepEqual(cleared.delta.checkpointFormat, { stamp: undefined });
  const same = brainStateSave(stamped, "gen-1", { ...stamped });
  assert.ok(same.kind === SAVE_KIND.AMEND);
  assert.equal(same.delta.checkpointFormat, undefined);
});
