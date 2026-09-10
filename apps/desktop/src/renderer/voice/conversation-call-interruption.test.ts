/**
 * The developer's own words, taking the turn back, and stopping a reply where it
 * stands.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAskResult } from "@sidecar/brain/requests-wire";
import { REALTIME_CLIENT_EVENT, REALTIME_SERVER_EVENT, REALTIME_STATUS } from "@sidecar/realtime";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  armDeveloperTurn,
  askBrainDone,
  brainAnswer,
  briefingAbout,
  deviceArrives,
  harness,
  holdTurn,
  reportedErrors,
  responseCreates,
  toolOutputs,
} from "#testing/conversation-call-harness";

test("the developer's spoken words come back only from their own call", async () => {
  const context = harness();
  await context.session.connect();

  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
    item_id: "item-1",
    transcript: "how is the checkout agent doing?",
  });

  assert.deepEqual(context.spokenAsks, ["how is the checkout agent doing?"]);
});

test("a transcription that came back empty still hands its turn back", async () => {
  const context = harness();
  await context.session.connect();

  // The empty words record nothing — the caller's own paths refuse them —
  // but the turn ending is what lets a preview built from deltas leave.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
    item_id: "item-1",
    transcript: "  ",
  });

  assert.deepEqual(context.spokenAsks, [""]);
});

test("a developer turn is identified before its transcript returns", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  assert.equal(context.spokenAskClosures(), 1);
  assert.deepEqual(context.spokenAskItems, []);

  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED,
    item_id: "item-1",
  });

  assert.deepEqual(context.spokenAskItems, ["item-1"]);
  // A committed turn's words are on their way to a transcript; nothing about
  // this path is a discard.
  assert.equal(context.spokenAskDiscards(), 0);
});

test("the developer's spoken words preview as they are transcribed", async () => {
  const context = harness();
  await context.session.connect();

  // Each piece is handed over as it arrives, keyed by its own turn, so the
  // caller can grow the right preview while the completed transcript is
  // still on the service's clock — and a failure hands the turn back so the
  // preview can leave instead of streaming forever.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
    item_id: "item-1",
    delta: "how is the",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
    item_id: "item-1",
    delta: " checkout agent doing?",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED,
    item_id: "item-2",
  });

  assert.deepEqual(context.spokenAskDeltas, [
    { itemId: "item-1", delta: "how is the" },
    { itemId: "item-1", delta: " checkout agent doing?" },
  ]);
  assert.deepEqual(context.spokenAskFailures, ["item-2"]);
});

test("a reply hands its words back as it ends, whole and once", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "The checkout work is done.",
  });
  assert.deepEqual(context.replyEndings, []);

  // However the reply ends — here the developer talking over it — its words
  // are handed over exactly once, at the moment they are final and still
  // known, so the caller can record them for the next call to remember.
  context.session.stopSpeaking();

  // A reply the brain was not asked for is neither a briefing nor an answer:
  // Conversation records it as plain words.
  assert.deepEqual(context.replyEndings, [
    { texts: ["The checkout work is done."], kind: undefined },
  ]);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a refused call still reads as failed after the channel finishes closing", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  await context.session.connect();
  // The real channel's onclose lands a tick later; it must not rewrite `failed`
  // to `idle`, which would show "Voice off" for a call that actually failed.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("a deadline that fired during the exchange does not hang the handshake", async () => {
  const context = harness({
    channelOpensImmediately: false,
    connectTimeoutMs: 20,
    // The exchange itself outlives the deadline, so no future abort is coming.
    sdpDelayMs: 40,
  });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // No press was waiting, so the stalled handshake held no device either.
  assert.ok(!context.calls.includes("microphone-requested"));
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stop during minting is not reported as unavailable", async () => {
  // The stop lands first, then the mint comes back empty. Without the guard the
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // empty result is treated as a fresh diagnosis and overwrites the idle state
  // the developer asked for.
  const context = harness({ connectionDelayMs: 20, connection: undefined });

  const connecting = context.session.connect();
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stop during minting is not reported as a failure", async () => {
  const context = harness({ connectionDelayMs: 20, connectionError: new Error("bridge gone") });

  const connecting = context.session.connect();
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  // A deliberate stop must not put an error on screen.
  assert.deepEqual(
    context.errors.filter((message) => message !== undefined),
    [],
  );
});

test("push-to-talk reports whether it opened a turn", async () => {
  const context = harness();

  // Nothing to talk into, so the caller must be able to leave the key alone.
  assert.equal(context.session.startListening(), false);

  await context.session.connect();
  // Connected but deviceless is still not a turn: the press opens the device
  // first, and only a device already at hand opens a turn on the spot.
  assert.equal(context.session.startListening(), false);
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a stop that beats the device still releases it", async () => {
  // The press asks for the device and the stop lands before it arrives, so
  // the device shows up with nobody left to hold it. Adopting it would leave
  // the indicator lit with nothing to close it; it is stopped instead.
  const context = harness();
  await context.session.connect();

  context.session.beginTurn();
  await context.session.close();
  await deviceArrives();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("a turn is refused while another is already under way", async () => {
  const context = harness();
  await context.session.connect();
  const speech = briefingAbout("session-a", "The checkout service needs a decision.");

  // While the developer holds the microphone open.
  await holdTurn(context);
  assert.equal(context.session.speak(speech), false);
  assert.equal(context.session.startListening(), false);

  // And while Luke is answering: Luke does not talk over itself, and a typed
  // message waits — but the developer taking the microphone always may, which
  // is what makes one key able to interrupt.
  context.session.stopListening(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(speech), false);

  // Exactly one response was ever asked for.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The turn is still Luke's until his audio stops, so it frees on the quiet
  // rather than on generation finishing.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.speak(speech), false);

  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.speak(speech), true);
});

test("a turn opens from an empty buffer and the key ends it", async () => {
  const context = harness();
  await context.session.connect();
  const sentAfterConnect = context.sent.length;

  // One key: held to open a turn, released to send it.
  context.session.beginTurn();
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  // A muted track still transmits, so a turn has to start from an empty buffer.
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );

  context.session.endTurn(true);
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the tail of an interrupted reply is not heard as the answer to the next", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  // Cut him off, say something else, and send it. The cut lands at the
  // press; the turn itself opens once its device does.
  context.session.beginTurn();
  assert.equal(context.lukeAudible(), false);
  await deviceArrives();
  context.session.endTurn(true);

  // The rest of the old reply is still arriving — the server sent it before it
  // was told to stop — so opening the track when the next turn is sent would
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // play it out as though it were the answer.
  assert.equal(context.lukeAudible(), false);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("an interrupted reply is trimmed to the part that was heard", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });

  // Half a second of silence before he starts, then two seconds of speech.
  clock = 1_500;
  context.session.reportRemoteAudioActive();
  clock = 3_500;
  const before = context.sent.length;

  context.session.beginTurn();

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.ok(truncate, "the record is corrected, not just the sound stopped");
  assert.equal(truncate?.item_id, "item_reply");
  // Two seconds heard, not the two and a half since the reply was asked for:
  // the gap before his first word was never in the room.
  assert.equal(truncate?.audio_end_ms, 2_000);
});

test("a reply cut off before it was heard leaves nothing to correct", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  clock = 1_400;
  const before = context.sent.length;

  // Cut off during the gap before his first word. Nothing reached the room, so
  // there is no impression to undo — and a truncate at zero is refused.
  context.session.beginTurn();

  assert.ok(
    !context.sent
      .slice(before)
      .some((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE),
  );
});

test("each reply is measured from its own first word", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();

  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "first" } });
  clock = 1_100;
  context.session.reportRemoteAudioActive();
  clock = 5_000;
  await holdTurn(context);

  // A second reply, and the clock starts again with it.
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "second" } });
  clock = 6_000;
  context.session.reportRemoteAudioActive();
  clock = 6_750;
  const before = context.sent.length;

  context.session.beginTurn();

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.equal(truncate?.item_id, "second");
  assert.equal(truncate?.audio_end_ms, 750);
});

test("an interrupt asks the server to drop what it already sent", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  const before = context.sent.length;

  context.session.beginTurn();

  const events = context.sent.slice(before).map((event) => event.type);
  // Cancelling alone stops the model producing more and leaves everything it
  // already produced on its way down the connection.
  assert.ok(events.includes(REALTIME_CLIENT_EVENT.RESPONSE_CANCEL));
  assert.ok(events.includes(REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR));
  assert.ok(
    events.indexOf(REALTIME_CLIENT_EVENT.RESPONSE_CANCEL) <
      events.indexOf(REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR),
    "the buffer is emptied only once nothing is still filling it",
  );
});

test("a reply that never starts does not leave Luke silenced", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.lukeAudible(), false);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // An empty commit comes back as an error instead of a reply. Waiting for a
  // `response.created` that is never coming would leave Luke mute for good.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "buffer too small" } });

  assert.equal(context.lukeAudible(), true);
});

test("taking the turn silences Luke rather than only stopping generation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // Audible once the server says the reply is under way, rather than when it
  // was asked for: until then anything arriving belongs to whatever came before.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  context.session.beginTurn();

  // Cancelling stops the model producing more; it does not stop what is already
  // on its way down the connection. Only this end can — and at the press, not
  // once the device arrives.
  assert.equal(context.lukeAudible(), false);
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  // The next reply has to be audible again.
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("taking the turn cuts Luke off mid-reply", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.sent.length = 0;

  await holdTurn(context);

  // The developer's turn always wins: the reply is stopped, not queued behind.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // What the model already produced is dropped as well, or the rest of the
      // sentence plays on over the turn that interrupted it.
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
    ],
  );
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
});

test("a stop cuts the reply where it stands and opens nothing in its place", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item_reply",
    delta: "There are two sessions",
  });
  context.session.reportRemoteAudioActive();
  clock = 2_500;
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  // The cut is the same one talking over him makes — silenced at once,
  // cancelled, and trimmed to the second and a half that was heard — but the
  // turn ends there: no microphone opens and no reply is asked for.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.captions.at(-1), undefined);
  const events = context.sent.slice(before);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
    ],
  );
  assert.equal(events.at(-1)?.audio_end_ms, 1_500);

  // The next reply has to be audible again.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("a stop does not surface the server refusing its already-finished cancellation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  assert.equal(context.session.stopSpeaking(), true);
  const cancellation = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
  );

  // Generation can finish at the service while its buffered audio is still
  // playing here. The local stop still succeeded, so the refusal of its now
  // redundant cancel is not a failure the developer can or should act on.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      message: "Cancellation failed: no active response found",
      event_id: cancellation?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a stop does not surface the server refusing a trim past the audio's end", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  assert.equal(context.session.stopSpeaking(), true);
  const truncate = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  );
  assert.ok(truncate);

  // The audible clock runs on the wall, so a stop landing at the reply's very
  // end can measure past the audio itself. The refusal names no event — a null
  // `event_id` is the shape the service actually sends — so the sentence is
  // all there is to recognize it by, and nothing about it is the developer's
  // to act on.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      code: "invalid_value",
      message: "Audio content of 1500ms is already shorter than 2000ms",
      event_id: null,
    },
  });

  assert.deepEqual(reportedErrors(context), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a real error answering the stop's trim is still surfaced", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  assert.equal(context.session.stopSpeaking(), true);
  const truncate = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "server_error",
      message: "Truncation could not be processed.",
      event_id: truncate?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), ["Truncation could not be processed."]);
});

test("a stop after the reply's audio ran out leaves nothing to trim", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  // The audio runs out while the server still owes the reply its done, so the
  // turn holds and a stop can still land on it. Every word already reached the
  // room: there is nothing to correct, and a trim measured on the wall clock
  // would ask past the audio's end and be refused.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED, response_id: "resp-1" });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  assert.ok(
    !context.sent
      .slice(before)
      .some((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE),
  );
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a stale drain from the spoken half does not skip the follow-up's trim", async () => {
  let clock = 1_000;
  const context = harness({
    now: () => clock,
    askBrain: async () => brainAnswer("Sent."),
  });
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "spoken" } });
  context.session.reportRemoteAudioActive();

  // The reply asks the brain, its follow-up is asked for, and only then does
  // the spoken half's buffer report itself empty: the drain is the old
  // reply's, arriving after the follow-up already owns the turn.
  context.emit(askBrainDone("run the tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED, response_id: "resp-1" });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-2" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "follow_up" },
  });
  clock = 2_000;
  context.session.reportRemoteAudioActive();
  clock = 2_800;
  const before = context.sent.length;

  // A stop mid-follow-up still owes the record a trim: the words cut off were
  // the follow-up's own, and the stale drain spoke for audio it never played.
  assert.equal(context.session.stopSpeaking(), true);

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.ok(truncate, "the follow-up's record is corrected despite the spoken half's drain");
  assert.equal(truncate?.item_id, "follow_up");
  assert.equal(truncate?.audio_end_ms, 800);
});

test("a stop after response.done clears playback without cancelling finished generation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  const events = context.sent.slice(before);
  assert.equal(
    events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL),
    false,
  );
});

test("a real error answering the stop's cancellation is still surfaced", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  assert.equal(context.session.stopSpeaking(), true);
  const cancellation = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "server_error",
      code: "realtime_unavailable",
      message: "Cancellation could not be processed.",
      event_id: cancellation?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), ["Cancellation could not be processed."]);
});

test("a stop with nothing being spoken reports so and sends nothing", async () => {
  const context = harness();
  await context.session.connect();
  const before = context.sent.length;

  // Ready is not a reply, and neither is the developer's own open microphone:
  // the key that asked keeps its other meanings.
  assert.equal(context.session.stopSpeaking(), false);
  await holdTurn(context);
  assert.equal(context.session.stopSpeaking(), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  assert.deepEqual(
    context.sent.slice(before).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );
});

test("a stop that races the reply's confirmation still holds", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  context.deliverRemoteTrack();
  // The stop lands in the gap between asking for the reply and the server
  // confirming it: the cancel and the confirmation cross on the wire.
  await armDeveloperTurn(context);
  assert.equal(context.session.stopSpeaking(), true);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });

  // The late confirmation is the cancelled reply's own. Adopting it would
  // re-open the track over the quiet just asked for.
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // And its finished form must not reach the brain: the turn it belonged to
  // ended with the stop.
  const before = context.sent.length;
  context.emit(askBrainDone("do it anyway", { callId: "call-late", responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, before), [
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  assert.deepEqual(responseCreates(context, before), []);

  // The next reply the developer actually asks for is heard again.
  assert.equal(context.session.speakReply("Two sessions need you."), true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  assert.equal(context.lukeAudible(), true);
});

test("a stopped reply's brain follow-up stands down instead of speaking over the quiet", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.emit(askBrainDone("add tests", { responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(answer, "the ask is out when the stop lands");

  // The developer asks for quiet while the brain is still thinking.
  assert.equal(context.session.stopSpeaking(), true);
  const before = context.sent.length;
  answer?.(brainAnswer("Sent."));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer is still delivered as an item, so the model is not left
  // waiting — but no reply opens to voice it: the quiet just asked for holds.
  assert.deepEqual(toolOutputs(context, before), [{ reply: "Sent." }]);
  assert.deepEqual(responseCreates(context, before), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("closing stops the microphone track", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);

  await context.session.close();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

test("clearing a conversation retires its call before another turn can begin", async () => {
  const context = harness();
  await context.session.connect();
  assert.equal(context.session.speakReply("This real reply belongs to the old call."), true);

  context.session.clearConversation();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
  await context.session.connect();
  await armDeveloperTurn(context);

  // The next turn rides a fresh call, so the server-side conversation the
  // cleared words lived in is gone with the old one.
  assert.equal(context.requests.length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});
