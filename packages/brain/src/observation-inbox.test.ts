import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import {
  normalizeSession,
  type ProviderSessionObservation,
  type ProviderTranscriptSinceResult,
  SESSION_COMPLETION_CAUSE,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionIdentity,
  type SessionStatus,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, unparsedWire, wireRecord } from "@sidecar/wire";
import { Effect, TestClock } from "effect";
import { type BrainAgentOptions, LOOK_SUBJECT } from "./agent.js";
import { advanceHarness, effectHarness } from "./effect/harness.js";
import {
  ABC,
  acceptedRunId,
  answered,
  ask,
  claude,
  DEF,
  edge,
  FakeClient,
  gatedClient,
  itemsOfType,
  itemText,
  message,
  NOW,
  session,
  settle,
  submit,
  TRANSCRIPT_SECRET,
} from "./harness.js";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
} from "./requests.js";
import { fakeBrainStateRepository } from "./testing.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";
import { BRAIN_WAKE_KIND } from "./wake-events.js";

/**
 * The observation window: what a wake captures before any turn is scheduled,
 * what a repeated look suppresses, what the inbox keeps across a relaunch,
 * and what a roster look reads for the conversation whose subject it is.
 */

it.effect(
  "wakes inside the window open one turn, with each session's delta read once and the context last",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      yield* Effect.promise(() => h.agent.wake([edge(ABC, NOW + 500), edge(DEF, NOW + 1_000)]));
      assert.equal(h.client.inputs.length, 0);
      yield* advanceHarness(NOW + 3_000);

      assert.equal(h.client.inputs.length, 1);
      const input = h.client.inputs[0] ?? [];
      assert.equal(input.length, 2);
      const wake = itemText(input[0]);
      assert.equal(wake.split(`${TRANSCRIPT_SECRET} for abc`).length - 1, 1);
      assert.equal(wake.split(`${TRANSCRIPT_SECRET} for def`).length - 1, 1);
      // Each batch captures from the capture cursor: the second edge for abc reads
      // from where the first left off and finds nothing new, so the turn carries
      // abc's delta once.
      assert.deepEqual(h.sinceReads, [
        { identity: ABC, cursor: undefined },
        { identity: ABC, cursor: "abc-cursor" },
        { identity: DEF, cursor: undefined },
      ]);

      // Two captures, then the turn's checkpoint.
      assert.equal(h.persisted.length, 3);
      assert.deepEqual(h.persisted.at(-1)?.cursors, {
        "claude-code": { abc: "abc-cursor", def: "def-cursor" },
      });
      const remembered = h.persisted.at(-1)?.items ?? [];
      assert.equal(remembered.length, 2);
      assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.WAKE);
      assert.equal(h.traces[0]?.inputTokens, 100);
      assert.equal(h.traces[0]?.transcriptBytes, `${TRANSCRIPT_SECRET} for abc`.length * 2);
    }),
);

it.effect("the same session id under two providers is two identities, each read once", () =>
  Effect.gen(function* () {
    const codexAbc: SessionIdentity = { providerId: "codex", providerSessionId: "abc" };
    const h = yield* effectHarness({
      roster: () => ({ text: "roster", identities: [ABC, codexAbc] }),
    });
    yield* Effect.promise(() => h.agent.wake([edge(ABC), edge(codexAbc), edge(ABC, NOW + 500)]));
    yield* advanceHarness(NOW + 3_000);

    assert.equal(h.client.inputs.length, 1);
    assert.deepEqual(h.sinceReads, [
      { identity: ABC, cursor: undefined },
      { identity: codexAbc, cursor: undefined },
    ]);
    assert.deepEqual(h.persisted.at(-1)?.cursors, {
      "claude-code": { abc: "abc-cursor" },
      codex: { abc: "abc-cursor" },
    });
    const wake = itemText((h.client.inputs[0] ?? [])[0]);
    const body = wireRecord(unparsedWire(JSON.parse(wake.slice(wake.indexOf("\n") + 1))));
    assert.ok(body && Array.isArray(body.events));
    assert.deepEqual(
      body.events.map((event) => wireRecord(unparsedWire(event))?.provider_id),
      [claude.id, "codex", claude.id],
    );
    assert.equal(h.traces[0]?.transcriptBytes, `${TRANSCRIPT_SECRET} for abc`.length * 2);
  }),
);

