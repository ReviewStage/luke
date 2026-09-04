import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, type RealtimeFunctionCall } from "@sidecar/acts";
import {
  normalizeSession,
  OMISSION_MARKER,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
  type SessionProvider,
} from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  isWireString,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import {
  BRAIN_TURN_TRIGGER,
  BrainAgent,
  type BrainAgentOptions,
  type BrainRoster,
  type BrainTurnTraceRecord,
} from "./brain-agent.js";
import { BRAIN_CLIENT_OUTCOME, type BrainClient, type BrainClientAnswer } from "./brain-client.js";
import type { BrainDelivery, BrainWakeEvent } from "./brain-events.js";
import { BRAIN_INPUT_MARKER } from "./brain-input.js";
import type { BrainPersistedState } from "./brain-memory.js";
import { RESPONSES_ITEM_TYPE, type ResponsesInputItem } from "./brain-openai.js";
import { BRAIN_TOOL } from "./brain-tools.js";

const NOW = 1_800_000_000_000;
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const ABC: SessionIdentity = { providerId: claude.id, providerSessionId: "abc" };
const DEF: SessionIdentity = { providerId: claude.id, providerSessionId: "def" };
const UNKNOWN: SessionIdentity = { providerId: "codex", providerSessionId: "nope" };
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";

function session(id: string, overrides: Partial<ProviderSessionObservation> = {}): Session {
  return normalizeSession(claude, {
    providerSessionId: id,
    title: `Claude Code: ${id}`,
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    ...overrides,
  });
}

function hook(identity: SessionIdentity, atMs = NOW): BrainWakeEvent {
  return { hookEvent: "Stop", identity, atMs };
}

function rosterOf(...sessions: Session[]): BrainRoster {
  return {
    text: `Currently observed sessions:\n${sessions.map((s) => `- ${s.providerSessionId}`).join("\n")}`,
    identities: sessions.map(({ providerId, providerSessionId }) => ({
      providerId,
      providerSessionId,
    })),
    sessions,
  };
}

const DEFAULT_ROSTER = rosterOf(session("abc"), session("def"));

