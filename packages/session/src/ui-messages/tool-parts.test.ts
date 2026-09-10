import assert from "node:assert/strict";
import test from "node:test";
import { isSettledToolPartState, isToolPartState, TOOL_PART_STATE } from "./tool-parts.js";

test("the stored tool states are the SDK's four, and the approval states are outside the set", () => {
  assert.deepEqual(Object.values(TOOL_PART_STATE), [
    "input-streaming",
    "input-available",
    "output-available",
    "output-error",
  ]);
  for (const state of Object.values(TOOL_PART_STATE)) assert.equal(isToolPartState(state), true);
  assert.equal(isToolPartState("approval-requested"), false);
  assert.equal(isToolPartState("approval-responded"), false);
  assert.equal(isToolPartState("output-denied"), false);
});

test("a call is settled once it answered or failed, and pending before", () => {
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.OUTPUT_AVAILABLE), true);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.OUTPUT_ERROR), true);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.INPUT_AVAILABLE), false);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.INPUT_STREAMING), false);
});
