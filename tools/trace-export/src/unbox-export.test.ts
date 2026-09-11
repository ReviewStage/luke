import assert from "node:assert/strict";
import { BRAIN_TOOL, BRAIN_TURN_TRIGGER, hostedBrainToolCatalog } from "@sidecar/brain";
import { TRACE_DIRECTION, TRACE_ENTRY_KIND, TRACE_LIVE_EVENT } from "@sidecar/devtrace/vocabulary";
import { LIVE_DEFAULTS } from "@sidecar/live";
import { isRecord, type WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import { unboxTraceFromLines } from "./unbox-export.js";

function wireLine(at: string, direction: string, event: WireRecord): string {
  return JSON.stringify({ at, kind: TRACE_ENTRY_KIND.WIRE, direction, event });
}

function serverLine(at: string, event: WireRecord): string {
  return wireLine(at, TRACE_DIRECTION.SERVER, event);
}

function clientLine(at: string, event: WireRecord): string {
  return wireLine(at, TRACE_DIRECTION.CLIENT, event);
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

function rolesAndContent(
  generation: WireRecord | undefined,
): readonly (readonly [unknown, unknown])[] {
  return messagesOf(generation).map((message) => [message.role, message.content] as const);
}

const STARTED = serverLine("2026-09-01T10:00:00.000Z", {
  type: TRACE_LIVE_EVENT.SESSION_STARTED,
  session: { id: "sess_1", model: "gpt-live-1-preview" },
});

const ROSTER_NOTE = clientLine("2026-09-01T10:00:00.100Z", {
  type: TRACE_LIVE_EVENT.THINKING_APPEND,
  event_id: "evt_roster",
  delegation_id: null,
  content: "Two sessions are working.",
});

const ASK_FRAGMENTS = [
  serverLine("2026-09-01T10:00:01.000Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: "What is the ",
    start_ms: 1_000,
    end_ms: 1_400,
  }),
  serverLine("2026-09-01T10:00:01.500Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: "checkout agent doing?",
    start_ms: 1_400,
    end_ms: 2_000,
  }),
];

const DELEGATED = serverLine("2026-09-01T10:00:02.200Z", {
  type: TRACE_LIVE_EVENT.DELEGATION_CREATED,
  offset_ms: 2_200,
  delegation: { id: "dlg_1", target: "client" },
});

const COMMENTARY = clientLine("2026-09-01T10:00:04.200Z", {
  type: TRACE_LIVE_EVENT.COMMENTARY_APPEND,
  event_id: "evt_reply",
  delegation_id: "dlg_1",
  content: "It is waiting on you.",
});

const REPLY_FRAGMENTS = [
  serverLine("2026-09-01T10:00:05.000Z", {
    type: TRACE_LIVE_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    delta: "Checkout is ",
    start_ms: 5_000,
    end_ms: 5_400,
  }),
  serverLine("2026-09-01T10:00:05.500Z", {
    type: TRACE_LIVE_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    delta: "waiting on you.",
    start_ms: 5_400,
    end_ms: 6_000,
  }),
];

const USAGE = serverLine("2026-09-01T10:00:30.000Z", {
  type: TRACE_LIVE_EVENT.USAGE_UPDATED,
  usage: { seconds: 30 },
});

const CLOSED = serverLine("2026-09-01T10:00:42.000Z", {
  type: TRACE_LIVE_EVENT.SESSION_CLOSED,
  reason: "close_requested",
  usage: { seconds: 42 },
});

const EXCHANGE = [
  STARTED,
  ROSTER_NOTE,
  ...ASK_FRAGMENTS,
  DELEGATED,
  COMMENTARY,
  ...REPLY_FRAGMENTS,
];

test("a delegated exchange becomes one generation per boundary with the cumulative conversation", () => {
  const trace = unboxTraceFromLines([...EXCHANGE, USAGE, CLOSED], { name: "smoke" });
  assert.equal(trace.trace_id, "smoke");
  assert.equal(trace.timestamp, "2026-09-01T10:00:00.000Z");
  assert.deepEqual(trace.total_tokens, { input: 0, output: 0 });
  assert.equal(trace.session_seconds, 42);
  const [beforeDelegation, exchange, ...rest] = generations(trace);
  assert.deepEqual(rest, []);
  assert.equal(beforeDelegation?.type, "generation");
  assert.equal(beforeDelegation?.name, "session");
  assert.equal(beforeDelegation?.model, "gpt-live-1-preview");
  assert.deepEqual(rolesAndContent(beforeDelegation), [
    ["developer", "Two sessions are working."],
    ["user", "What is the checkout agent doing?"],
  ]);
  assert.equal(exchange?.name, "dlg_1");
  assert.deepEqual(exchange?.metrics, {
    latency: 2,
    tokens: { input: 0, output: 0 },
    cost: 0,
  });
  assert.deepEqual(rolesAndContent(exchange), [
    ["developer", "Two sessions are working."],
    ["user", "What is the checkout agent doing?"],
    ["assistant", "It is waiting on you."],
    ["assistant", "Checkout is waiting on you."],
  ]);
});

