import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import {
  normalizeSession,
  type ProviderTranscriptSinceResult,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionIdentity,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, unparsedWire, wireRecord } from "@sidecar/wire";
import { type BrainAgentOptions, LOOK_SUBJECT } from "./agent.js";
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
  harness,
  itemsOfType,
  itemText,
  message,
  NOW,
  session,
  submit,
  TRANSCRIPT_SECRET,
} from "./harness.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
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

test("wakes inside the window open one turn, with each session's delta read once and the context last", async () => {
  const h = harness();
  await h.agent.wake([edge(ABC)]);
  await h.agent.wake([edge(ABC, NOW + 500), edge(DEF, NOW + 1_000)]);
  assert.equal(h.client.inputs.length, 0);
  await h.clock.advance(NOW + 3_000);

  assert.equal(h.client.inputs.length, 1);
  const input = h.client.inputs[0] ?? [];
  assert.equal(input.length, 2);
  const wake = itemText(input[0]);
  assert.ok(wake.startsWith(`${BRAIN_INPUT_MARKER.OBSERVED_EVENTS} `));
  assert.equal(wake.split(`${TRANSCRIPT_SECRET} for abc`).length - 1, 1);
  assert.equal(wake.split(`${TRANSCRIPT_SECRET} for def`).length - 1, 1);
  assert.ok(itemText(input[1]).startsWith(`${BRAIN_INPUT_MARKER.STANDING_CONTEXT} `));
  assert.ok(itemText(input[1]).includes("Durable facts: none."));
  // Each batch captures from the capture cursor: the second hook for abc reads
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
  assert.ok(
    !remembered.some((item) => itemText(item).startsWith(BRAIN_INPUT_MARKER.STANDING_CONTEXT)),
  );
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.WAKE);
  assert.equal(h.traces[0]?.inputTokens, 100);
  assert.ok(!JSON.stringify(h.traces).includes(TRANSCRIPT_SECRET));
  assert.equal(h.traces[0]?.transcriptBytes, `${TRANSCRIPT_SECRET} for abc`.length * 2);
});

test("the same session id under two providers is two identities, each read once", async () => {
  const codexAbc: SessionIdentity = { providerId: "codex", providerSessionId: "abc" };
  const h = harness({
    roster: () => ({ text: "roster", identities: [ABC, codexAbc] }),
  });
  await h.agent.wake([edge(ABC), edge(codexAbc), edge(ABC, NOW + 500)]);
  await h.clock.advance(NOW + 3_000);

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
});

test("stop opens nothing more, and a captured observation stays for the next agent", async () => {
  const h = harness();
  await h.agent.wake([edge(ABC)]);
  await h.agent.stop();
  assert.equal(h.agent.pendingWakes(), 1);
  assert.equal(h.repository.state?.inbox.length, 1);
  await h.clock.advance(NOW + 10_000);
  assert.equal(h.client.inputs.length, 0);
  assert.deepEqual(await submit(h, "hello?"), {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
  });
});

test("a roster look carries only the transcripts that grew, never the roster", async () => {
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
    roster: () => ({
      text: "Currently observed sessions:\n- abc\n- def\n- cloud-1",
      identities: [ABC, DEF, { providerId: "conductor", providerSessionId: "cloud-1" }],
      sessions: [working, settled, cloud],
    }),
    readTranscriptSince: async (identity): Promise<ProviderTranscriptSinceResult> => {
      read.push(identity.providerSessionId);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        text: identity.providerSessionId === "abc" ? "assistant: still going" : "",
        cursor: `${identity.providerSessionId}-cursor`,
        truncated: false,
      };
    },
  });
  h.agent.rosterLook();
  await drainMicrotasks(20);

  assert.equal(h.client.inputs.length, 1);
  const input = h.client.inputs[0] ?? [];
  const opening = itemText(itemsOfType(input, RESPONSES_INPUT_ITEM_TYPE.MESSAGE)[0]);
  assert.ok(opening.startsWith(`${BRAIN_INPUT_MARKER.OBSERVED_EVENTS} `));
  const body = wireRecord(unparsedWire(JSON.parse(opening.slice(opening.indexOf("\n") + 1))));
  assert.ok(body);
  // The roster rides in the standing context of the same request, so the
  // opening item repeats neither it nor a flag naming the look.
  assert.equal(body.scheduled_roster_look, undefined);
  assert.equal(body.roster, undefined);
  // Only the working local session's transcript is carried: the settled one
  // had no cursor and nothing live, the cloud one is not read on a look, and
  // a delta that came back empty is left out rather than reported as news.
  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length, 1);
  const only = wireRecord(unparsedWire(body.events[0]));
  assert.equal(only?.kind, BRAIN_WAKE_KIND.ROSTER);
  assert.equal(only?.provider_session_id, "abc");
  assert.deepEqual(read, ["abc"]);
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);

  // The look can be triggered again by the host.
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 2);
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
  await drainMicrotasks(20);
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
  await drainMicrotasks(20);
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 0);
  release?.();
  await asked;
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);

  // After the turn completes, the look proceeds.
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.traces.at(-1)?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  await h.agent.stop();
});