function message(text: string): WireRecord {
  return {
    type: RESPONSES_ITEM_TYPE.MESSAGE,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

function reasoning(id: string): WireRecord {
  return { type: RESPONSES_ITEM_TYPE.REASONING, id, summary: [], encrypted_content: "opaque" };
}

function call(callId: string, name: string, args: WireRecord): WireRecord {
  return {
    type: RESPONSES_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function readCall(callId: string, identity: SessionIdentity): WireRecord {
  return call(callId, BRAIN_TOOL.READ_TRANSCRIPT, {
    provider_id: identity.providerId,
    provider_session_id: identity.providerSessionId,
  });
}

function compaction(id: string): WireRecord {
  return { type: RESPONSES_ITEM_TYPE.COMPACTION, id, encrypted_content: "folded" };
}

function answered(output: readonly WireRecord[], inputTokens = 100): BrainClientAnswer {
  return {
    outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
    payload: { output, usage: { input_tokens: inputTokens } },
  };
}

class FakeClient implements BrainClient {
  readonly model = "fake-model";
  readonly inputs: ResponsesInputItem[][] = [];
  readonly toolNames: string[][] = [];
  readonly answers: BrainClientAnswer[] = [];
  quiet: number | undefined;
  fallback: BrainClientAnswer = answered([message("")]);

  respond(input: readonly ResponsesInputItem[], tools: readonly { name: string }[]) {
    this.inputs.push([...input]);
    this.toolNames.push(tools.map((tool) => tool.name));
    return Promise.resolve(this.answers.shift() ?? this.fallback);
  }

  quietUntil(): number | undefined {
    return this.quiet;
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

interface Harness {
  agent: BrainAgent;
  client: FakeClient;
  deliveries: BrainDelivery[];
  persisted: BrainPersistedState[];
  performed: RealtimeFunctionCall[];
  traces: BrainTurnTraceRecord[];
  sinceReads: { identity: SessionIdentity; cursor: string | undefined }[];
  wholeReads: SessionIdentity[];
}

function harness(overrides: Partial<BrainAgentOptions> = {}): Harness {
  const client = new FakeClient();
  const deliveries: BrainDelivery[] = [];
  const persisted: BrainPersistedState[] = [];
  const performed: RealtimeFunctionCall[] = [];
  const traces: BrainTurnTraceRecord[] = [];
  const sinceReads: Harness["sinceReads"] = [];
  const wholeReads: SessionIdentity[] = [];
  const agent = new BrainAgent({
    client,
    acts: {
      perform: async (functionCall) => {
        performed.push(functionCall);
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
    },
    roster: () => DEFAULT_ROSTER,
    standingContext: () => "Durable facts: none.",
    readTranscriptSince: async (identity, cursor): Promise<ProviderTranscriptSinceResult> => {
      sinceReads.push({ identity, cursor });
      return {
        status: ACT_RESULT_STATUS.ACCEPTED,
        text: `${TRANSCRIPT_SECRET} for ${identity.providerSessionId}`,
        cursor: `${identity.providerSessionId}-cursor`,
        truncated: false,
      };
    },
    readTranscript: async (identity): Promise<ProviderTranscriptResult> => {
      wholeReads.push(identity);
      return { status: ACT_RESULT_STATUS.ACCEPTED, transcript: "whole transcript" };
    },
    deliver: (delivery) => {
      deliveries.push(delivery);
    },
    persist: (state) => {
      persisted.push(state);
    },
    restore: () => undefined,
    trace: (record) => {
      traces.push(record);
    },
    report: () => {},
    now: () => NOW,
    ...overrides,
  });
  return { agent, client, deliveries, persisted, performed, traces, sinceReads, wholeReads };
}

function itemText(item: ResponsesInputItem | undefined): string {
  assert.ok(item && Array.isArray(item.content));
  const [first] = item.content;
  assert.ok(isRecord(first) && isWireString(first.text));
  return first.text;
}

function itemsOfType(items: readonly ResponsesInputItem[], type: string) {
  return items.filter((item) => item.type === type);
}

/** The latest observed-events opening in one request's input, behind the remembered turns. */
function openingBody(input: readonly ResponsesInputItem[]): WireRecord {
  const openings = itemsOfType(input, RESPONSES_ITEM_TYPE.MESSAGE)
    .map(itemText)
    .filter((text) => text.startsWith(`${BRAIN_INPUT_MARKER.OBSERVED_EVENTS} `));
  const opening = openings.at(-1);
  assert.ok(opening);
  const body = wireRecord(unparsedWire(JSON.parse(opening.slice(opening.indexOf("\n") + 1))));
  assert.ok(body);
  return body;
}

test("a roster look reads each session's delta once, carries the hooks, and puts the context last", async () => {
  const h = harness();
  h.agent.rosterLook([hook(ABC), hook(ABC, NOW + 500), hook(DEF, NOW + 1_000)]);
  await settle();

  assert.equal(h.client.inputs.length, 1);
  const input = h.client.inputs[0] ?? [];
  assert.equal(input.length, 2);
  const body = openingBody(input);
  assert.equal(body.scheduled_roster_look, true);
  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length, 2);
  const opening = itemText(input[0]);
  assert.equal(opening.split(`${TRANSCRIPT_SECRET} for abc`).length - 1, 1);
  assert.equal(opening.split(`${TRANSCRIPT_SECRET} for def`).length - 1, 1);
  assert.equal(opening.split('"hook":"Stop"').length - 1, 2);
  assert.ok(itemText(input[1]).startsWith(`${BRAIN_INPUT_MARKER.STANDING_CONTEXT} `));
  assert.ok(itemText(input[1]).includes("Durable facts: none."));
  assert.deepEqual(h.sinceReads, [
    { identity: ABC, cursor: undefined },
    { identity: DEF, cursor: undefined },
  ]);

  assert.equal(h.persisted.length, 1);
  assert.deepEqual(h.persisted[0]?.cursors, {
    "claude-code": { abc: "abc-cursor", def: "def-cursor" },
  });
  const remembered = h.persisted[0]?.items ?? [];
  assert.equal(remembered.length, 2);
  assert.ok(
    !remembered.some((item) => itemText(item).startsWith(BRAIN_INPUT_MARKER.STANDING_CONTEXT)),
  );
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  assert.deepEqual(h.traces[0]?.hooks, ["Stop", "Stop"]);
  assert.equal(h.traces[0]?.inputTokens, 100);
  assert.ok(!JSON.stringify(h.traces).includes(TRANSCRIPT_SECRET));
  assert.equal(h.traces[0]?.transcriptBytes, `${TRANSCRIPT_SECRET} for abc`.length * 2);
});

test("an announce is delivered trimmed, and every output item is remembered", async () => {
  const h = harness();
  h.client.answers.push(
    answered([
      reasoning("rs_1"),
      call("call_1", BRAIN_TOOL.ANNOUNCE, { briefing: "  Checkout agent wants a decision. " }),
    ]),
    answered([reasoning("rs_2"), message("said it")]),
  );
  h.agent.rosterLook([hook(ABC)]);
  await settle();

  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(h.deliveries, [
    { briefing: "Checkout agent wants a decision.", decidedAt: NOW },
  ]);
  const second = h.client.inputs[1] ?? [];
  const outputs = itemsOfType(second, RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]?.call_id, "call_1");
  assert.equal(itemsOfType(second, RESPONSES_ITEM_TYPE.REASONING).length, 1);
  assert.equal(itemsOfType(second, RESPONSES_ITEM_TYPE.FUNCTION_CALL).length, 1);
  const remembered = h.persisted[0]?.items ?? [];
  assert.deepEqual(
    remembered.map((item) => item.type),
    ["message", "reasoning", "function_call", "function_call_output", "reasoning", "message"],
  );
  assert.deepEqual(h.traces[0]?.toolCalls, [
    {
      name: BRAIN_TOOL.ANNOUNCE,
      argumentsChars: h.traces[0]?.toolCalls[0]?.argumentsChars,
      outcomeStatus: "accepted",
    },
  ]);
  assert.deepEqual(h.traces[0]?.deliveries, [{ briefingChars: 32 }]);
});

test("a roster turn is offered no act tool and refuses one before the performer runs", async () => {
  const h = harness();
  h.client.answers.push(
    answered([
      call("call_b", REALTIME_TOOL.SEND_SESSION_MESSAGE, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
        text: "run the tests",
      }),
    ]),
    answered([message("")]),
  );
  h.agent.rosterLook([hook(ABC)]);
  await settle();

  assert.deepEqual(h.performed, []);
  assert.deepEqual(h.client.toolNames[0], [BRAIN_TOOL.READ_TRANSCRIPT, BRAIN_TOOL.ANNOUNCE]);
  const outputs = itemsOfType(h.client.inputs[1] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  const refusal = outputs.find((item) => item.call_id === "call_b");
  assert.ok(
    refusal && isWireString(refusal.output) && refusal.output.includes("developer-ask turn"),
  );
  assert.equal(h.traces[0]?.toolCalls[0]?.outcomeStatus, ACT_RESULT_STATUS.REJECTED);
});

test("an ask returns the final text, is offered the acts, performs one, and refuses announce", async () => {
  const h = harness();
  h.client.answers.push(
    answered([
      call("call_a", BRAIN_TOOL.ANNOUNCE, { briefing: "nope" }),
      call("call_b", REALTIME_TOOL.SEND_SESSION_MESSAGE, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
        text: "run the tests",
      }),
    ]),
    answered([message("Sent.")]),
  );
  const answer = await h.agent.ask("tell the checkout agent to run the tests");

  assert.deepEqual(answer, { text: "Sent." });
  assert.deepEqual(h.deliveries, []);
  assert.deepEqual(h.performed, [
    {
      name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
      argumentsJson: JSON.stringify({
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
        text: "run the tests",
      }),
    },
  ]);
  assert.ok(h.client.toolNames[0]?.includes(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  const first = h.client.inputs[0] ?? [];
  const ask = itemText(first[0]);
  assert.ok(ask.startsWith(`${BRAIN_INPUT_MARKER.DEVELOPER_ASK} `));
  assert.ok(ask.includes("tell the checkout agent to run the tests"));
  assert.equal(h.sinceReads.length, 0);
  const outputs = itemsOfType(h.client.inputs[1] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  const refusal = outputs.find((item) => item.call_id === "call_a");
  assert.ok(refusal && isWireString(refusal.output) && refusal.output.includes("reply in text"));
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(h.traces[0]?.outputText, "Sent.");
});

test("an ask past its deadline answers nothing while the turn still finishes and persists", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = new FakeClient();
  const slow: BrainClient = {
    respond: async (input, tools) => {
      await gate;
      return inner.respond(input, tools);
    },
    quietUntil: () => undefined,
  };
  const h = harness({ client: slow, askDeadlineMs: 5 });
  assert.equal(await h.agent.ask("anything?"), undefined);
  release?.();
  await settle();
  assert.equal(h.persisted.length, 1);
});

test("the tool loop stops at its cap with every call answered, so no function_call dangles", async () => {
  const h = harness({ maxToolIterations: 2 });
  h.client.fallback = answered([readCall("loop", ABC)]);
  h.agent.rosterLook([hook(ABC)]);
  await settle();

  assert.equal(h.client.inputs.length, 3);
  const remembered = h.persisted[0]?.items ?? [];
  const calls = itemsOfType(remembered, RESPONSES_ITEM_TYPE.FUNCTION_CALL);
  const outputs = itemsOfType(remembered, RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  assert.equal(calls.length, 3);
  assert.equal(outputs.length, 3);
  const last = outputs[2];
  assert.ok(last && isWireString(last.output) && last.output.includes("tool budget"));
  assert.equal(h.traces[0]?.iterations, 3);
  assert.equal(h.traces[0]?.error, "tool iteration budget spent");
});

test("a compaction item drops everything before it from the remembered array", async () => {
  const h = harness();
  h.client.answers.push(answered([message("first turn")]));
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.persisted[0]?.items.length, 2);

  h.client.answers.push(answered([compaction("cmp_1"), reasoning("rs"), message("folded")]));
  h.agent.rosterLook([hook(DEF)]);
  await settle();
  const remembered = h.persisted[1]?.items ?? [];
  assert.deepEqual(
    remembered.map((item) => item.type),
    ["compaction", "reasoning", "message"],
  );
  assert.equal(h.traces[1]?.compacted, true);
  assert.equal(h.client.inputs[1]?.length, 4);
});

test("a failed turn rolls the memory and cursors back and persists nothing", async () => {
  const h = harness();
  h.client.answers.push({ outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason: "boom" });
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.persisted.length, 0);
  assert.equal(h.traces[0]?.error, "boom");

  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.client.inputs[1]?.length, 2);
  assert.deepEqual(
    h.sinceReads.map((read) => read.cursor),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(h.persisted.length, 1);
});

test("a call that fails mid-loop rolls back the whole turn, calls and all", async () => {
  const h = harness();
  h.client.answers.push(answered([readCall("call_1", ABC)]), {
    outcome: BRAIN_CLIENT_OUTCOME.FAILED,
    reason: "network",
  });
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.persisted.length, 0);
  h.agent.rosterLook([hook(DEF)]);
  await settle();
  assert.equal(itemsOfType(h.client.inputs[2] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL).length, 0);
});

test("a quiet turn rolls back so the next look reads the same deltas again", async () => {
  const h = harness();
  h.client.answers.push({ outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: NOW + 60_000 });
  h.agent.rosterLook([hook(ABC), hook(DEF)]);
  await settle();
  assert.equal(h.client.inputs.length, 1);
  assert.equal(h.persisted.length, 0);

  h.client.quiet = NOW + 60_000;
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.client.inputs.length, 1);
  assert.equal(h.sinceReads.length, 2);

  h.client.quiet = undefined;
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(
    h.sinceReads.map((read) => read.cursor),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(h.persisted.length, 1);
});

test("read_transcript answers a bounded tail for an observed session and refuses the rest", async () => {
  const h = harness({
    fullTranscriptChars: 60,
    readTranscript: async () => ({
      status: ACT_RESULT_STATUS.ACCEPTED,
      transcript: `${"x".repeat(100)}END`,
    }),
  });
  h.client.answers.push(
    answered([readCall("call_1", ABC), readCall("call_2", UNKNOWN)]),
    answered([message("")]),
  );
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  const outputs = itemsOfType(h.client.inputs[1] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  const read = outputs.find((item) => item.call_id === "call_1");
  assert.ok(read && isWireString(read.output));
  const record = wireRecord(unparsedWire(JSON.parse(read.output)));
  assert.ok(record);
  assert.equal(record.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(record.truncated, true);
  assert.ok(isWireString(record.transcript));
  assert.ok(record.transcript.startsWith(OMISSION_MARKER));
  assert.ok(record.transcript.endsWith("END"));
  assert.ok(record.transcript.length <= 60);
  const refused = outputs.find((item) => item.call_id === "call_2");
  assert.ok(refused && isWireString(refused.output) && refused.output.includes("not an observed"));
});

test("a delta longer than its bound is cut from the front and marked truncated", async () => {
  const h = harness({
    deltaPerSessionChars: 50,
    readTranscriptSince: async () => ({
      status: ACT_RESULT_STATUS.ACCEPTED,
      text: `${"y".repeat(200)}TAIL`,
      truncated: false,
    }),
  });
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  const opening = itemText(h.client.inputs[0]?.[0]);
  assert.ok(opening.includes(OMISSION_MARKER));
  assert.ok(opening.includes('"truncated":true'));
  assert.ok(opening.includes("TAIL"));
  assert.ok(!opening.includes("y".repeat(60)));
  assert.deepEqual(h.persisted[0]?.cursors, {});
});

test("restored memory opens the next turn, and held briefings are re-decided without acts", async () => {
  const prior = [compaction("cmp_0"), message("earlier")];
  const h = harness({
    restore: () => ({
      version: 1,
      items: prior,
      cursors: { "claude-code": { abc: "old" } },
    }),
  });
  h.client.answers.push(
    answered([call("call_1", BRAIN_TOOL.ANNOUNCE, { briefing: "Still waiting on you." })]),
    answered([message("")]),
  );
  h.agent.releaseHeld([{ briefing: "Checkout wants a decision.", decidedAt: NOW - 1 }]);
  await settle();
  const input = h.client.inputs[0] ?? [];
  assert.deepEqual(input.slice(0, 2), prior);
  assert.ok(itemText(input[2]).startsWith(`${BRAIN_INPUT_MARKER.HOLD_RELEASED} `));
  assert.deepEqual(h.client.toolNames[0], [BRAIN_TOOL.READ_TRANSCRIPT, BRAIN_TOOL.ANNOUNCE]);
  assert.deepEqual(h.deliveries, [{ briefing: "Still waiting on you.", decidedAt: NOW }]);
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.HOLD_RELEASED);
  assert.equal(h.sinceReads.length, 0);
});

test("stop takes nothing more", async () => {
  const h = harness();
  await h.agent.stop();
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  assert.equal(h.client.inputs.length, 0);
  assert.equal(await h.agent.ask("hello?"), undefined);
});

test("a roster look carries only the transcripts that grew, and hears a hook for an unseen session", async () => {
  const working = session("abc", { status: SESSION_STATUS.WORKING });
  const settled = session("def", { status: SESSION_STATUS.COMPLETE, lastActivityAt: NOW - 60_000 });
  const cloud = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "cloud-1",
      title: "Conductor: cloud",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: NOW,
      location: "cloud",
    },
  );
  const read: string[] = [];
  const h = harness({
    roster: () => rosterOf(working, settled, cloud),
    readTranscriptSince: async (identity): Promise<ProviderTranscriptSinceResult> => {
      read.push(identity.providerSessionId);
      return {
        status: ACT_RESULT_STATUS.ACCEPTED,
        text: identity.providerSessionId === "abc" ? "assistant: still going" : "",
        cursor: `${identity.providerSessionId}-cursor`,
        truncated: false,
      };
    },
  });
  h.agent.rosterLook();
  await settle();

  assert.equal(h.client.inputs.length, 1);
  const body = openingBody(h.client.inputs[0] ?? []);
  assert.equal(body.scheduled_roster_look, true);
  // Only the working local session's transcript is carried: the settled one
  // had no cursor and nothing live, the cloud one is not read on a look, and
  // a delta that came back empty is left out rather than reported as news.
  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length, 1);
  assert.equal(wireRecord(unparsedWire(body.events[0]))?.provider_session_id, "abc");
  assert.deepEqual(read, ["abc"]);
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);

  // A hook for a session the roster does not hold is still carried, and one
  // for a settled session reads it even with nothing live.
  h.agent.rosterLook([hook(UNKNOWN), hook(DEF)]);
  await settle();
  const second = openingBody(h.client.inputs[1] ?? []);
  assert.ok(Array.isArray(second.events));
  assert.deepEqual(
    second.events.map((event) => wireRecord(unparsedWire(event))?.provider_session_id),
    ["abc", "def", "nope"],
  );
  assert.deepEqual(read, ["abc", "abc", "def", "nope"]);
  await h.agent.stop();
});

test("a roster look is skipped while the client is quiet, and yields to a turn in flight unless a hook waits", async () => {
  const h = harness({
    roster: () => rosterOf(session("abc", { status: SESSION_STATUS.WORKING })),
  });

  h.client.quiet = NOW + 30_000;
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 0);
  assert.equal(h.sinceReads.length, 0);

  h.client.quiet = undefined;
  let release: (() => void) | undefined;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const respond = h.client.respond.bind(h.client);
  h.client.respond = async (input, tools) => {
    await slow;
    return respond(input, tools);
  };
  const ask = h.agent.ask("what's up?");
  await settle();
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 0);
  h.agent.rosterLook([hook(ABC)]);
  await settle();
  release?.();
  await ask;
  await settle();
  // The ask ran, then the hooked look queued behind it; the bare look was dropped.
  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(
    h.traces.map((trace) => trace.trigger),
    [BRAIN_TURN_TRIGGER.ASK, BRAIN_TURN_TRIGGER.ROSTER],
  );
  assert.deepEqual(h.traces[1]?.hooks, ["Stop"]);
  await h.agent.stop();
});
