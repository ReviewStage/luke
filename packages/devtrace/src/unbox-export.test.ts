import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_TOOL, BRAIN_TURN_TRIGGER, brainToolDefinitions } from "@sidecar/brain";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { TRACE_ENTRY_KIND } from "./trace-writer.js";
import { unboxTraceFromLines } from "./unbox-export.js";
import { TRACE_DIRECTION } from "./vocabulary.js";

function wireLine(at: string, direction: string, event: WireRecord): string {
  return JSON.stringify({ at, kind: TRACE_ENTRY_KIND.WIRE, direction, event });
}

function generations(trace: WireRecord): readonly WireRecord[] {
  const events = trace.events;
  return Array.isArray(events) ? events.filter(isRecord) : [];
}

function messagesOf(generation: WireRecord | undefined): readonly WireRecord[] {
  const messages = generation?.messages;
  return Array.isArray(messages) ? messages.filter(isRecord) : [];
}

function toolsOf(generation: WireRecord | undefined): readonly WireRecord[] {
  const tools = generation?.available_tools;
  return Array.isArray(tools) ? tools.filter(isRecord) : [];
}

const SESSION_SYNC = wireLine("2026-08-25T10:00:00.000Z", TRACE_DIRECTION.CLIENT, {
  type: "session.update",
  session: {
    instructions: "You are Luke.",
    tools: [
      {
        type: "function",
        name: "open_session",
        description: "Opens a session.",
        parameters: { type: "object", properties: { title: { type: "string" } } },
      },
    ],
  },
});

const TYPED_ASK = wireLine("2026-08-25T10:00:01.000Z", TRACE_DIRECTION.CLIENT, {
  type: "conversation.item.create",
  item: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "What is the checkout agent doing?" }],
  },
});

const RESPONSE_ASKED = wireLine("2026-08-25T10:00:01.200Z", TRACE_DIRECTION.CLIENT, {
  type: "response.create",
});

const RESPONSE_DONE = wireLine("2026-08-25T10:00:03.200Z", TRACE_DIRECTION.SERVER, {
  type: "response.done",
  response: {
    id: "resp_1",
    usage: {
      input_tokens: 900,
      output_tokens: 40,
      input_token_details: { cached_tokens: 512 },
    },
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_audio", transcript: "It is waiting on you." }],
      },
    ],
  },
});

test("a replied turn becomes one generation with the cumulative conversation", () => {
  const trace = unboxTraceFromLines([SESSION_SYNC, TYPED_ASK, RESPONSE_ASKED, RESPONSE_DONE], {
    name: "smoke",
  });
  assert.equal(trace.trace_id, "smoke");
  assert.equal(trace.timestamp, "2026-08-25T10:00:00.000Z");
  assert.deepEqual(trace.total_tokens, { input: 900, output: 40 });
  const [generation] = generations(trace);
  assert.ok(generation);
  assert.equal(generation.type, "generation");
  assert.equal(generation.name, "resp_1");
  assert.deepEqual(generation.metrics, {
    latency: 2,
    tokens: { input: 900, output: 40, cache_read: 512 },
    cost: 0,
  });
  const tools = toolsOf(generation);
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "open_session");
  assert.ok(isRecord(tools[0]?.inputSchema));
  assert.deepEqual(
    messagesOf(generation).map((message) => [message.role, message.content]),
    [
      ["system", "You are Luke."],
      ["user", "What is the checkout agent doing?"],
      ["assistant", "It is waiting on you."],
    ],
  );
});

test("a tool call pairs with its output across two generations", () => {
  const callDone = wireLine("2026-08-25T10:00:03.000Z", TRACE_DIRECTION.SERVER, {
    type: "response.done",
    response: {
      id: "resp_call",
      usage: { input_tokens: 10, output_tokens: 5 },
      output: [
        {
          type: "function_call",
          name: "open_session",
          call_id: "call_1",
          arguments: '{"title":"checkout"}',
        },
      ],
    },
  });
  const callOutput = wireLine("2026-08-25T10:00:03.500Z", TRACE_DIRECTION.CLIENT, {
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: "call_1", output: '{"status":"accepted"}' },
  });
  const trace = unboxTraceFromLines([SESSION_SYNC, TYPED_ASK, callDone, callOutput, RESPONSE_DONE]);
  const [first, second] = generations(trace);
  const callMessage = messagesOf(first).at(-1);
  const calls: WireValue | undefined = callMessage?.tool_calls;
  assert.ok(Array.isArray(calls));
  const [call] = calls.filter(isRecord);
  assert.deepEqual(call, {
    type: "function",
    id: "call_1",
    function: { name: "open_session", arguments: '{"title":"checkout"}' },
  });
  const roles = messagesOf(second).map((message) => message.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "tool", "assistant"]);
  const output = messagesOf(second).find((message) => message.role === "tool");
  assert.equal(output?.tool_call_id, "call_1");
});