test("a conversation that observes no session opens no look, however the roster stands", async () => {
  const h = harness({
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
  await drainMicrotasks(20);
  // No transcript is read and no inference opens: this conversation's turns
  // are the developer's asks and its own scheduled review.
  assert.equal(h.client.inputs.length, 0);
  assert.deepEqual(h.sinceReads, []);
  assert.equal(h.agent.pendingWakes(), 0);
});

test("a hook delivered twice is one wake, and every distinct capture is kept until a turn consumes it", async () => {
  const h = harness();
  await h.agent.wake([edge(ABC), edge(ABC)]);
  assert.equal(h.agent.pendingWakes(), 1);
  await h.agent.wake(Array.from({ length: 40 }, (_, index) => edge(DEF, NOW + index)));
  assert.equal(h.agent.pendingWakes(), 41);
});

test("captures past a turn's depth are kept whole across a relaunch and read in order, none dropped", async () => {
  // Each hook reads a distinct piece of transcript; the model is quiet, so
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
  const quiet = harness({
    ...reading(),
    client: {
      respond: () => Promise.reject(new Error("never asked")),
      quietUntil: () => NOW + 60_000,
    },
  });
  for (let index = 0; index < 25; index += 1) {
    await quiet.agent.wake([edge(ABC, NOW + index)]);
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
  await quiet.agent.stop();

  // A relaunch reads what was captured without touching the transcript: the
  // first turn opens with the oldest twenty, the next look with the rest.
  const relaunched = harness(reading(), quiet.repository);
  relaunched.client.answers.push(answered([message("")]), answered([message("")]));
  await relaunched.agent.ready();
  await relaunched.clock.advance(relaunched.clock.instant + 3_000);
  await drainMicrotasks(20);
  assert.equal(relaunched.sinceReads.length, 0);
  assert.equal(relaunched.client.inputs.length, 1);
  const firstTurn = (relaunched.client.inputs[0] ?? []).map(itemText).join("\n");
  for (let index = 1; index <= 20; index += 1) assert.ok(firstTurn.includes(`PIECE_${index}`));
  assert.ok(!firstTurn.includes("PIECE_21"));
  assert.equal(relaunched.agent.pendingWakes(), 5);
  assert.equal(relaunched.repository.state?.inbox.length, 5);
  // The next look finds nothing new in the transcript and still opens the
  // turn the standing captures are owed.
  relaunched.agent.rosterLook();
  await relaunched.clock.advance(relaunched.clock.instant + 3_000);
  await drainMicrotasks(20);
  assert.equal(relaunched.client.inputs.length, 2);
  const secondTurn = (relaunched.client.inputs[1] ?? []).map(itemText).join("\n");
  for (let index = 21; index <= 25; index += 1) assert.ok(secondTurn.includes(`PIECE_${index}`));
  assert.equal(relaunched.agent.pendingWakes(), 0);
  assert.equal(relaunched.repository.state?.inbox.length, 0);
});

test("a conversation that looks at one session reads only it, and a repeated unchanged look opens no inference", async () => {
  const notices: import("./wake-events.js").BrainTurnReport[] = [];
  let text = `${TRANSCRIPT_SECRET} for abc`;
  const h = harness({
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
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  assert.deepEqual(notices[0]?.identities, [ABC]);
  assert.ok(!itemText((h.client.inputs[0] ?? [])[0]).includes("for def"));
  assert.equal(h.repository.state?.cursors.codex, undefined);
  assert.deepEqual(Object.keys(h.repository.state?.cursors["claude-code"] ?? {}), ["abc"]);
  // Nothing gained and the session unchanged: the look is suppressed, deterministically.
  text = "";
  h.agent.rosterLook();
  await drainMicrotasks(20);
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  assert.equal(notices.length, 1);
  // The transcript growing opens a look again.
  text = "more words";
  h.client.answers.push(answered([message("")]));
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 2);
});

test("a session the developer is speaking with wakes nothing, and the exchange over is read past rather than replayed", async () => {
  let live = true;
  let transcript = `${TRANSCRIPT_SECRET} said aloud`;
  const h = harness({
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
  // Neither the look nor the provider's own hook opens an inference over an
  // exchange being heard first-hand, and nothing is written down to open one
  // later — but the capture cursor moves past what was said.
  h.agent.rosterLook();
  await drainMicrotasks(20);
  await h.agent.wake([
    {
      ...edge(ABC),
      session: session("abc", { status: SESSION_STATUS.WORKING, realtimeVoiceLive: true }),
    },
  ]);
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 0);
  assert.equal(h.repository.state?.inbox.length ?? 0, 0);
  assert.equal(h.repository.state?.captureCursors["claude-code"]?.abc, String(transcript.length));

  // The exchange ending is not news: with nothing gained since, the look
  // opens nothing and replays none of what the developer heard themselves.
  live = false;
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 0);

  // A fresh turn after it is read from where the exchange left off.
  transcript += "\nassistant: back to typing";
  h.client.answers.push(answered([message("")]));
  h.agent.rosterLook();
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  const opening = itemText((h.client.inputs[0] ?? [])[0]);
  assert.ok(opening.includes("back to typing"));
  assert.ok(!opening.includes(TRANSCRIPT_SECRET));
  assert.equal(h.repository.state?.captureCursors["claude-code"]?.abc, String(transcript.length));
  await h.agent.stop();
});

test("a wake's session summary carries the hold and the completion cause beside the status", async () => {
  const h = harness();
  await h.agent.wake([
    {
      ...edge(ABC),
      hookEvent: "PermissionRequest",
      session: session("abc", { holdingForDeveloper: true }),
    },
    {
      ...edge(DEF),
      session: session("def", {
        status: SESSION_STATUS.COMPLETE,
        completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
      }),
    },
  ]);
  await h.clock.advance(NOW + 3_000);
  await drainMicrotasks(20);
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
  await h.agent.stop();
});

test("a relaunch does not run an ask that was only queued, and runs a captured observation without rereading it", async () => {
  const inner = new FakeClient();
  const gated = gatedClient(inner);
  const h = harness({ client: gated.client });
  acceptedRunId(await submit(h, "first?"));
  await drainMicrotasks(20);
  const queued = acceptedRunId(await submit(h, "second, queued"));
  await h.agent.wake([edge(DEF)]);
  await drainMicrotasks(20);
  assert.equal(h.agent.pendingWakes(), 1);
  // The process dies with the first running, the second steered or queued, and a captured observation waiting.
  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  assert.equal(relaunched.agent.request(queued)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(relaunched.agent.pendingWakes(), 1);
  relaunched.client.answers.push(answered([message("")]));
  await relaunched.clock.advance(NOW + 10_000);
  // The captured observation is the one thing that runs: an observation turn
  // over the stored entry, reading no transcript, replaying no ask.
  assert.equal(relaunched.client.inputs.length, 1);
  assert.deepEqual(relaunched.sinceReads, []);
  assert.ok(
    itemText((relaunched.client.inputs[0] ?? [])[0]).includes(`${TRANSCRIPT_SECRET} for def`),
  );
  assert.equal(relaunched.agent.pendingWakes(), 0);
  assert.deepEqual(relaunched.repository.state?.cursors, { [claude.id]: { def: "def-cursor" } });
  for (const record of relaunched.agent.requests()) {
    assert.equal(record.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  }
});
