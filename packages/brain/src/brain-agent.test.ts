import assert from "node:assert/strict";
import test from "node:test";
import type { RealtimeFunctionCall } from "@sidecar/acts";
import type { ScheduledTimer } from "@sidecar/realtime";
import {
  normalizeSession,
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
  type BrainTurnTraceRecord,
  OMISSION_MARKER,
} from "./brain-agent.js";
import {
  BRAIN_CLIENT_OUTCOME,
  type BrainClient,
  type BrainClientAnswer,
  type BrainRespondOptions,
} from "./brain-client.js";
import { DIGEST_SOURCE, DIGEST_STOP_STATE, type DigestInput } from "./brain-digest.js";
import type { DigestClient, DigestClientAnswer } from "./brain-digest-client.js";
import {
  BRAIN_DELIVERY_SOURCE,
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainWakeEvent,
} from "./brain-events.js";
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

function edge(identity: SessionIdentity, atMs = NOW): BrainWakeEvent {
  return {
    kind: BRAIN_WAKE_KIND.HOOK,
    hookEvent: "stop",
    identity,
    session: session(identity.providerSessionId),
    atMs,
  };
}

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
  readonly answers: BrainClientAnswer[] = [];
  quiet: number | undefined;
  fallback: BrainClientAnswer = answered([message("")]);

  respond(input: readonly ResponsesInputItem[], _options: BrainRespondOptions) {
    this.inputs.push([...input]);
    return Promise.resolve(this.answers.shift() ?? this.fallback);
  }

  quietUntil(): number | undefined {
    return this.quiet;
  }
}

class FakeDigestClient implements DigestClient {
  readonly model = "fake-digest-model";
  readonly inputs: DigestInput[] = [];
  readonly answers: DigestClientAnswer[] = [];
  quiet: number | undefined;
  /** While set, every call waits here until the test releases it. */
  hold = false;
  readonly held: (() => void)[] = [];
  inFlight = 0;
  peakInFlight = 0;

  async summarize(input: DigestInput): Promise<DigestClientAnswer> {
    this.inputs.push(input);
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
    this.inFlight -= 1;
    return (
      this.answers.shift() ?? {
        outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
        digest: {
          stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER,
          lastAsk: "the developer's ask",
          didSince: `digested ${input.transcript.length} chars`,
        },
      }
    );
  }

  quietUntil(): number | undefined {
    return this.quiet;
  }

  release(): void {
    for (const resume of this.held.splice(0)) resume();
  }
}

class FakeClock {
  now = NOW;
  readonly timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();

  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };

  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };

  /** Fires every timer due by `until`, advancing the clock to each in order. */
  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      await settle();
    }
    this.now = Math.max(this.now, untilMs);
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

interface Harness {
  agent: BrainAgent;
  client: FakeClient;
  digest: FakeDigestClient;
  clock: FakeClock;
  deliveries: BrainDelivery[];
  persisted: BrainPersistedState[];
  performed: RealtimeFunctionCall[];
  traces: BrainTurnTraceRecord[];
  sinceReads: { identity: SessionIdentity; cursor: string | undefined }[];
  wholeReads: SessionIdentity[];
}

