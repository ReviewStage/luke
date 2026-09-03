import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_REASONING_EFFORT,
  brainResponsesOutput,
  brainResponsesRequest,
  functionCallOutputItem,
  isCompactionItem,
  userMessageItem,
} from "./brain-openai.js";
import { BRAIN_TOOL, brainToolDefinitions } from "./brain-tools.js";

test("the request asks for compaction on the API's default, stores nothing, and replays reasoning", () => {
  const request = brainResponsesRequest([userMessageItem("hello")], {
    model: "gpt-test",
    instructions: "be Luke",
    tools: brainToolDefinitions(),
    maximumOutputTokens: 1234,
    reasoningEffort: BRAIN_REASONING_EFFORT.MEDIUM,
  });
  assert.equal(request.model, "gpt-test");
  assert.equal(request.instructions, "be Luke");
  assert.equal(request.store, false);
  assert.deepEqual(request.context_management, [{ type: "compaction" }]);
  assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(request.reasoning, { effort: "medium" });
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.parallel_tool_calls, true);
  assert.equal(request.max_output_tokens, 1234);
  assert.deepEqual(request.input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
  ]);
  assert.ok(request.tools.some((tool) => tool.name === BRAIN_TOOL.ANNOUNCE));
});

test("the output reading keeps every item verbatim and picks out calls, text, compaction, and usage", () => {
  const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" };
  const call = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "announce",
    arguments: '{"briefing":"hi"}',
    status: "completed",
  };
  const compaction = { type: "compaction", id: "cmp_1", encrypted_content: "folded" };
  const message = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [
      { type: "output_text", text: "Sent. " },
      { type: "output_text", text: "Nothing else." },
    ],
  };
  const output = brainResponsesOutput({
    output: [compaction, reasoning, call, message],
    usage: { input_tokens: 4321, output_tokens: 12 },
    status: "completed",
  });
  assert.ok(output);
  assert.deepEqual(output.items, [compaction, reasoning, call, message]);
  assert.deepEqual(output.functionCalls, [
    { callId: "call_1", name: "announce", argumentsJson: '{"briefing":"hi"}' },
  ]);
  assert.equal(output.outputText, "Sent. Nothing else.");
  assert.equal(output.compacted, true);
  assert.equal(output.inputTokens, 4321);
  assert.equal(output.status, "completed");
  assert.ok(isCompactionItem(compaction));
  assert.ok(!isCompactionItem(reasoning));
});

test("a payload with no output array reads as nothing, and an incomplete one names why", () => {
  assert.equal(brainResponsesOutput({ error: "nope" }), undefined);
  assert.equal(brainResponsesOutput(undefined), undefined);
  const output = brainResponsesOutput({
    output: [],
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  });
  assert.ok(output);
  assert.equal(output.outputText, "");
  assert.equal(output.incompleteReason, "max_output_tokens");
});

test("a function call output carries the call id and a string output", () => {
  assert.deepEqual(functionCallOutputItem("call_9", '{"status":"accepted"}'), {
    type: "function_call_output",
    call_id: "call_9",
    output: '{"status":"accepted"}',
  });
});
