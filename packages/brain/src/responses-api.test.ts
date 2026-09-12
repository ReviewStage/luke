import assert from "node:assert/strict";
import { MODEL_FAILURE, MODEL_RESPONSE_OUTCOME } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import {
  BRAIN_REASONING_EFFORT,
  BRAIN_REASONING_SUMMARY,
  brainResponsesOutput,
  brainResponsesRequest,
  functionCallItem,
  functionCallOutputItem,
  responsesModelAnswer,
  userMessageItem,
} from "./responses-api.js";
import { BRAIN_TOOL, hostedBrainToolCatalog } from "./tools.js";

test("the request asks the API for no compaction of its own, leaves storage at the API's default, and asks for reasoning it can replay and summarize", () => {
  const request = brainResponsesRequest([userMessageItem("hello")], {
    model: "gpt-test",
    instructions: "be Luke",
    tools: [...hostedBrainToolCatalog().values()],
    maximumOutputTokens: 1234,
    reasoningEffort: BRAIN_REASONING_EFFORT.MEDIUM,
  });
  assert.equal(request.model, "gpt-test");
  assert.equal(request.instructions, "be Luke");
  // Storage is the API's default: the response stands with OpenAI under its retention, named by its id.
  assert.equal("store" in request, false);
  // The host schedules compaction itself; a provider policy beside it would compete over one window.
  assert.equal("context_management" in request, false);
  // No key asked for, none sent: an absent field is not an empty one.
  assert.equal("prompt_cache_key" in request, false);
  assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(request.reasoning, { effort: "medium", summary: BRAIN_REASONING_SUMMARY });
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.parallel_tool_calls, true);
  assert.equal(request.max_output_tokens, 1234);
  assert.deepEqual(request.input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
  ]);
  assert.ok(request.tools.some((tool) => tool.name === BRAIN_TOOL.ANNOUNCE));
});

test("a forced tool choice names the one function the model must call and turns parallel calls off; without one the request is unchanged", () => {
  const base = {
    model: "gpt-test",
    instructions: "plan",
    tools: [...hostedBrainToolCatalog().values()].filter((tool) => tool.name === "plan_reads"),
    maximumOutputTokens: 600,
    reasoningEffort: BRAIN_REASONING_EFFORT.LOW,
  };
  const forced = brainResponsesRequest([userMessageItem("so far")], {
    ...base,
    toolChoice: "plan_reads",
  });
  assert.deepEqual(forced.tool_choice, { type: "function", name: "plan_reads" });
  assert.equal(forced.parallel_tool_calls, false);
  assert.equal(forced.tools.length, 1);
  const free = brainResponsesRequest([userMessageItem("so far")], base);
  assert.equal(free.tool_choice, "auto");
  assert.equal(free.parallel_tool_calls, true);
});

test("a minted function call carries exactly the three fields the API documents and the hosted admission replays", () => {
  assert.deepEqual(functionCallItem("call_1", "read_transcript", '{"provider_id":"p"}'), {
    type: "function_call",
    call_id: "call_1",
    name: "read_transcript",
    arguments: '{"provider_id":"p"}',
  });
  assert.deepEqual(Object.keys(functionCallItem("c", "n", "{}")), [
    "type",
    "call_id",
    "name",
    "arguments",
  ]);
});

test("the output reading keeps every item verbatim, an item it does not read included, and picks out calls, text, and usage", () => {
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
  assert.equal(output.inputTokens, 4321);
  assert.equal(output.status, "completed");
});