function harness(
  overrides: Partial<BrainAgentOptions> = {},
  { withDigest = true }: { withDigest?: boolean } = {},
): Harness {
  const client = new FakeClient();
  const digest = new FakeDigestClient();
  const clock = new FakeClock();
  const deliveries: BrainDelivery[] = [];
  const persisted: BrainPersistedState[] = [];
  const performed: RealtimeFunctionCall[] = [];
  const traces: BrainTurnTraceRecord[] = [];
  const sinceReads: Harness["sinceReads"] = [];
  const wholeReads: SessionIdentity[] = [];
  const agent = new BrainAgent({
    client,
    ...(withDigest ? { digest } : undefined),
    acts: {
      perform: async (functionCall) => {
        performed.push(functionCall);
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
    },
    roster: () => ({ text: "Currently observed sessions:\n- abc\n- def", identities: [ABC, DEF] }),
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
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    wakeCoalesceMs: 3_000,
    ...overrides,
  });
  return {
    agent,
    client,
    digest,
    clock,
    deliveries,
    persisted,
    performed,
    traces,
    sinceReads,
    wholeReads,
  };
}

/** The observed-events body of a turn's opening item, parsed. */
function openingBody(item: ResponsesInputItem | undefined): WireRecord {
  const opening = itemText(item);
  const body = wireRecord(unparsedWire(JSON.parse(opening.slice(opening.indexOf("\n") + 1))));
  assert.ok(body);
  return body;
}

/** The item a later turn opened with: the one before the standing context, after the remembered items. */
function latestOpening(
  input: readonly ResponsesInputItem[] | undefined,
): ResponsesInputItem | undefined {
  return input?.at(-2);
}

function eventRecords(body: WireRecord): WireRecord[] {
  const events = Array.isArray(body.events) ? body.events : body.events_since_last_turn;
  assert.ok(Array.isArray(events));
  return events.map((event) => {
    const record = wireRecord(unparsedWire(event));
    assert.ok(record);
    return record;
  });
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

test("wakes inside the window open one turn, with each session read and digested once and the context last", async () => {
  const h = harness();
  h.agent.wake([edge(ABC)]);
  h.agent.wake([edge(ABC, NOW + 500), edge(DEF, NOW + 1_000)]);
  assert.equal(h.client.inputs.length, 0);
  await h.clock.advance(NOW + 3_000);

  assert.equal(h.client.inputs.length, 1);
  const input = h.client.inputs[0] ?? [];
  assert.equal(input.length, 2);
  const wake = itemText(input[0]);
  assert.ok(wake.startsWith(`${BRAIN_INPUT_MARKER.OBSERVED_EVENTS} `));
  assert.ok(!wake.includes(TRANSCRIPT_SECRET));
  const events = eventRecords(openingBody(input[0]));
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.deepEqual(event.transcript_digest, {
      status: "accepted",
      truncated: false,
      source: "model",
      stop_state: "waiting-for-developer",
      last_ask: "the developer's ask",
      did_since: `digested ${`${TRANSCRIPT_SECRET} for abc`.length} chars`,
    });
    assert.ok(!("transcript_delta" in event));
  }
  assert.deepEqual(
    h.digest.inputs.map((digestInput) => digestInput.transcript),
    [`${TRANSCRIPT_SECRET} for abc`, `${TRANSCRIPT_SECRET} for def`],
  );
  assert.deepEqual(h.digest.inputs[0], {
    providerName: "Claude Code",
    title: "Claude Code: abc",
    status: SESSION_STATUS.WAITING,
    hookEvent: "stop",
    truncated: false,
    transcript: `${TRANSCRIPT_SECRET} for abc`,
  });
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
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.WAKE);
  assert.equal(h.traces[0]?.inputTokens, 100);
  assert.ok(!JSON.stringify(h.traces).includes(TRANSCRIPT_SECRET));
  assert.equal(h.traces[0]?.transcriptBytes, `${TRANSCRIPT_SECRET} for abc`.length * 2);
  assert.deepEqual(
    h.traces[0]?.digests.map((digest) => [digest.source, digest.transcriptChars]),
    [
      [DIGEST_SOURCE.MODEL, `${TRANSCRIPT_SECRET} for abc`.length],
      [DIGEST_SOURCE.MODEL, `${TRANSCRIPT_SECRET} for def`.length],
    ],
  );
  assert.ok(!JSON.stringify(h.traces).includes("the developer's ask"));
});

test("the raw delta reaches the summarizer and never the brain's input", async () => {
  const h = harness();
  h.client.answers.push(
    answered([call("call_1", BRAIN_TOOL.LIST_SESSIONS, {})]),
    answered([message("noted")]),
  );
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.digest.inputs.length, 1);
  assert.ok(h.digest.inputs[0]?.transcript.includes(TRANSCRIPT_SECRET));
  assert.equal(h.client.inputs.length, 2);
  for (const input of h.client.inputs) {
    assert.ok(!JSON.stringify(input).includes(TRANSCRIPT_SECRET));
  }
  assert.ok(!JSON.stringify(h.persisted).includes(TRANSCRIPT_SECRET));
});