test("a session that never reported a model shows the live default, and an instruction reads as the developer's", () => {
  const stop = clientLine("2026-09-01T10:00:06.500Z", {
    type: TRACE_LIVE_EVENT.INSTRUCTIONS_APPEND,
    event_id: "evt_stop",
    delegation_id: null,
    content: "Stop speaking and wait.",
  });
  const [generation] = generations(unboxTraceFromLines([...REPLY_FRAGMENTS, stop]));
  assert.equal(generation?.model, LIVE_DEFAULTS.MODEL);
  assert.equal(generation?.name, "session");
  assert.deepEqual(rolesAndContent(generation), [
    ["assistant", "Checkout is waiting on you."],
    ["developer", "Stop speaking and wait."],
  ]);
});

test("two utterances a gap apart are two messages, and a late fragment joins the one its timing names", () => {
  const first = serverLine("2026-09-01T10:00:01.000Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: "Hello.",
    start_ms: 1_000,
    end_ms: 1_500,
  });
  const second = serverLine("2026-09-01T10:00:05.000Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: "Anything new?",
    start_ms: 5_000,
    end_ms: 5_800,
  });
  const late = serverLine("2026-09-01T10:00:05.100Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: " Luke.",
    start_ms: 1_500,
    end_ms: 1_900,
  });
  const [generation] = generations(unboxTraceFromLines([first, second, late]));
  assert.deepEqual(rolesAndContent(generation), [
    ["user", "Hello. Luke."],
    ["user", "Anything new?"],
  ]);
});

test("a second session continues the conversation and its seconds add to the first's", () => {
  const secondStarted = serverLine("2026-09-01T11:00:00.000Z", {
    type: TRACE_LIVE_EVENT.SESSION_STARTED,
    session: { id: "sess_2" },
  });
  const greeting = serverLine("2026-09-01T11:00:01.000Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: "Back again.",
    start_ms: 500,
    end_ms: 1_000,
  });
  const secondClosed = serverLine("2026-09-01T11:00:10.000Z", {
    type: TRACE_LIVE_EVENT.SESSION_CLOSED,
    reason: "expired",
    usage: { seconds: 10 },
  });
  const trace = unboxTraceFromLines([...EXCHANGE, CLOSED, secondStarted, greeting, secondClosed]);
  assert.equal(trace.session_seconds, 52);
  const last = generations(trace).at(-1);
  assert.equal(messagesOf(last).length, 5);
  assert.deepEqual(rolesAndContent(last).at(-1), ["user", "Back again."]);
});

test("a session that starts over one never closed settles the earlier one first", () => {
  const restarted = serverLine("2026-09-01T10:01:00.000Z", {
    type: TRACE_LIVE_EVENT.SESSION_STARTED,
    session: { id: "sess_2" },
  });
  const trace = unboxTraceFromLines([...ASK_FRAGMENTS, USAGE, restarted, ...REPLY_FRAGMENTS]);
  assert.equal(trace.session_seconds, 30);
  const [first, second] = generations(trace);
  assert.deepEqual(rolesAndContent(first), [["user", "What is the checkout agent doing?"]]);
  assert.deepEqual(rolesAndContent(second), [
    ["user", "What is the checkout agent doing?"],
    ["assistant", "Checkout is waiting on you."],
  ]);
});

test("a late fragment that only lengthens an earlier utterance still reaches a generation", () => {
  const late = serverLine("2026-09-01T10:00:02.400Z", {
    type: TRACE_LIVE_EVENT.INPUT_TRANSCRIPT_DELTA,
    delta: " Right now.",
    start_ms: 2_000,
    end_ms: 2_300,
  });
  const trace = unboxTraceFromLines([...ASK_FRAGMENTS, DELEGATED, late]);
  const [beforeDelegation, exchange] = generations(trace);
  assert.deepEqual(rolesAndContent(beforeDelegation), [
    ["user", "What is the checkout agent doing?"],
  ]);
  assert.equal(exchange?.name, "dlg_1");
  assert.deepEqual(rolesAndContent(exchange), [
    ["user", "What is the checkout agent doing? Right now."],
  ]);
});

test("a trace cut before the close still shows what was said, and an empty segment draws nothing", () => {
  const trace = unboxTraceFromLines([STARTED, DELEGATED, DELEGATED]);
  assert.deepEqual(generations(trace), []);
  const cut = unboxTraceFromLines([...ASK_FRAGMENTS]);
  assert.equal(generations(cut).length, 1);
  assert.equal(cut.session_seconds, 0);
});

test("a brain turn becomes its own generation, and junk lines cost only themselves", () => {
  const turn = JSON.stringify({
    at: "2026-08-25T10:05:00.000Z",
    kind: TRACE_ENTRY_KIND.BRAIN,
    trigger: BRAIN_TURN_TRIGGER.WAKE,
    tools: [...hostedBrainToolCatalog().keys()],
    inputItemKinds: ["message", "function_call_output"],
    inputTokens: 1_500,
    transcriptBytes: 4_096,
    toolCalls: [{ name: BRAIN_TOOL.ANNOUNCE, argumentsChars: 120, outcomeStatus: "accepted" }],
    outputText: "Checkout is waiting on you.",
    deliveries: [{ briefingChars: 96 }],
    elapsedMs: 321,
    iterations: 1,
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
  assert.deepEqual(toolNames, [...hostedBrainToolCatalog().keys()]);
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
