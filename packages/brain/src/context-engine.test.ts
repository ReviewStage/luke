import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { CONTEXT_INPUT_KIND, checkpointFormatTag } from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { pairedDanglingCalls, ResponsesContextEngine } from "./context-engine.js";
import { functionCallOutputItem, userMessageItem } from "./responses-api.js";

const RUNTIME = { id: "tool-loop", version: 1 };
const LOST = JSON.stringify({ status: "unknown" });

function engine() {
  return new ResponsesContextEngine(RUNTIME);
}

test("the stamp joins the runtime and the item format, and an empty checkpoint loads as nothing", () => {
  const context = engine();
  assert.equal(
    checkpointFormatTag(context.checkpointFormat),
    "tool-loop@1:openai-responses-input/1",
  );
  assert.deepEqual(context.bootstrap(undefined, LOST), { loaded: true, repaired: 0 });
  assert.deepEqual(context.checkpoint().items, []);
});

test("a compatible checkpoint loads whole and pairs a dangling call with the lost result", () => {
  const context = engine();
  const items: WireRecord[] = [
    { type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE, role: "user", content: "hi" },
    { type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL, call_id: "c1", name: "act", arguments: "{}" },
  ];
  const result = context.bootstrap({ format: context.checkpointFormat, items }, LOST);
  assert.deepEqual(result, { loaded: true, repaired: 1 });
  assert.deepEqual(context.checkpoint().items.at(-1), {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    call_id: "c1",
    output: LOST,
  });
});

test("a valid checkpoint of another stamp is refused, named, and left alone rather than repaired", () => {
  const context = engine();
  const items = [{ type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE, role: "user", content: "hi" }];
  for (const format of [
    { ...context.checkpointFormat, runtime: "other-runtime" },
    { ...context.checkpointFormat, runtimeVersion: 2 },
    { ...context.checkpointFormat, format: "anthropic-messages" },
    { ...context.checkpointFormat, formatVersion: 2 },
  ]) {
    const result = context.bootstrap({ format, items }, LOST);
    assert.equal(result.loaded, false);
    assert.equal(result.repaired, 0);
    assert.deepEqual(context.checkpoint().items, []);
  }
});

test("words, model output, and tool results become their Responses items; ephemeral text rides last and is never kept", () => {
  const context = engine();
  context.bootstrap(undefined, LOST);
  context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "[developer ask] hello" });
  const call = {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: "c1",
    name: "act",
    arguments: "{}",
  };
  context.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: [call] });
  context.ingest({ kind: CONTEXT_INPUT_KIND.TOOL_RESULT, callId: "c1", outputJson: '{"ok":true}' });
  const assembled = context.assemble({ ephemeral: ["[standing context] roster"] });
  assert.equal(assembled.length, 4);
  assert.equal(assembled[0]?.type, RESPONSES_INPUT_ITEM_TYPE.MESSAGE);
  assert.deepEqual(assembled[1], call);
  assert.deepEqual(assembled[2], {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    call_id: "c1",
    output: '{"ok":true}',
  });
  assert.equal(assembled[3]?.role, "user");
  assert.equal(context.checkpoint().items.length, 3);
});

test("adopting items replaces everything retained, whatever the items are", () => {
  const context = engine();
  context.bootstrap(undefined, LOST);
  context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "one" });
  context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "two" });
  const inherited: WireRecord[] = [
    userMessageItem("a requester's ask"),
    { type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE, role: "assistant", content: [] },
  ];
  context.adopt(inherited);
  assert.deepEqual(context.checkpoint().items, inherited);
});

test("a mark rolls the items back and dispose empties them", () => {
  const context = engine();
  context.bootstrap(undefined, LOST);
  context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "kept" });
  const mark = context.mark();
  context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "dropped" });
  context.rollback(mark);
  assert.equal(context.checkpoint().items.length, 1);
  context.dispose();
  assert.equal(context.checkpoint().items.length, 0);
});

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