test("a summarizer that fails, throws, or is quiet leaves the fallback digest, with no call while quiet", async () => {
  const h = harness();
  h.digest.answers.push({ outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason: "status 500" });
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const failedEvents = eventRecords(openingBody(h.client.inputs[0]?.[0]));
  assert.deepEqual(failedEvents[0]?.transcript_digest, {
    status: "accepted",
    truncated: false,
    source: "fallback",
    stop_state: "waiting-for-developer",
  });
  assert.equal(h.traces[0]?.digests[0]?.source, DIGEST_SOURCE.FALLBACK);

  const summarize = h.digest.summarize.bind(h.digest);
  h.digest.summarize = async (input) => {
    await summarize(input);
    throw new Error("boom");
  };
  h.agent.wake([edge(DEF, NOW + 3_000)]);
  await h.clock.advance(NOW + 6_000);
  const thrownEvents = eventRecords(openingBody(latestOpening(h.client.inputs[1])));
  assert.ok(isRecord(thrownEvents[0]?.transcript_digest));
  assert.equal(thrownEvents[0].transcript_digest.source, "fallback");
  assert.equal(h.digest.inputs.length, 2);

  h.digest.summarize = summarize;
  h.digest.quiet = NOW + 60_000;
  h.agent.wake([
    {
      ...edge(ABC, NOW + 6_000),
      hookEvent: "stop-failure",
      session: session("abc", { status: SESSION_STATUS.ERROR, detail: { error: "exit 1" } }),
    },
  ]);
  await h.clock.advance(NOW + 9_000);
  assert.equal(h.digest.inputs.length, 2);
  const quietEvents = eventRecords(openingBody(latestOpening(h.client.inputs[2])));
  assert.deepEqual(quietEvents[0]?.transcript_digest, {
    status: "accepted",
    truncated: false,
    source: "fallback",
    stop_state: "errored",
    waiting_on: "exit 1",
  });
  assert.ok(!JSON.stringify(h.client.inputs).includes(TRANSCRIPT_SECRET));
});

test("a summarizer that gives up on its own timeout yields the fallback, and the turn waits for it", async () => {
  const h = harness();
  h.digest.hold = true;
  h.digest.answers.push({
    outcome: BRAIN_CLIENT_OUTCOME.FAILED,
    reason: "request did not complete",
  });
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.digest.inputs.length, 1);
  assert.equal(h.client.inputs.length, 0);
  assert.equal(h.clock.timers.size, 0);

  h.digest.release();
  await settle();
  assert.equal(h.client.inputs.length, 1);
  const events = eventRecords(openingBody(h.client.inputs[0]?.[0]));
  assert.ok(isRecord(events[0]?.transcript_digest));
  assert.equal(events[0].transcript_digest.source, "fallback");
  assert.equal(h.persisted.length, 1);
  assert.deepEqual(
    h.traces[0]?.digests.map((digest) => [digest.source, digest.outcome, digest.error]),
    [[DIGEST_SOURCE.FALLBACK, BRAIN_CLIENT_OUTCOME.FAILED, "request did not complete"]],
  );
  assert.ok(!JSON.stringify(h.persisted).includes("the developer's ask"));
});

test("digests run at most three at a time across a turn's sessions", async () => {
  const identities = ["s1", "s2", "s3", "s4", "s5"].map((id) => ({
    providerId: claude.id,
    providerSessionId: id,
  }));
  const h = harness({
    roster: () => ({ text: "roster", identities }),
  });
  h.digest.hold = true;
  h.agent.wake(identities.map((identity) => edge(identity)));
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.digest.inputs.length, 3);
  assert.equal(h.digest.peakInFlight, 3);
  h.digest.release();
  await settle();
  assert.equal(h.digest.inputs.length, 5);
  assert.equal(h.digest.peakInFlight, 3);
  h.digest.release();
  await settle();
  assert.equal(h.client.inputs.length, 1);
  assert.equal(eventRecords(openingBody(h.client.inputs[0]?.[0])).length, 5);
  assert.equal(h.traces[0]?.digests.length, 5);
});