test("a spoken turn's transcription joins the conversation as the developer's words", () => {
  const transcription = wireLine("2026-08-25T10:00:02.000Z", TRACE_DIRECTION.SERVER, {
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "Read me the update.",
  });
  const trace = unboxTraceFromLines([SESSION_SYNC, transcription, RESPONSE_DONE]);
  const [generation] = generations(trace);
  const user = messagesOf(generation).find((message) => message.role === "user");
  assert.equal(user?.content, "Read me the update.");
});

test("a brain turn becomes its own generation, and junk lines cost only themselves", () => {
  const turn = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN,
    trigger: BRAIN_TURN_TRIGGER.WAKE,
    inputItemKinds: ["message", "function_call_output"],
    inputTokens: 1_500,
    transcriptBytes: 4_096,
    toolCalls: [{ name: BRAIN_TOOL.ANNOUNCE, argumentsChars: 120, outcomeStatus: "accepted" }],
    outputText: "Checkout is waiting on you.",
    deliveries: [{ briefingChars: 96 }],
    elapsedMs: 321,
    iterations: 1,
    compacted: false,
  });
  const trace = unboxTraceFromLines(["not json", turn]);
  assert.deepEqual(trace.total_tokens, { input: 1_500, output: 0 });
  const [generation] = generations(trace);
  assert.ok(generation);
  assert.equal(generation.name, "brain-turn");
  // A record carrying no model — a hosted turn — shows the keyed default
  // rather than a blank.
  assert.equal(generation.model, "gpt-5.6-terra");
  assert.deepEqual(generation.metrics, {
    latency: 0.321,
    tokens: { input: 1_500, output: 0 },
    cost: 0,
  });
  const toolNames = toolsOf(generation).map((tool) => tool.name);
  assert.deepEqual(
    toolNames,
    brainToolDefinitions().map((tool) => tool.name),
  );
  const announce = toolsOf(generation).find((tool) => tool.name === BRAIN_TOOL.ANNOUNCE);
  assert.equal(announce?.type, "function");
  assert.ok(isRecord(announce?.inputSchema));
  const [input, output] = messagesOf(generation);
  assert.equal(input?.role, "user");
  assert.equal(
    input?.content,
    ["trigger: wake", "input items: message, function_call_output", "transcript bytes: 4096"].join(
      "\n",
    ),
  );
  assert.equal(output?.role, "assistant");
  assert.equal(
    output?.content,
    ["Checkout is waiting on you.", "tool call: announce -> accepted", "delivery: 96 chars"].join(
      "\n",
    ),
  );
});

test("a failed brain turn shows its error, and a keyed turn its model", () => {
  const turn = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN,
    trigger: BRAIN_TURN_TRIGGER.ASK,
    inputItemKinds: [],
    transcriptBytes: 0,
    toolCalls: [],
    deliveries: [],
    elapsedMs: 100,
    iterations: 0,
    compacted: false,
    model: "gpt-5.6-luna",
    error: "request failed with status 500",
  });
  const [generation] = generations(unboxTraceFromLines([turn]));
  assert.equal(generation?.model, "gpt-5.6-luna");
  const [input, output] = messagesOf(generation);
  assert.equal(
    input?.content,
    ["trigger: ask", "input items: none", "transcript bytes: 0"].join("\n"),
  );
  assert.equal(output?.content, "error: request failed with status 500");
});

test("a brain digest entry becomes its own tool-free generation, counts and fixed values only", () => {
  const digest = JSON.stringify({
    at: "2026-08-25T10:04:59.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN_DIGEST,
    transcriptChars: 4_096,
    truncated: true,
    outcome: "answered",
    elapsedMs: 700,
    stopState: "finished",
    digestChars: 180,
  });
  const [generation] = generations(unboxTraceFromLines([digest]));
  assert.ok(generation);
  assert.equal(generation.name, "brain-digest");
  assert.equal(generation.model, "gpt-5.6-luna");
  assert.deepEqual(toolsOf(generation), []);
  const [input, output] = messagesOf(generation);
  assert.equal(input?.content, ["transcript chars: 4096", "front cut: yes"].join("\n"));
  assert.equal(
    output?.content,
    ["outcome: answered", "stop state: finished", "digest chars: 180"].join("\n"),
  );

  const failed = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN_DIGEST,
    transcriptChars: 12,
    truncated: false,
    outcome: "failed",
    elapsedMs: 50,
    model: "gpt-other",
    error: "request failed with status 500",
  });
  const [failedGeneration] = generations(unboxTraceFromLines([failed]));
  assert.equal(failedGeneration?.model, "gpt-other");
  assert.equal(
    messagesOf(failedGeneration)[1]?.content,
    ["outcome: failed", "error: request failed with status 500"].join("\n"),
  );
});

test("a brain request entry stays in the raw trace and draws no generation", () => {
  const request = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN_REQUEST,
    inputItems: 3,
    inputChars: 2_048,
    outcome: "answered",
    elapsedMs: 900,
  });
  const trace = unboxTraceFromLines([request]);
  assert.equal(trace.timestamp, "2026-08-25T10:05:00.000Z");
  assert.deepEqual(generations(trace), []);
});
