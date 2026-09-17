import assert from "node:assert/strict";
import { test } from "vitest";
import { isSettledToolPartState, TOOL_PART_STATE } from "./tool-parts.js";

test("a call is settled once it answered or failed, and pending before", () => {
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.OUTPUT_AVAILABLE), true);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.OUTPUT_ERROR), true);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.INPUT_AVAILABLE), false);
  assert.equal(isSettledToolPartState(TOOL_PART_STATE.INPUT_STREAMING), false);
});
