import assert from "node:assert/strict";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  HTTP_METHOD,
  isWireString,
  unparsedWire,
  wireRecord,
} from "@sidecar/wire";
import { test } from "vitest";
import { LOOK_SUBJECT } from "./agent.js";
import { hostedBrainTransport, keyedBrainTransport } from "./client.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_STATE_VERSION,
  brainPersistedStateFromWire,
  brainRequestPrunable,
  freshBrainState,
  MAXIMUM_TERMINAL_REQUESTS,
} from "./envelope.js";
import {
  ABC,
  answered,
  ask,
  assertNoActionReached,
  call,
  DELTA_PER_SESSION_CHARS,
  edge,
  FakeClient,
  FULL_TRANSCRIPT_CHARS,
  failedAnswer,
  functionOutputs,
  harness,
  heldPerformer,
  INSTRUCTION_IN_DATA,
  itemsOfType,
  message,
  messageAction,
  NO_ACTS_POLICY,
  NOW,
  OBSERVATION_ACTIONS,
  seededRequests,
  session,
  settle,
  submit,
  TRANSCRIPT_SECRET,
  UNKNOWN,
} from "./harness.js";
import { INBOX_CAPACITY } from "./observation-inbox.js";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
} from "./requests.js";
import { BrainStateStore } from "./state-store.js";
import { fakeBrainStateRepository } from "./testing.js";
import { BRAIN_TOOL } from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

/**
 * One test per sentence of `AGENTS.md` the brain is the enforcer of, each
 * quoting the sentence above it and naming where it now lives. They overlap
 * the behaviour suites on purpose: the point of this file is that a rule the
 * repository states in prose has one place that fails when it stops holding,
 * whatever else moved.
 */

/**
 * "The host (`BrainAgent`) owns the conversation's standing — … the journal
 * that records an action before its effect and its result before the next
 * inference …" — `tool-executor.ts` and `turn-runner.ts`'s advance of the mark.
 */
test("the journal records an action before its effect and its result before the next inference", async () => {
  const held = heldPerformer();
  const inner = new FakeClient();
  /** What the journal said on disk each time the model was asked, so the order is the assertion. */
  const journalsAtRequest: (readonly { callId: string; answered: boolean }[])[] = [];
  const h = harness({
    actions: held.actions,
    client: {
      respond: (input, options) => {
        journalsAtRequest.push(
          (h.persisted.at(-1)?.journal ?? []).map((row) => ({
            callId: row.callId,
            answered: row.outputJson !== undefined,
          })),
        );
        return inner.respond(input, options);
      },
      quietUntil: () => undefined,
    },
  });
  inner.answers.push(answered([messageAction("act_1")]), answered([message("done")]));
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(held.performed.length, 1, "the action is out at the performer");

  // The action is dispatched and its result is not back: its journal row already
  // stands on disk, so a crash here reads as an action that may have happened
  // rather than one that never did.
  assert.deepEqual(
    h.persisted.at(-1)?.journal.map((row) => row.callId),
    ["act_1"],
  );
  assert.equal(h.persisted.at(-1)?.journal[0]?.outputJson, undefined, "before its effect");
  assert.equal(inner.inputs.length, 1, "the model has not been asked again");

  held.releases[0]?.();
  await settle();
  assert.deepEqual(
    journalsAtRequest,
    [[], [{ callId: "act_1", answered: true }]],
    "the second inference was asked over a journal that already held the result",
  );
  const second = functionOutputs(inner.inputs[1] ?? []);
  assert.ok(
    second.some((output) => output.callId === "act_1"),
    "and reads it",
  );
});

/**
 * "the same policy fixes the schemas the model is offered and the gate every
 * emitted call meets at dispatch, so nothing the model reads can widen
 * either" — `turn-runner.ts`'s one resolution and `tools.ts`.
 */
test("the effective tool policy fixes the schemas and the gate, and nothing the model reads can widen either", async () => {
  const h = harness({
    prepareTurn: NO_ACTS_POLICY,
    readTranscriptSince: async () => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      text: INSTRUCTION_IN_DATA,
      truncated: false,
    }),
  });
  h.client.answers.push(answered(OBSERVATION_ACTIONS), answered([message("")]));
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assertNoActionReached(h);
});

/**
 * "an action taken in a turn the developer did not open is journaled and
 * narrated as Luke's own rather than as anything the developer asked for" —
 * `turn.ts`'s `runOriginOf`, read at every turn's opening.
 */