it.effect("stop opens nothing more, and a captured observation stays for the next agent", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
    yield* Effect.promise(() => h.agent.stop());
    assert.equal(h.agent.pendingWakes(), 1);
    assert.equal(h.repository.state?.inbox.length, 1);
    yield* advanceHarness(NOW + 10_000);
    assert.equal(h.client.inputs.length, 0);
    assert.deepEqual(yield* Effect.promise(() => submit(h, "hello?")), {
      outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
      reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
    });
  }),
);

const CONDUCTOR = { id: "conductor", displayName: "Conductor" };
const CLOUD: SessionIdentity = { providerId: CONDUCTOR.id, providerSessionId: "cloud-1" };

function cloudSession(overrides: Partial<ProviderSessionObservation> = {}) {
  return normalizeSession(CONDUCTOR, {
    providerSessionId: CLOUD.providerSessionId,
    title: "Conductor: cloud",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    location: SESSION_LOCATION.CLOUD,
    ...overrides,
  });
}

const NO_TRANSCRIPT: ProviderTranscriptSinceResult = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider keeps no transcript this build can read.",
};

it.effect(
  "a look at a cloud session reads its roster fields alone, carrying an unsupported, empty delta",
  () =>
    Effect.gen(function* () {
      const read: string[] = [];
      const h = yield* effectHarness({
        observes: { kind: LOOK_SUBJECT.SESSION, identity: CLOUD },
        roster: () => ({
          text: "Currently observed sessions:\n- abc\n- cloud-1",
          identities: [ABC, CLOUD],
          sessions: [session("abc", { status: SESSION_STATUS.WORKING }), cloudSession()],
        }),
        readTranscriptSince: async (identity): Promise<ProviderTranscriptSinceResult> => {
          read.push(identity.providerSessionId);
          if (identity.providerId === CONDUCTOR.id) return NO_TRANSCRIPT;
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            text: "assistant: still going",
            cursor: `${identity.providerSessionId}-cursor`,
            truncated: false,
          };
        },
      });
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());

      // The cloud session is the only one read, through the same seam a local
      // one is, and the provider's refusal is a defined delta rather than a
      // reason to capture nothing.
      assert.deepEqual(read, ["cloud-1"]);
      assert.equal(h.client.inputs.length, 1);
      const entry = h.persisted[0]?.inbox[0];
      assert.equal(entry?.providerSessionId, "cloud-1");
      assert.deepEqual(entry?.delta, {
        text: "",
        truncated: false,
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
      });
      assert.equal(entry?.cursor, undefined);
      const opening = itemText((h.client.inputs[0] ?? [])[0]);
      const body = wireRecord(unparsedWire(JSON.parse(opening.slice(opening.indexOf("\n") + 1))));
      assert.ok(body && Array.isArray(body.events));
      assert.equal(body.events.length, 1);
      const only = wireRecord(unparsedWire(body.events[0]));
      assert.equal(only?.kind, BRAIN_WAKE_KIND.ROSTER);
      assert.equal(only?.provider_id, CONDUCTOR.id);
      assert.equal(only?.provider_session_id, "cloud-1");
      assert.equal(wireRecord(unparsedWire(only?.transcript_delta))?.status, "unsupported");
      assert.equal(wireRecord(unparsedWire(only?.session))?.status, SESSION_STATUS.WORKING);
      assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect("a cloud session seen working and then reported failed opens a look for the edge", () =>
  Effect.gen(function* () {
    let current = cloudSession();
    const h = yield* effectHarness({
      observes: { kind: LOOK_SUBJECT.SESSION, identity: CLOUD },
      roster: () => ({ text: "roster", identities: [CLOUD], sessions: [current] }),
      readTranscriptSince: async () => NO_TRANSCRIPT,
    });
    h.client.answers.push(answered([message("")]), answered([message("")]));
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 1);

    current = cloudSession({
      status: SESSION_STATUS.ERROR,
      detail: { error: "The agent stopped on an error." },
    });
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 2);
    const entry = h.persisted
      .flatMap((state) => state.inbox)
      .find((captured) => captured.session?.status === SESSION_STATUS.ERROR);
    assert.ok(entry);
    assert.equal(entry.session?.error, "The agent stopped on an error.");
    yield* Effect.promise(() => h.agent.stop());
  }),
);

