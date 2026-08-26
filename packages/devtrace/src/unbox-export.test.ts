import assert from "node:assert/strict";
import test from "node:test";
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
  const tools = generation.available_tools;
  assert.ok(Array.isArray(tools) && tools.length === 1);
  const [tool] = tools.filter(isRecord);
  assert.equal(tool?.name, "open_session");
  assert.ok(isRecord(tool?.inputSchema));
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

test("an attention pass becomes its own generation, and junk lines cost only themselves", () => {
  const attention = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.ATTENTION,
    update: { title: "checkout-service", status: "waiting" },
    decision: { disposition: "silent" },
    elapsedMs: 321,
  });
  const trace = unboxTraceFromLines(["not json", attention]);
  const [generation] = generations(trace);
  assert.ok(generation);
  assert.equal(generation.name, "attention-review");
  const metrics = isRecord(generation.metrics) ? generation.metrics : undefined;
  assert.equal(metrics?.latency, 0.321);
  const [update, decision] = messagesOf(generation);
  assert.equal(update?.role, "user");
  assert.match(String(update?.content), /checkout-service/u);
  assert.equal(decision?.role, "assistant");
  assert.match(String(decision?.content), /silent/u);
});