test("an action in a turn the developer did not open is Luke's own", async () => {
  const h = harness({
    roster: () => ({ text: "one", identities: [ABC], sessions: [session(ABC.providerSessionId)] }),
  });
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  await h.agent.rosterLook();
  await settle();
  h.agent.releaseHeld([{ briefing: "held", decidedAt: NOW }]);
  await settle();
  const observation = h.traces.filter((trace) => trace.trigger !== BRAIN_TURN_TRIGGER.ASK);
  assert.ok(observation.length >= 3);
  assert.ok(observation.every((trace) => trace.origin === RUN_ORIGIN.OBSERVATION));

  h.client.answers.push(answered([message("hi")]));
  await ask(h, "hello");
  const asked = h.traces.filter((trace) => trace.trigger === BRAIN_TURN_TRIGGER.ASK);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.origin, RUN_ORIGIN.USER);
});

/**
 * "reads only what its one session's transcript gained since the capture
 * cursor it last kept, cut from the front to 20,000 characters, and writes it
 * down before any turn is scheduled: the observation entry and the advanced
 * capture cursor land in one save" — `wakes.ts` and `state-store.ts`'s
 * `saveCapture`.
 */
test("a wake's delta is cut from the front to 20,000 characters and written down before any turn is scheduled", async () => {
  assert.equal(DELTA_PER_SESSION_CHARS, 20_000);
  const h = harness({
    readTranscriptSince: async () => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      text: `${"y".repeat(DELTA_PER_SESSION_CHARS * 2)}TAIL`,
      cursor: "far",
      truncated: false,
    }),
  });
  await h.agent.wake([edge(ABC)]);
  assert.equal(h.client.inputs.length, 0, "nothing was sent before the capture landed");
  const captured = h.persisted.at(-1);
  assert.equal(h.persisted.length, 1, "the capture is its own save");
  const [entry] = captured?.inbox ?? [];
  assert.ok(entry?.delta);
  assert.equal(entry.delta.truncated, true);
  assert.ok(entry.delta.text.length <= DELTA_PER_SESSION_CHARS);
  assert.deepEqual(
    captured?.captureCursors,
    { [ABC.providerId]: { [ABC.providerSessionId]: "far" } },
    "the cursor moved in the same save",
  );
  assert.deepEqual(captured?.cursors, {}, "and the consumed cursor did not");
});

/**
 * "the turn that follows consumes the entries it opened with at its
 * checkpoint, moving the consumed cursor there and only there" —
 * `turn-runner.ts` over `state-store.ts`'s `saveWorking`.
 */
test("the turn consumes its entries at its checkpoint, moving the consumed cursor there and only there", async () => {
  const h = harness();
  h.client.answers.push(failedAnswer("upstream down"));
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const after = h.persisted.at(-1);
  assert.equal(after?.inbox.length, 1, "a failed turn consumed nothing");
  assert.deepEqual(after?.cursors, {}, "and moved no consumed cursor");
  assert.deepEqual(after?.captureCursors, {
    [ABC.providerId]: { [ABC.providerSessionId]: "abc-cursor" },
  });

  h.client.answers.push(answered([message("read")]));
  await h.agent.wake([edge(ABC, NOW + 10_000)]);
  await h.clock.advance(NOW + 20_000);
  const settled = h.persisted.at(-1);
  assert.deepEqual(settled?.inbox, [], "the turn that ran consumed them");
  assert.deepEqual(settled?.cursors, {
    [ABC.providerId]: { [ABC.providerSessionId]: "abc-cursor" },
  });
});

/**
 * "A repeated look that finds nothing gained and the session unchanged
 * captures nothing and opens no inference, a hook delivered twice is one
 * entry, and the inbox holds at most 20 entries." — `wakes.ts`'s look
 * fingerprint and `observation-inbox.ts`.
 */
test("a repeated unchanged look captures nothing, a hook delivered twice is one entry, and the inbox holds at most 20", async () => {
  assert.equal(INBOX_CAPACITY, 20);
  const h = harness({
    observes: { kind: LOOK_SUBJECT.SESSION, identity: ABC },
    roster: () => ({ text: "one", identities: [ABC], sessions: [session(ABC.providerSessionId)] }),
  });
  await h.agent.rosterLook();
  await settle();
  const captures = h.persisted.length;
  await h.agent.rosterLook();
  await settle();
  assert.equal(h.persisted.length, captures, "a look over an unchanged session captures nothing");

  const twice = edge(ABC, NOW + 100);
  await h.agent.wake([twice, { ...twice }]);
  const entries = h.persisted.at(-1)?.inbox ?? [];
  assert.equal(
    entries.filter((entry) => entry.atMs === NOW + 100).length,
    1,
    "one hook, delivered twice",
  );
  await h.agent.stop();
});