test("an empty or refused read makes no summarizer call and carries the fallback", async () => {
  const h = harness({
    readTranscriptSince: async (identity): Promise<ProviderTranscriptSinceResult> =>
      identity.providerSessionId === "abc"
        ? { status: ACT_RESULT_STATUS.ACCEPTED, text: "", cursor: "c", truncated: false }
        : { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "no transcript for this provider" },
  });
  h.agent.wake([edge(ABC), edge(DEF)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.digest.inputs.length, 0);
  const events = eventRecords(openingBody(h.client.inputs[0]?.[0]));
  assert.equal(events.length, 2);
  assert.deepEqual(events[0]?.transcript_digest, {
    status: "accepted",
    truncated: false,
    source: "fallback",
    stop_state: "waiting-for-developer",
  });
  assert.deepEqual(events[1]?.transcript_digest, {
    status: "unsupported",
    truncated: false,
    source: "fallback",
    stop_state: "waiting-for-developer",
  });
});

test("a brain built without a summarizer attaches fallback digests to every wake", async () => {
  const h = harness({}, { withDigest: false });
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.digest.inputs.length, 0);
  const events = eventRecords(openingBody(h.client.inputs[0]?.[0]));
  assert.ok(isRecord(events[0]?.transcript_digest));
  assert.equal(events[0].transcript_digest.source, "fallback");
  assert.ok(!JSON.stringify(h.client.inputs).includes(TRANSCRIPT_SECRET));
  assert.deepEqual(h.traces[0]?.digests, [
    {
      source: DIGEST_SOURCE.FALLBACK,
      outcome: BRAIN_CLIENT_OUTCOME.FAILED,
      stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER,
      elapsedMs: 0,
      digestChars: JSON.stringify({ stopState: "waiting-for-developer" }).length,
      transcriptChars: `${TRANSCRIPT_SECRET} for abc`.length,
      error: "no summarizer",
    },
  ]);
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
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);

  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(h.deliveries, [
    {
      briefing: "Checkout agent wants a decision.",
      decidedAt: NOW + 3_000,
      source: BRAIN_DELIVERY_SOURCE.WAKE,
    },
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

test("an ask returns the final text, carries pending wakes, and refuses announce", async () => {
  const h = harness();
  h.agent.wake([edge(DEF)]);
  h.client.answers.push(
    answered([
      call("call_a", BRAIN_TOOL.ANNOUNCE, { briefing: "nope" }),
      call("call_b", "send_session_message", {
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
      name: "send_session_message",
      argumentsJson: JSON.stringify({
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
        text: "run the tests",
      }),
    },
  ]);
  const first = h.client.inputs[0] ?? [];
  const ask = itemText(first[0]);
  assert.ok(ask.startsWith(`${BRAIN_INPUT_MARKER.DEVELOPER_ASK} `));
  assert.ok(ask.includes("tell the checkout agent to run the tests"));
  assert.ok(!ask.includes(TRANSCRIPT_SECRET));
  const [riding] = eventRecords(openingBody(first[0]));
  assert.equal(riding?.provider_session_id, "def");
  assert.ok(isRecord(riding?.transcript_digest));
  assert.equal(riding.transcript_digest.source, "model");
  assert.equal(h.digest.inputs.length, 1);
  assert.equal(h.agent.pendingWakes(), 0);
  assert.equal(h.clock.timers.size, 0);
  const outputs = itemsOfType(h.client.inputs[1] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  const refusal = outputs.find((item) => item.call_id === "call_a");
  assert.ok(refusal && isWireString(refusal.output) && refusal.output.includes("reply in text"));
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(h.traces[0]?.outputText, "Sent.");
});

test("an ask past its deadline answers nothing while the turn still finishes and persists", async () => {
  const h = harness({ askDeadlineMs: 1_000 });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: BrainClient = {
    respond: async (input, options) => {
      await gate;
      return h.client.respond(input, options);
    },
    quietUntil: () => undefined,
  };
  const slowHarness = harness({ client: slow, askDeadlineMs: 1_000 });
  const pending = slowHarness.agent.ask("anything?");
  await settle();
  await slowHarness.clock.advance(NOW + 1_000);
  assert.equal(await pending, undefined);
  release?.();
  await settle();
  assert.equal(slowHarness.persisted.length, 1);
});

test("the tool loop stops at its cap with every call answered, so no function_call dangles", async () => {
  const h = harness({ maxToolIterations: 2 });
  h.client.fallback = answered([call("loop", BRAIN_TOOL.LIST_SESSIONS, {})]);
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);

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
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.persisted[0]?.items.length, 2);

  h.client.answers.push(answered([compaction("cmp_1"), reasoning("rs"), message("folded")]));
  h.agent.wake([edge(DEF)]);
  await h.clock.advance(NOW + 6_000);
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
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.persisted.length, 0);
  assert.equal(h.traces[0]?.error, "boom");

  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 6_000);
  assert.equal(h.client.inputs[1]?.length, 2);
  assert.deepEqual(
    h.sinceReads.map((read) => read.cursor),
    [undefined, undefined],
  );
  // The same delta is summarized again, because the brain never saw the first digest.
  assert.equal(h.digest.inputs.length, 2);
  assert.equal(h.persisted.length, 1);
});

test("a call that fails mid-loop rolls back the whole turn, calls and all", async () => {
  const h = harness();
  h.client.answers.push(answered([call("call_1", BRAIN_TOOL.LIST_SESSIONS, {})]), {
    outcome: BRAIN_CLIENT_OUTCOME.FAILED,
    reason: "network",
  });
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.persisted.length, 0);
  h.agent.wake([edge(DEF)]);
  await h.clock.advance(NOW + 6_000);
  assert.equal(itemsOfType(h.client.inputs[2] ?? [], RESPONSES_ITEM_TYPE.FUNCTION_CALL).length, 0);
});

test("a quiet client keeps the wakes pending and retries once the quiet ends", async () => {
  const h = harness();
  h.client.answers.push({ outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: NOW + 60_000 });
  h.agent.wake([edge(ABC), edge(DEF)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.client.inputs.length, 1);
  assert.equal(h.agent.pendingWakes(), 2);
  assert.equal(h.persisted.length, 0);

  h.client.quiet = NOW + 60_000;
  await h.clock.advance(NOW + 30_000);
  assert.equal(h.client.inputs.length, 1);
  h.client.quiet = undefined;
  await h.clock.advance(NOW + 70_000);
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.agent.pendingWakes(), 0);
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
    answered([
      call("call_1", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
      }),
      call("call_2", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: UNKNOWN.providerId,
        provider_session_id: UNKNOWN.providerSessionId,
      }),
    ]),
    answered([message("")]),
  );
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
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
  h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const [input] = h.digest.inputs;
  assert.ok(input);
  assert.ok(input.transcript.startsWith(OMISSION_MARKER));
  assert.ok(input.transcript.endsWith("TAIL"));
  assert.ok(input.transcript.length <= 50);
  assert.equal(input.truncated, true);
  const wake = itemText(h.client.inputs[0]?.[0]);
  assert.ok(wake.includes('"truncated":true'));
  assert.ok(!wake.includes("TAIL"));
  assert.deepEqual(h.persisted[0]?.cursors, {});
});