it.effect("two identical cloud looks capture once", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness({
      observes: { kind: LOOK_SUBJECT.SESSION, identity: CLOUD },
      roster: () => ({ text: "roster", identities: [CLOUD], sessions: [cloudSession()] }),
      readTranscriptSince: async () => NO_TRANSCRIPT,
    });
    h.client.answers.push(answered([message("")]));
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 1);
    const captures = h.persisted.length;
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.persisted.length, captures);
    assert.equal(h.client.inputs.length, 1);
    assert.equal(h.agent.pendingWakes(), 0);
    yield* Effect.promise(() => h.agent.stop());
  }),
);

it.effect("a roster look is skipped while the client is quiet or a turn is in flight", () =>
  Effect.gen(function* () {
    let status: SessionStatus = SESSION_STATUS.WORKING;
    const h = yield* effectHarness({
      roster: () => ({
        text: "roster",
        identities: [ABC],
        sessions: [session("abc", { status })],
      }),
    });

    // Quiet: the look is skipped.
    h.client.quiet = NOW + 30_000;
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
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
    const asked = ask(h, "what's up?");
    yield* Effect.promise(() => settle());
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 0);
    release?.();
    yield* Effect.promise(() => asked);
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 1);

    // After the turn completes, a look that finds the session moved proceeds.
    status = SESSION_STATUS.WAITING;
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assert.equal(h.client.inputs.length, 2);
    assert.equal(h.traces.at(-1)?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
    yield* Effect.promise(() => h.agent.stop());
  }),
);

it.effect("a conversation that observes no session opens no look, however the roster stands", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness({
      observes: { kind: LOOK_SUBJECT.NONE },
      roster: () => ({
        text: "roster",
        identities: [ABC, DEF],
        sessions: [
          session("abc", { status: SESSION_STATUS.WORKING }),
          session("def", { status: SESSION_STATUS.WORKING }),
        ],
      }),
    });
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    // No transcript is read and no inference opens: this conversation's turns
    // are the developer's asks and its own scheduled review.
    assert.equal(h.client.inputs.length, 0);
    assert.deepEqual(h.sinceReads, []);
    assert.equal(h.agent.pendingWakes(), 0);
  }),
);

it.effect(
  "an edge delivered twice is one wake, and every distinct capture is kept until a turn consumes it",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      yield* Effect.promise(() => h.agent.wake([edge(ABC), edge(ABC)]));
      assert.equal(h.agent.pendingWakes(), 1);
      yield* Effect.promise(() =>
        h.agent.wake(Array.from({ length: 40 }, (_, index) => edge(DEF, NOW + index))),
      );
      assert.equal(h.agent.pendingWakes(), 41);
    }),
);