/**
 * "The conversation may also read one observed session's whole tail, cut from
 * the front to 60,000 characters, through the same read tool a developer's
 * ask is offered" — `turn-runner.ts`'s whole read over `transcript-reads.ts`.
 */
test("a whole-transcript read is cut from the front to 60,000 characters", async () => {
  assert.equal(FULL_TRANSCRIPT_CHARS, 60_000);
  const h = harness({
    readTranscript: async () => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      transcript: `${"x".repeat(FULL_TRANSCRIPT_CHARS * 2)}END`,
    }),
  });
  h.client.answers.push(
    answered([
      call("call_read", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
      }),
    ]),
    answered([message("")]),
  );
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  const [read] = itemsOfType(
    h.client.inputs[1] ?? [],
    RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  assert.ok(read && isWireString(read.output));
  const record = wireRecord(unparsedWire(JSON.parse(read.output)));
  assert.ok(record && isWireString(record.transcript));
  assert.equal(record.truncated, true);
  assert.ok(record.transcript.length <= FULL_TRANSCRIPT_CHARS);
  // From the front: the newest characters are the ones kept.
  assert.equal(record.transcript.slice(-3), "END");
});

/**
 * "is refused in the agent for any identity the roster does not hold" —
 * `tool-executor.ts`, over the roster the turn runner hands it.
 */
test("read_transcript is refused for any identity the roster does not hold", async () => {
  const h = harness();
  h.client.answers.push(
    answered([
      call("call_unknown", BRAIN_TOOL.READ_TRANSCRIPT, {
        provider_id: UNKNOWN.providerId,
        provider_session_id: UNKNOWN.providerSessionId,
      }),
    ]),
    answered([message("")]),
  );
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.deepEqual(h.wholeReads, [], "no provider file was opened for it");
});

/**
 * "no write, checkpoint, or compaction moves it, a file claiming any other
 * span reads as nothing, and a checkpoint loaded past it keeps its identity
 * and its context whole" — `envelope.ts`'s reading and `state-store.ts`'s
 * composition.
 */
test("no write, checkpoint, or compaction moves the fourteen-day stamp, and a file claiming any other span reads as nothing", async () => {
  const fresh = freshBrainState("gen-stamp", NOW);
  assert.equal(fresh.expiresAt - fresh.createdAt, BRAIN_GENERATION_LIFETIME_MS);
  const wrong = {
    ...JSON.parse(JSON.stringify(fresh)),
    expiresAt: NOW + BRAIN_GENERATION_LIFETIME_MS + 1,
  };
  assert.equal(brainPersistedStateFromWire(unparsedWire(wrong)), undefined);

  const h = harness();
  h.client.answers.push(answered([message("hi")]));
  await ask(h, "hello");
  assert.equal(h.persisted.at(-1)?.expiresAt, fresh.expiresAt, "the write moved nothing");
  assert.equal(h.persisted.at(-1)?.version, BRAIN_STATE_VERSION);
});

/**
 * "Only a store whose automatic reset was explicitly enabled enforces that
 * deadline … the store this build wires enables none" — `state-store.ts`.
 */
test("the store this build wires enables no automatic reset", async () => {
  const store = new BrainStateStore({
    repository: fakeBrainStateRepository(),
    createGenerationId: () => "gen-default",
    now: () => NOW,
  });
  assert.equal(store.automaticReset, false);
  const loaded = await store.load();
  assert.equal(
    store.expireIfDue(loaded.expiresAt + 1),
    false,
    "past its deadline, and the generation still stands",
  );
  assert.equal(store.generationId(), loaded.generationId);
});

/**
 * "the store forgets the dead generation and announces the successor before
 * any disk is waited on, so a turn holding a model answer, a transcript read,
 * or an action's preparation is revoked at once" — `state-store.ts`'s `#begin`.
 */