test("two message items in one answer are two paragraphs of its text, and an empty one adds none", () => {
  const first = {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Looking now." }],
  };
  const silent = { type: "message", role: "assistant", status: "completed", content: [] };
  const second = {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Two agents are waiting." }],
  };
  const output = brainResponsesOutput({ output: [first, silent, second], status: "completed" });
  assert.ok(output);
  assert.equal(output.outputText, "Looking now.\n\nTwo agents are waiting.");
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

test("a response the provider marks failed, cancelled, or under way is a provider failure, never an empty reply", () => {
  const failed = responsesModelAnswer({
    status: "failed",
    error: { code: "server_error", message: "synthetic failure" },
    output: [],
  });
  assert.deepEqual(failed, {
    outcome: MODEL_RESPONSE_OUTCOME.FAILED,
    failure: MODEL_FAILURE.UPSTREAM,
    reason: "response failed: server_error",
  });
  for (const status of ["cancelled", "in_progress", "queued"]) {
    const answer = responsesModelAnswer({ status, output: [] });
    assert.equal(answer?.outcome, MODEL_RESPONSE_OUTCOME.FAILED, status);
  }
  const completed = responsesModelAnswer({
    status: "completed",
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
    ],
    usage: { input_tokens: 3, output_tokens: 1 },
  });
  assert.ok(completed?.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(completed.text, "hi");
  assert.deepEqual(completed.usage, { inputTokens: 3, outputTokens: 1 });
  const incomplete = responsesModelAnswer({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [],
  });
  assert.ok(incomplete?.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.deepEqual(incomplete.incomplete, { status: "incomplete", reason: "max_output_tokens" });
  assert.equal(responsesModelAnswer({ id: "resp" }), undefined);
});

test("a prompt cache key rides on the request as the routing hint it is", () => {
  const request = brainResponsesRequest([userMessageItem("hello")], {
    model: "gpt-test",
    instructions: "be Luke",
    tools: [],
    maximumOutputTokens: 1234,
    reasoningEffort: BRAIN_REASONING_EFFORT.MEDIUM,
    promptCacheKey: "9f86d0818",
  });
  assert.equal(request.prompt_cache_key, "9f86d0818");
  // The key routes a prefix cache; it decides nothing about storage, which stays the API's default.
  assert.equal("store" in request, false);
});

test("the response id, each reasoning item's summary, and the four-way usage are read beside the items, which stay verbatim", () => {
  const summarized = {
    type: "reasoning",
    id: "rs_1",
    summary: [
      { type: "summary_text", text: "Checking which session is waiting." },
      { type: "summary_text", text: "Only one needs a reply." },
    ],
    encrypted_content: "opaque",
  };
  const wordless = { type: "reasoning", id: "rs_2", summary: [], encrypted_content: "opaque" };
  const answer = responsesModelAnswer({
    id: "resp_1",
    status: "completed",
    output: [
      summarized,
      wordless,
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
    ],
    usage: {
      input_tokens: 900,
      output_tokens: 120,
      input_tokens_details: { cached_tokens: 768 },
      output_tokens_details: { reasoning_tokens: 100 },
    },
  });
  assert.ok(answer?.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(answer.responseId, "resp_1");
  assert.deepEqual(answer.usage, {
    inputTokens: 900,
    outputTokens: 120,
    cachedInputTokens: 768,
    reasoningTokens: 100,
  });
  // One summary per item that has words, joined as paragraphs, the encrypted
  // content lifted beside it and the item whole; an item with none is not a summary.
  assert.deepEqual(answer.reasoning, [
    {
      itemId: "rs_1",
      summary: "Checking which session is waiting.\n\nOnly one needs a reply.",
      encryptedContent: "opaque",
      item: summarized,
    },
  ]);
  // The items themselves are untouched: the opaque content rides with the summary for replay.
  assert.deepEqual(answer.items[0], summarized);
  assert.deepEqual(answer.items[1], wordless);
  // An answer that names no id and carries no summary says neither, rather than an empty one.
  const bare = responsesModelAnswer({
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [] }],
    usage: { input_tokens: 1, output_tokens: 0 },
  });
  assert.ok(bare?.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal("responseId" in bare, false);
  assert.equal("reasoning" in bare, false);
});

test("the cached input tokens the API reports are read for the trace", () => {
  const answer = responsesModelAnswer({
    status: "completed",
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
    ],
    usage: { input_tokens: 900, output_tokens: 12, input_tokens_details: { cached_tokens: 768 } },
  });
  assert.ok(answer?.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(answer.usage?.inputTokens, 900);
  assert.equal(answer.usage?.cachedInputTokens, 768);
});