it.effect(
  "captures past a turn's depth are kept whole across a relaunch and read in order, none dropped",
  () =>
    Effect.gen(function* () {
      // Each edge reads a distinct piece of transcript; the model is quiet, so
      // nothing consumes what is captured.
      let piece = 0;
      const reading = (): Partial<BrainAgentOptions> => ({
        readTranscriptSince: async (identity) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: `PIECE_${++piece}`,
          cursor: `${identity.providerSessionId}-${piece}`,
          truncated: false,
        }),
      });
      const quiet = yield* effectHarness({
        ...reading(),
        client: {
          respond: () => Promise.reject(new Error("never asked")),
          quietUntil: () => NOW + 60_000,
        },
      });
      for (let index = 0; index < 25; index += 1) {
        yield* Effect.promise(() => quiet.agent.wake([edge(ABC, NOW + index)]));
      }
      assert.equal(quiet.agent.pendingWakes(), 25);
      const stored = quiet.repository.state;
      assert.equal(stored?.inbox.length, 25);
      const captured = (stored?.inbox ?? []).map((entry) => entry.delta?.text);
      assert.deepEqual(
        captured,
        Array.from({ length: 25 }, (_, index) => `PIECE_${index + 1}`),
      );
      assert.equal(stored?.captureCursors["claude-code"]?.abc, "abc-25");
      yield* Effect.promise(() => quiet.agent.stop());

      // A relaunch reads what was captured without touching the transcript: the
      // first turn opens with the oldest twenty, the next look with the rest.
      const relaunched = yield* effectHarness(reading(), quiet.repository);
      relaunched.client.answers.push(answered([message("")]), answered([message("")]));
      yield* Effect.promise(() => relaunched.agent.ready());
      yield* advanceHarness((yield* TestClock.currentTimeMillis) + 3_000);
      yield* Effect.promise(() => settle());
      assert.equal(relaunched.sinceReads.length, 0);
      assert.equal(relaunched.client.inputs.length, 1);
      assert.equal(relaunched.agent.pendingWakes(), 5);
      assert.equal(relaunched.repository.state?.inbox.length, 5);
      // The next look finds nothing new in the transcript and still opens the
      // turn the standing captures are owed.
      relaunched.agent.rosterLook();
      yield* advanceHarness((yield* TestClock.currentTimeMillis) + 3_000);
      yield* Effect.promise(() => settle());
      assert.equal(relaunched.client.inputs.length, 2);
      assert.equal(relaunched.agent.pendingWakes(), 0);
      assert.equal(relaunched.repository.state?.inbox.length, 0);
    }),
);

it.effect(
  "a conversation that looks at one session reads only it, and a repeated unchanged look opens no inference",
  () =>
    Effect.gen(function* () {
      const notices: import("./wake-events.js").BrainTurnReport[] = [];
      let text = `${TRANSCRIPT_SECRET} for abc`;
      const h = yield* effectHarness({
        observes: { kind: LOOK_SUBJECT.SESSION, identity: ABC },
        notice: (notice) => notices.push(notice),
        roster: () => ({
          text: "roster",
          identities: [ABC, DEF],
          sessions: [
            session("abc", { status: SESSION_STATUS.WORKING }),
            session("def", { status: SESSION_STATUS.WORKING }),
          ],
        }),
        readTranscriptSince: async (identity) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: identity.providerSessionId === "abc" ? text : "never read",
          cursor: `${identity.providerSessionId}-${text.length}`,
          truncated: false,
        }),
      });
      h.client.answers.push(answered([message("")]));
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 1);
      assert.deepEqual(notices[0]?.identities, [ABC]);
      assert.equal(h.repository.state?.cursors.codex, undefined);
      assert.deepEqual(Object.keys(h.repository.state?.cursors["claude-code"] ?? {}), ["abc"]);
      // Nothing gained and the session unchanged: the look is suppressed, deterministically.
      text = "";
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 1);
      assert.equal(notices.length, 1);
      // The transcript growing opens a look again.
      text = "more words";
      h.client.answers.push(answered([message("")]));
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 2);
    }),
);

