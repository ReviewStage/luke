/**
 * Connecting, the credential, and the turn a press opens — including the words
 * a press speaks into a handshake, which travel as appends.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRACE_DIRECTION, type TraceDirection } from "@sidecar/devtrace/vocabulary";
import {
  inputAudioAppendEvents,
  inputAudioFormatUpdateEvents,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
} from "@sidecar/realtime";
import { isRecord, type WireRecord } from "@sidecar/wire";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  briefingAbout,
  CONNECTION,
  deviceArrives,
  harness,
  holdTurn,
  settleReply,
} from "#testing/conversation-call-harness";

test("connecting opens the call and leaves the microphone closed", async () => {
  const context = harness();

  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Connected is not the same as listening: the device is the developer's,
  // not the call's, so connecting asks for no microphone at all.
  assert.equal(context.microphoneEnabled(), false);
  assert.ok(!context.calls.includes("microphone-requested"));

  const request = context.requests[0];
  assert.equal(request?.url, CONNECTION.callsUrl);
  assert.equal(request?.apiKey, CONNECTION.value);
  assert.equal(request?.model, CONNECTION.model);
});

test("the wire tap sees both directions, raw, before the parser narrows or drops", async () => {
  const tapped: { direction: TraceDirection; event: WireRecord }[] = [];
  const context = harness({
    onWireEvent: (direction, event) => tapped.push({ direction, event }),
  });
  await context.session.connect();
  context.session.applySpeed(1.25);

  // A live config change crosses the tap as the raw event the call sends.
  const clientTypes = tapped
    .filter((entry) => entry.direction === TRACE_DIRECTION.CLIENT)
    .map((entry) => entry.event.type);
  assert.ok(clientTypes.includes(REALTIME_CLIENT_EVENT.SESSION_UPDATE));

  // A reply's `done` reaches the tap with the fields the parser discards, and
  // an event type this build does not act on reaches it at all.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { id: "resp_1", usage: { input_tokens: 12 } },
  });
  context.emit({ type: "rate_limits.updated", rate_limits: [] });
  const server = tapped.filter((entry) => entry.direction === TRACE_DIRECTION.SERVER);
  const done = server.find((entry) => entry.event.type === REALTIME_SERVER_EVENT.RESPONSE_DONE);
  assert.ok(isRecord(done?.event.response));
  assert.deepEqual(done?.event.response.usage, { input_tokens: 12 });
  assert.ok(server.some((entry) => entry.event.type === "rate_limits.updated"));
});

test("no credential leaves the voice experience explicitly unavailable", async () => {
  const context = harness({ connection: undefined });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
  // No device was opened for a call that never came: there is nothing held
  // and nothing to let go of.
  assert.ok(!context.calls.includes("microphone-requested"));
});

test("the press asks for the device; the connect asks only for the credential", async () => {
  // The microphone is user-driven: opening a call — for a typed ask, say —
  // must not touch the device. Only the press that takes a turn opens it.
  const context = harness({ connectionDelayMs: 20 });

  assert.equal(await context.session.connect(), true);
  assert.deepEqual(context.calls, ["credential-requested", "credential-resolved"]);

  await holdTurn(context);
  assert.deepEqual(context.calls.at(-1), "microphone-requested");
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a refused call fails without leaking the ephemeral secret", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  const reported = context.errors.filter((message) => message !== undefined).join(" ");
  assert.match(reported, /403/);
  assert.ok(!reported.includes(CONNECTION.value));
});

test("a denied microphone fails the call at the press, not before", async () => {
  const context = harness({ microphoneError: new Error("Permission denied") });

  // The call itself opens fine: no device is asked for until a turn is.
  assert.equal(await context.session.connect(), true);

  await holdTurn(context);

  // The press found the device refused, and a call that cannot listen is
  // failed rather than left looking able to.
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.equal(context.session.turnPending, false);
  assert.ok(context.errors.includes("Permission denied"));
});

test("push-to-talk opens the microphone only while held, then asks for a reply", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  context.session.stopListening(true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // The device is not closed at the commit — closing it is audible on shared
  // hardware, and Luke is just starting to answer — but the track is off, so
  // nothing is sent while he speaks.
  assert.equal(context.microphoneStopped(), false);

  settleReply(context);

  // The exchange settling is what closes it, in the quiet after the reply.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.replacedTracks().at(-1), context.silenceTrack);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
});

test("an abandoned turn clears the buffer instead of answering it", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  context.session.stopListening(false);

  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // One clear opens the turn, one abandons it.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
    ],
  );
});

test("push-to-talk does nothing before the call is open", () => {
  const context = harness();

  context.session.startListening();

  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a briefing is spoken once the call is open", async () => {
  const context = harness();
  const speech = briefingAbout("session-a", "The checkout service needs a decision.");

  // Nothing is spoken before there is a call to speak over.
  assert.equal(context.session.speak(speech), false);

  await context.session.connect();
  assert.equal(context.session.speak(speech), true);
  // The briefing travels inside one isolated response request, so it can read
  // neither the developer's conversation nor another briefing, and no tool
  // may answer it.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  const response = context.sent[0]?.response;
  assert.ok(isRecord(response));
  assert.equal(response.conversation, "none");
  assert.deepEqual(response.tools, []);
  assert.equal(response.tool_choice, "none");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a held turn lasts exactly as long as the key is down", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.microphoneEnabled(), false);
  assert.ok(
    context.sent.some((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT),
  );
});

test("a turn let go of before the call opened is dropped, not sent", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  // The microphone opens for the press's turn, and neither the call nor the
  // device was up yet: the key was held over nothing. Committing it would ask
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // the server to answer an empty buffer, which comes back as an error.
  context.session.endTurn(true);
  await opening;

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT),
    [],
  );
});

test("holding the key through a reply takes the turn back", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  await holdTurn(context);

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.lukeAudible(), false);
});

test("a remote track arriving with no stream is wrapped rather than dropped", async () => {
  const received: (MediaStream | undefined)[] = [];
  const context = harness({ onRemoteStream: (stream) => received.push(stream) });
  // Node has no MediaStream; the fallback under test is the one constructor.
  // SAFETY: The global is widened only to hold the stub for this test's scope.
  const globals = globalThis as { MediaStream?: unknown };
  const previous = globals.MediaStream;
  class StubMediaStream {
    readonly tracks: readonly object[];
    constructor(tracks: readonly object[]) {
      this.tracks = tracks;
    }
  }
  globals.MediaStream = StubMediaStream;
  try {
    await context.session.connect();
    context.deliverRemoteTrack([]);
  } finally {
    globals.MediaStream = previous;
  }

  const [stream] = received;
  assert.ok(stream instanceof StubMediaStream);
});

test("a press during the handshake opens the turn it was asking for", async () => {
  const context = harness({ connectionDelayMs: 5 });

  // The order a talk key produces: the press comes first, and the call is what
  // it starts. The press opens the device beside the mint and is captured
  // from the moment it answers, so the turn opens on those words — as
  // appends, with the track joining the sender only when the turn is over.
  context.session.beginTurn();
  await context.session.connect();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Open for the capture to read — a disabled track reads as silence — while
  // the sender stays empty, so nothing rides the network before the commit.
  assert.equal(context.microphoneEnabled(), true);
  assert.deepEqual(context.replacedTracks(), []);
});

test("words spoken into the handshake are carried into the turn it opens", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  // The press asked for the device before the mint was even requested — the
  // press is what opens it — and it answered while the mint was still out:
  // the press's words are already being captured.
  await deviceArrives();
  assert.deepEqual(context.calls.slice(0, 2), ["microphone-requested", "credential-requested"]);
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  assert.equal(context.microphoneEnabled(), true);
  capture.feed([1, 2, 3]);
  capture.feed([4, 5]);
  assert.equal(await opening, true);

  // The turn opened on what was held: the format the appends must be read
  // as, a clean buffer, then the captured chunks in capture order, all on
  // the one ordered channel.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1, 2, 3])),
    ...inputAudioAppendEvents(new Int16Array([4, 5])),
  ]);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The whole turn travels as appends, so the sender carries no track yet:
  // its silence must not land beside the words.
  assert.deepEqual(context.replacedTracks(), []);

  // Words said after the channel opened ride the same path, live.
  capture.feed([6]);
  assert.deepEqual(context.sent.at(-1), inputAudioAppendEvents(new Int16Array([6]))[0]);

  // The release commits behind the last append: nothing can double or drop,
  // because one channel carried every word and the commit follows them all.
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(
    context.sent.slice(-2).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  // The seam settles with the turn: the capture ends, the track closes with
  // it, and the sender takes the track for every turn after this one.
  assert.equal(capture.stopped, true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.replacedTracks().length, 1);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a release during the handshake delivers the words once the channel opens", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  capture.feed([7, 8]);
  // The key comes up while the call is still connecting: the capture stops
  // reading and the device closes this instant — the sealed words wait in
  // memory, not on an open microphone.
  context.session.endTurn(true);
  assert.equal(capture.stopped, true);
  assert.equal(context.microphoneStopped(), true);
  // The press is still owed its turn, so the opening meter keeps riding.
  assert.equal(context.session.turnPending, true);

  assert.equal(await opening, true);
  // The delivery waits a beat after the channel opens rather than landing
  // inside the connect that resolved.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.spokenAskClosures(), 1);
  assert.equal(context.session.turnPending, false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.deepEqual(context.sent[0], inputAudioFormatUpdateEvents()[0]);
  assert.deepEqual(context.sent[2], inputAudioAppendEvents(new Int16Array([7, 8]))[0]);
});

test("the words a failed attempt captured die with it", async () => {
  const context = harness({ connection: undefined, connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([9, 9]);
  context.session.endTurn(true);
  assert.equal(await opening, false);

  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);
  assert.equal(context.pressCaptures[0]?.stopped, true);
  assert.equal(context.session.turnPending, false);

  // The key appears later and something opens a call. Nobody has pressed
  // anything since, so nothing of those words may reach it: a press does not
  // outlive the attempt it started, and now neither does what it said.
  context.provideConnection();
  assert.equal(await context.session.connect(), true);
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(
    context.sent.filter(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND ||
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
    ),
    [],
  );
});

test("a press let go over captured words before the call is up, discarding, takes them back", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  // A discard while the handshake is still out has no channel to seal the
  // words toward, so the turn takes them and its device with it rather than
  // owing a delivery to the call that is about to come up.
  context.session.endTurn(false);
  assert.equal(context.pressCaptures[0]?.stopped, true);
  assert.equal(context.microphoneStopped(), true);
  await opening;

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(
    context.sent.filter(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND ||
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
    ),
    [],
  );
});

test("an abandoned captured turn clears the buffer and settles the seam", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  capture.feed([1, 2]);
  await opening;
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  context.session.endTurn(false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(capture.stopped, true);
  const types = context.sent.map((event) => event.type);
  // One clear opened the turn, one abandoned it, and nothing was committed.
  assert.equal(
    types.filter((type) => type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR).length,
    2,
  );
  assert.equal(types.includes(REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT), false);

  // A chunk from the capture the session already let go of goes nowhere.
  const sentBefore = context.sent.length;
  capture.feed([5]);
  assert.equal(context.sent.length, sentBefore);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // And the next turn rides the track, as every turn before the press did.
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a press landing again over sealed words re-opens the same turn", async () => {
  const context = harness({ connectionDelayMs: 20 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  // Released mid-connect: the words seal for delivery and the device rests.
  context.session.endTurn(true);
  assert.equal(context.pressCaptures[0]?.stopped, true);

  // Pressed again before the channel opened. The sealed delivery is
  // superseded — this press's own release will decide afresh — and capture
  // resumes into the same turn, so neither press's words are lost.
  context.session.beginTurn();
  await deviceArrives();
  const resumed = context.pressCaptures[1];
  assert.ok(resumed);
  resumed.feed([2]);
  await opening;

  // Still held at the open, so the turn is live on both presses' words.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1])),
    ...inputAudioAppendEvents(new Int16Array([2])),
  ]);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(resumed.stopped, true);
});

test("a re-press whose device trails the channel still carries the sealed words", async () => {
  const context = harness({ connectionDelayMs: 10 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  // Released mid-connect: the words seal and the device rests.
  context.session.endTurn(true);

  // Pressed again — but this time the channel opens before the re-press's
  // device has answered, so the turn's device arrives on a connected call.
  context.gateMicrophone();
  context.session.beginTurn();
  assert.equal(await opening, true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  context.ungateMicrophone();
  await deviceArrives();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The re-opened turn still owes the sealed words: it opens as the captured
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // turn it began as, never as a track turn whose clear would wipe them.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1])),
  ]);
  const resumed = context.pressCaptures[1];
  assert.ok(resumed);
  resumed.feed([2]);
  assert.deepEqual(context.sent.at(-1), inputAudioAppendEvents(new Int16Array([2]))[0]);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.turnPending, false);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a re-press released before its device arrives still delivers the sealed words", async () => {
  const context = harness({ connectionDelayMs: 10 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([3]);
  context.session.endTurn(true);

  context.gateMicrophone();
  context.session.beginTurn();
  assert.equal(await opening, true);
  // Let go again while the re-press's device is still opening: the re-press
  // itself captured nothing, but the sealed words it re-opened are still
  // owed, and the press is not left standing forever behind a delivery
  // nothing would ever trigger.
  context.session.endTurn(true);

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.turnPending, false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.deepEqual(context.sent[2], inputAudioAppendEvents(new Int16Array([3]))[0]);

  // The device that was still opening arrives to a turn already delivered:
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // nobody is talking into it, so it closes as fast as it arrived.
  context.ungateMicrophone();
  await deviceArrives();
  assert.equal(context.microphoneStopped(), true);
});

test("a press does not outlive the call it failed to open", async () => {
  const context = harness({ connection: undefined });

  context.session.beginTurn();
  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);

  // The key appears later and something opens a call. Nobody has pressed
  // anything since, so nothing may be listening on the other side of it.
  context.provideConnection();
  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
});