test("the fence is synchronous: the successor is announced before any disk is waited on", async () => {
  const repository = fakeBrainStateRepository();
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${Math.random().toString(36).slice(2)}`,
    now: () => NOW,
  });
  const first = await store.load();
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));
  const held = repository.hold();
  const clearing = store.clear(NOW);
  assert.equal(heard.length, 1, "the listener heard the successor before the disk answered");
  assert.notEqual(heard[0], first.generationId);
  assert.equal(store.holdsGeneration(first.generationId), false, "the dead one stands nowhere");
  held(true);
  assert.equal(await clearing, true);
});

/**
 * "Within its life a generation holds at most 200 records: ended runs whose
 * ends Conversation has taken go first, each with its journal, a new ask is
 * refused at the door when nothing can go" — `envelope.ts`'s retention and
 * `asks.ts`'s door check.
 */
test("a generation holds at most 200 records; a new ask is refused at the door when nothing can go", async () => {
  const h = harness(
    {},
    fakeBrainStateRepository({
      ...freshBrainState("gen-full", NOW),
      requests: seededRequests(MAXIMUM_TERMINAL_REQUESTS, false),
    }),
  );
  const refused = await submit(h, "one more");
  assert.equal(refused.outcome, BRAIN_SUBMISSION_OUTCOME.REJECTED);
  assert.equal(
    refused.outcome === BRAIN_SUBMISSION_OUTCOME.REJECTED ? refused.reason : undefined,
    BRAIN_SUBMISSION_REJECTION.FULL,
  );
  await h.agent.stop();
});

/**
 * "ended runs whose ends Conversation has taken go first, each with its journal" —
 * `envelope.ts`'s `brainRequestPrunable`.
 */
test("only an ended run whose end Conversation has taken may be let go", () => {
  const [taken] = seededRequests(1, true);
  const [untaken] = seededRequests(1, false);
  assert.ok(taken && untaken);
  assert.equal(brainRequestPrunable(taken), true);
  assert.equal(brainRequestPrunable(untaken), false, "its end is not in the thread yet");
  assert.equal(
    brainRequestPrunable({ ...taken, status: BRAIN_REQUEST_STATUS.RUNNING }),
    false,
    "a run still going is never eligible",
  );
});

/**
 * "A generation's end revokes its runs and, through the host's own listener,
 * withdraws every briefing it had queued or offered but not yet spoken" —
 * `turn-runner.ts`'s delivery loop.
 */
test("a briefing leaves only from a turn that still stands", async () => {
  const h = harness();
  h.client.answers.push(
    answered([call("call_brief", BRAIN_TOOL.ANNOUNCE, { briefing: "abc needs you" })]),
    answered([message("")]),
  );
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(NOW + 3_000);
  assert.deepEqual(
    h.deliveries.map((delivery) => delivery.briefing),
    ["abc needs you"],
  );

  const other = harness();
  other.client.answers.push(
    answered([call("call_brief", BRAIN_TOOL.ANNOUNCE, { briefing: "never spoken" })]),
    answered([message("")]),
  );
  await other.agent.wake([edge(ABC)]);
  const turning = other.clock.advance(NOW + 3_000);
  await other.agent.stop();
  await turning;
  await settle();
  assert.deepEqual(
    other.deliveries,
    [],
    "a stop during the turn withdraws what it had not handed over",
  );
});

/**
 * "the speak-only calls that voice a briefing or a reply, which carry no
 * tools at the API and again at a runtime gate" — the brain's half:
 * `announce` is not a tool an ask is offered, and a call to it is refused.
 */
test("an ask's reply is its final text, and announce is refused inside one", async () => {
  const h = harness();
  h.client.answers.push(
    answered([call("call_brief", BRAIN_TOOL.ANNOUNCE, { briefing: "spoken instead" })]),
    answered([message("the reply")]),
  );
  const record = await ask(h, "what is up?");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(record.text, "the reply");
  assert.deepEqual(h.deliveries, [], "nothing was announced");
  assert.ok(
    h.traces.every((trace) => !trace.tools.includes(BRAIN_TOOL.ANNOUNCE)),
    "and it was never offered",
  );
});

/**
 * "The brain's own turns are the first … on the developer's own key or
 * through Luke's own service." — `client.ts`: a call is addressed to the one
 * origin its transport was built with, and what a quiet reports names the
 * transport and the wait alone.
 */
test("a brain call is addressed to the developer's own key or to Luke's own service, and reports neither", async () => {
  const addressed: string[] = [];
  const fetch = (url: string) => {
    addressed.push(url);
    return Promise.resolve(Response.json({}));
  };
  const keyed = keyedBrainTransport({
    baseUrl: "https://api.openai.test/v1",
    apiKey: "sk-secret",
    fetch,
    now: () => NOW,
  });
  const service = hostedBrainTransport({
    baseUrl: "https://luke.test",
    readAccessToken: () => Promise.resolve("account-secret"),
    refreshAccount: () => Promise.resolve(),
    fetch,
    now: () => NOW,
  });
  await keyed.send("/responses", HTTP_METHOD.POST, TRANSCRIPT_SECRET);
  await service.send("/api/brain/v2/respond", HTTP_METHOD.POST, TRANSCRIPT_SECRET);
  assert.deepEqual(addressed, [
    "https://api.openai.test/v1/responses",
    "https://luke.test/api/brain/v2/respond",
  ]);
});
