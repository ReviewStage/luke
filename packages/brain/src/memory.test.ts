import assert from "node:assert/strict";
import test from "node:test";
import { pairedDanglingCalls } from "./memory.js";
import { functionCallOutputItem, userMessageItem } from "./responses-api.js";

test("a function_call with no output anywhere after it is paired, and a paired one left alone", () => {
  const call = (id: string) => ({ type: "function_call", call_id: id, name: "x", arguments: "{}" });
  const items = [call("a"), functionCallOutputItem("a", "done"), call("b"), userMessageItem("x")];
  const paired = pairedDanglingCalls(items, (callId) => `unknown:${callId}`);
  assert.deepEqual(paired.slice(0, 4), items);
  assert.deepEqual(paired[4], functionCallOutputItem("b", "unknown:b"));
  const settled = [call("a"), functionCallOutputItem("a", "done")];
  assert.equal(
    pairedDanglingCalls(settled, () => ""),
    settled,
  );
});