test("restored memory opens the next turn, and held briefings are re-decided from their own item", async () => {
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
  h.agent.releaseHeld([
    { briefing: "Checkout wants a decision.", decidedAt: NOW - 1, source: "wake" },
  ]);
  await settle();
  const input = h.client.inputs[0] ?? [];
  assert.deepEqual(input.slice(0, 2), prior);
  assert.ok(itemText(input[2]).startsWith(`${BRAIN_INPUT_MARKER.HOLD_RELEASED} `));
  assert.equal(h.deliveries[0]?.source, BRAIN_DELIVERY_SOURCE.HOLD_RELEASED);
  assert.equal(h.deliveries[0]?.briefing, "Still waiting on you.");
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.HOLD_RELEASED);
  assert.equal(h.sinceReads.length, 0);
});

test("stop drops pending wakes and takes nothing more", async () => {
  const h = harness();
  h.agent.wake([edge(ABC)]);
  await h.agent.stop();
  assert.equal(h.agent.pendingWakes(), 0);
  await h.clock.advance(NOW + 10_000);
  assert.equal(h.client.inputs.length, 0);
  assert.equal(await h.agent.ask("hello?"), undefined);
});

test("a roster look carries the roster and a digest only for the transcripts that grew", async () => {
  const GHI: SessionIdentity = { providerId: claude.id, providerSessionId: "ghi" };
  const working = session("abc", { status: SESSION_STATUS.WORKING });
  const idle = session("ghi", { status: SESSION_STATUS.WAITING });
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
  let grown = true;
  const h = harness({
    roster: () => ({
      text: "Currently observed sessions:\n- abc\n- ghi\n- def\n- cloud-1",
      identities: [ABC, GHI, DEF, { providerId: "conductor", providerSessionId: "cloud-1" }],
      sessions: [working, idle, settled, cloud],
    }),
    readTranscriptSince: async (identity): Promise<ProviderTranscriptSinceResult> => {
      read.push(identity.providerSessionId);
      return {
        status: ACT_RESULT_STATUS.ACCEPTED,
        text: grown && identity.providerSessionId === "abc" ? "assistant: still going" : "",
        cursor: `${identity.providerSessionId}-cursor`,
        truncated: false,
      };
    },
  });
  // A hook wake still pending rides along with the look rather than waiting.
  h.agent.wake([edge(DEF)]);
  h.agent.rosterLook();
  await settle();

  assert.equal(h.client.inputs.length, 1);
  const input = h.client.inputs[0] ?? [];
  const opening = itemText(itemsOfType(input, RESPONSES_ITEM_TYPE.MESSAGE)[0]);
  assert.ok(opening.startsWith(`${BRAIN_INPUT_MARKER.OBSERVED_EVENTS} `));
  const body = openingBody(itemsOfType(input, RESPONSES_ITEM_TYPE.MESSAGE)[0]);
  assert.equal(body.scheduled_roster_look, true);
  assert.match(String(body.roster), /cloud-1/);
  // The working and waiting local sessions are read; the settled one had no
  // cursor and nothing live, and the cloud one is not read on a look. Only the
  // session whose delta came back with text is summarized and carried; the
  // waiting one with an empty delta costs no call and is left out rather than
  // reported as news. The pending hook wake is carried with a fallback digest,
  // since its read was empty too.
  const events = eventRecords(body);
  assert.deepEqual(
    events.map((event) => [event.kind, event.provider_session_id]),
    [
      [BRAIN_WAKE_KIND.HOOK, "def"],
      [BRAIN_WAKE_KIND.ROSTER, "abc"],
    ],
  );
  assert.ok(isRecord(events[0]?.transcript_digest));
  assert.equal(events[0].transcript_digest.source, "fallback");
  assert.ok(isRecord(events[1]?.transcript_digest));
  assert.equal(events[1].transcript_digest.source, "model");
  assert.deepEqual(read.sort(), ["abc", "def", "ghi"]);
  assert.equal(h.digest.inputs.length, 1);
  assert.equal(h.digest.inputs[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(h.digest.inputs[0]?.transcript, "assistant: still going");
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  assert.equal(h.traces[0]?.digests.length, 2);

  // The look can be triggered again by the host, and a look on which nothing
  // grew carries no events and asks for no digest.
  read.length = 0;
  grown = false;
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.digest.inputs.length, 1);
  assert.deepEqual(eventRecords(openingBody(latestOpening(h.client.inputs[1]))), []);
  assert.deepEqual(h.traces[1]?.digests, []);
  await h.agent.stop();
});

test("a roster look is skipped while the client is quiet or a turn is in flight", async () => {
  const h = harness({
    roster: () => ({
      text: "roster",
      identities: [ABC],
      sessions: [session("abc", { status: SESSION_STATUS.WORKING })],
    }),
  });

  // Quiet: the look is skipped.
  h.client.quiet = NOW + 30_000;
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 0);

  // Quiet over, but a turn is under way: the look yields.
  h.client.quiet = undefined;
  let release: (() => void) | undefined;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const respond = h.client.respond.bind(h.client);
  h.client.respond = async (input, options) => {
    await slow;
    return respond(input, options);
  };
  const ask = h.agent.ask("what's up?");
  await settle();
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 0);
  release?.();
  await ask;
  await settle();
  assert.equal(h.client.inputs.length, 1);

  // After the turn completes, the look proceeds.
  h.agent.rosterLook();
  await settle();
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.traces.at(-1)?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  await h.agent.stop();
});