it.effect(
  "a session the developer is speaking with wakes nothing, and the exchange over is read past rather than replayed",
  () =>
    Effect.gen(function* () {
      let live = true;
      let transcript = `${TRANSCRIPT_SECRET} said aloud`;
      const h = yield* effectHarness({
        observes: { kind: LOOK_SUBJECT.SESSION, identity: ABC },
        roster: () => ({
          text: "roster",
          identities: [ABC],
          sessions: [
            session("abc", {
              status: SESSION_STATUS.WORKING,
              ...(live ? { realtimeVoiceLive: true } : undefined),
            }),
          ],
        }),
        // The cursor is a position in the transcript, so each read starts where the
        // last one stopped, the way a provider's own reader does.
        readTranscriptSince: async (_identity, cursor) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: transcript.slice(Number(cursor ?? 0)),
          cursor: String(transcript.length),
          truncated: false,
        }),
      });
      // Neither the look nor a wake opens an inference over an
      // exchange being heard first-hand, and nothing is written down to open one
      // later — but the capture cursor moves past what was said.
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      yield* Effect.promise(() =>
        h.agent.wake([
          {
            ...edge(ABC),
            session: session("abc", { status: SESSION_STATUS.WORKING, realtimeVoiceLive: true }),
          },
        ]),
      );
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 0);
      assert.equal(h.repository.state?.inbox.length ?? 0, 0);
      assert.equal(
        h.repository.state?.captureCursors["claude-code"]?.abc,
        String(transcript.length),
      );

      // The exchange ending is not news: with nothing gained since, the look
      // opens nothing and replays none of what the developer heard themselves.
      live = false;
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 0);

      // A fresh turn after it is read from where the exchange left off.
      transcript += "\nassistant: back to typing";
      h.client.answers.push(answered([message("")]));
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 1);
      assert.equal(
        h.repository.state?.captureCursors["claude-code"]?.abc,
        String(transcript.length),
      );
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a wake's session summary carries the hold and the completion cause beside the status",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      yield* Effect.promise(() =>
        h.agent.wake([
          {
            ...edge(ABC),
            session: session("abc", { holdingForDeveloper: true }),
          },
          {
            ...edge(DEF),
            session: session("def", {
              status: SESSION_STATUS.COMPLETE,
              completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
            }),
          },
        ]),
      );
      yield* advanceHarness(NOW + 3_000);
      yield* Effect.promise(() => settle());
      const opening = itemText(
        itemsOfType(h.client.inputs[0] ?? [], RESPONSES_INPUT_ITEM_TYPE.MESSAGE)[0],
      );
      const body = wireRecord(unparsedWire(JSON.parse(opening.slice(opening.indexOf("\n") + 1))));
      assert.ok(Array.isArray(body?.events));
      const [holding, closed] = body.events.map((event) =>
        wireRecord(unparsedWire(wireRecord(unparsedWire(event))?.session)),
      );
      assert.equal(holding?.status, SESSION_STATUS.WAITING);
      assert.equal(holding?.holding_for_developer, true);
      assert.equal(closed?.status, SESSION_STATUS.COMPLETE);
      assert.equal(closed?.completion_cause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a relaunch does not run an ask that was only queued, and runs a captured observation without rereading it",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const queued = acceptedRunId(yield* Effect.promise(() => submit(h, "second, queued")));
      yield* Effect.promise(() => h.agent.wake([edge(DEF)]));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.pendingWakes(), 1);
      // The process dies with the first running, the second steered or queued, and a captured observation waiting.
      const relaunched = yield* effectHarness({}, fakeBrainStateRepository(h.repository.state));
      yield* Effect.promise(() => relaunched.agent.ready());
      assert.equal(relaunched.agent.request(queued)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
      assert.equal(relaunched.agent.pendingWakes(), 1);
      relaunched.client.answers.push(answered([message("")]));
      yield* advanceHarness(NOW + 10_000);
      // The captured observation is the one thing that runs: an observation turn
      // over the stored entry, reading no transcript, replaying no ask.
      assert.equal(relaunched.client.inputs.length, 1);
      assert.deepEqual(relaunched.sinceReads, []);
      assert.equal(relaunched.agent.pendingWakes(), 0);
      assert.deepEqual(relaunched.repository.state?.cursors, {
        [claude.id]: { def: "def-cursor" },
      });
      for (const record of relaunched.agent.requests()) {
        assert.equal(record.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
      }
    }),
);
