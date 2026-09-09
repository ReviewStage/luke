/**
 * How a reply ends, the pace it is spoken at, and the failures that end a call.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_CLIENT_EVENT, REALTIME_SERVER_EVENT, REALTIME_STATUS } from "@sidecar/realtime";
import { SpeechMouth } from "@sidecar/voice/orchestrator";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  armDeveloperTurn,
  briefingAbout,
  generationFinished,
  harness,
  holdTurn,
  meterWentQuiet,
  replyUnderWay,
  reportedErrors,
  responseCreates,
  serverDrainedTheAudio,
  sessionAudioField,
  settleReply,
} from "#testing/conversation-call-harness";
import { quietIsLukesOwn, REALTIME_SETTLE_TIMEOUT_MS, REMOTE_QUIET_MS } from "./speak-only-call";

test("a reply ends on the second of its two endings, in either order", async (t) => {
  // Generation finishing and playback finishing are two facts with no fixed
  // order, and the turn holds until both have landed. Both endings the call
  // can be told of run both ways round: the meter's quiet, on a call that has
  // never reported an ending of its own, and the server's own drain.
  for (const endingFirst of [false, true]) {
    for (const ending of [meterWentQuiet, serverDrainedTheAudio]) {
      const context = await replyUnderWay();
      const [first, second] = endingFirst
        ? [ending, generationFinished]
        : [generationFinished, ending];

      first(context);
      // A turn ended on one of the two takes the meter and the face down
      // while Luke is still audible, and lets the next press land over him.
      assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

      second(context);
      assert.equal(context.session.status, REALTIME_STATUS.READY);
      assert.deepEqual(reportedErrors(context), []);
    }
  }

  // Until the `done` lands the conversation still holds an active response.
  // The briefing that queued behind the reply is refused rather than sent:
  // the create it would open is the one the service refuses as a conversation
  // already in progress, surfacing the refusal as a voice error with the
  // briefing lost behind it.
  const holding = await replyUnderWay();
  serverDrainedTheAudio(holding);
  assert.equal(holding.session.speak(briefingAbout("session-a")), false);
  assert.equal(responseCreates(holding).length, 1);
  generationFinished(holding);
  assert.equal(holding.session.speak(briefingAbout("session-a")), true);
  assert.deepEqual(reportedErrors(holding), []);

  // A turn that never ends is worse than one that ends early: the settle
  // backstop closes what a missing `done` left open.
  const stranded = await replyUnderWay();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  serverDrainedTheAudio(stranded);
  assert.equal(stranded.session.status, REALTIME_STATUS.RESPONDING);
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(stranded.session.status, REALTIME_STATUS.READY);
});

test("audio resuming un-remembers the drain and restarts its backstop", async (t) => {
  const context = await replyUnderWay();
  t.mock.timers.enable({ apis: ["setTimeout"] });

  // A reply with two things to say can drain the buffer between them. The
  // drain is remembered as a deferred ending, and the audio starting again is
  // what says it was a pause instead.
  serverDrainedTheAudio(context);
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS - 1_000);
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED });

  // The resume is when Luke was last heard, so the backstop measures from it:
  // the pause's nearly spent clock must not cut the second half short.
  t.mock.timers.tick(1_000);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // Generation concludes while the second half is still audible. A stale
  // drain here ended the turn under it — the face and the duck released while
  // Luke was still speaking.
  generationFinished(context);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The second half's own drain is the ending that lands.
  serverDrainedTheAudio(context);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(reportedErrors(context), []);
});

test("a briefing offered mid-reply waits out the server's own ending", async () => {
  // The reported shape of the fault, whole: Luke is reading one briefing out
  // on his own call when another agent finishes. The second briefing must
  // wait for the server to conclude the first reply — not for the audio
  // alone — or its create collides with the active response.
  let mouth: SpeechMouth | undefined;
  const context = harness({ onStatus: (status) => mouth?.onStatus(status) });
  const timers: (() => void)[] = [];
  const settled: string[] = [];
  mouth = new SpeechMouth({
    session: () => context.session,
    settle: (id, outcome) => settled.push(`${id}:${outcome}`),
    schedule: (callback) => {
      timers.push(callback);
      return timers.length - 1;
    },
    cancel: () => undefined,
  });

  mouth.offer({
    id: "offer-a",
    speakBy: Number.MAX_SAFE_INTEGER,
    turn: briefingAbout("session-a"),
  });
  // The call the mouth opens for itself is a handshake away.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(settled, ["offer-a:spoken"]);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The second agent finishes mid-reply — the arbiter offers the next once
  // the first is settled — and then the first reply's audio drains before
  // its done arrives.
  mouth.offer({
    id: "offer-b",
    speakBy: Number.MAX_SAFE_INTEGER,
    turn: briefingAbout("session-b"),
  });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // One reply asked for so far: the drain freed nothing, so the READY edge
  // the mouth rides has not fired into the server's open response.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The server concludes the first reply, and the second speaks on that edge.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    2,
  );
  assert.deepEqual(settled, ["offer-a:spoken", "offer-b:spoken"]);
  assert.deepEqual(reportedErrors(context), []);
});

test("an error behind a confirmed reply does not end the turn under it", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // An aside mid-reply — a refused truncate, a warning — is surfaced, but the
  // reply is still the server's: ending the turn on it is what offered READY
  // while the conversation still held an active response.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "An aside" } });
  assert.ok(context.errors.includes("An aside"));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The reply's own ending still ends it.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a reply the server refused outright still frees the turn at its error", async () => {
  const context = harness();
  await context.session.connect();
  const spoken = context.session.speak(briefingAbout("session-a"));
  assert.equal(spoken, true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // No response.created ever came: the error is the create's own refusal,
  // and it is all the ending this reply will get.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "Rate limited" } });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a reply the server says made no sound ends at response.done", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // A success is said with silence, so the follow-up after a tool call is
  // often exactly this: a finished reply with no audio in its output. The
  // meter will never hear him and never call him quiet, so the turn must end
  // here rather than waiting out the settle backstop with the face up.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { output: [{ type: "message", id: "item-1", content: [] }] },
  });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("quiet between two sentences is not an ending", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();

  // One reply, with a breath drawn mid-sentence before generation has even
  // finished: nothing about this call yet says it reports its own endings, and
  // the reply is still coming.
  await holdTurn(context);
  context.session.endTurn(true);
  context.session.reportRemoteAudioActive();
  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING, "he is still talking");
  context.session.reportRemoteAudioActive();
  settleReply(context);
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // A longer one, on a call that has now shown it reports real endings.
  // Generation finishes while Luke is still on the first sentence.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });

  // The gap before the second sentence: silence long enough to look like an
  // ending, which is exactly what taking the turn down here would read it as.
  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING, "he is still talking");
  context.session.reportRemoteAudioActive();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a call that never reports an ending still ends its replies", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });

  // Nothing has ever said when audio runs out here, so the quiet is all there
  // is to go on. A turn that never ends is worse than one that ends early.
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a pause mid-reply is not the reply running out", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  // Long enough between two sentences for the meter to call it quiet, and then
  // he carries on. Ending here would take the meter and the face down with Luke
  // still speaking, which is the whole reason the turn does not end on quiet
  // alone.
  context.session.reportRemoteAudioIdle();
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a sentence pause is not the reply running out", async (t) => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.session.reportRemoteAudioLevel(true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The meter calls quiet after a fifth of a second, which is shorter than the
  // pause between two sentences. Ending a turn on that would take the meter
  // down mid-reply — the very thing the debounce is here to stop.
  context.session.reportRemoteAudioLevel(false);
  t.mock.timers.tick(220);
  assert.equal(
    context.session.status,
    REALTIME_STATUS.RESPONDING,
    "the pause between two sentences",
  );

  context.session.reportRemoteAudioLevel(true);
  context.session.reportRemoteAudioLevel(false);
  t.mock.timers.tick(REMOTE_QUIET_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("the quiet before Luke starts is not Luke going quiet", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // One meter draws both halves of the conversation. It reports quiet as it
  // lets go of the microphone and again in the gap before the first word comes
  // back, and neither of those silences is his to answer for — reading them as
  // his takes his waveform down while he is still speaking.
  assert.equal(
    quietIsLukesOwn({ status: REALTIME_STATUS.RESPONDING, heardLuke: false }),
    false,
    "the gap before the reply starts",
  );
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.LISTENING, heardLuke: false }), false);
  // The developer pausing mid-question is the developer's silence, whatever the
  // meter last heard.
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.LISTENING, heardLuke: true }), false);
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.RESPONDING, heardLuke: true }), true);
});

test("a finished response returns the session to ready", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a changed pace reaches the live call without waiting for the next one", async () => {
  const context = harness();
  await context.session.connect();

  context.session.applySpeed(1.25);

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update, {
    type: REALTIME_CLIENT_EVENT.SESSION_UPDATE,
    session: { type: "realtime", audio: { output: { speed: 1.25 } } },
  });
});

test("a pace changed mid-reply waits for the reply to end", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The API applies a pace only between turns, so nothing may be sent while
  // Luke is still speaking.
  context.session.applySpeed(0.75);
  assert.equal(
    context.sent.some(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE &&
        sessionAudioField(event) !== undefined,
    ),
    false,
  );

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update?.session, { type: "realtime", audio: { output: { speed: 0.75 } } });
});

test("a pace changed during the handshake reaches the call it was opening", async () => {
  const context = harness({ connectionDelayMs: 5 });
  const opening = context.session.connect();

  // The credential this call answers with may have been minted before the
  // change reached the minter, so dropping it would leave the live call at
  // the old pace with the row already showing the new one.
  context.session.applySpeed(1.25);
  await opening;

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update?.session, { type: "realtime", audio: { output: { speed: 1.25 } } });
});

test("a pace change with no call open sends nothing", () => {
  // Not a loss: the next call is minted at the stored pace already.
  const context = harness();

  context.session.applySpeed(1.5);

  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a service error is surfaced rather than swallowed", async () => {
  const context = harness();
  await context.session.connect();

  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "Session expired" } });

  assert.ok(context.errors.includes("Session expired"));
});

test("malformed server data never breaks the session", async () => {
  const context = harness();
  await context.session.connect();

  context.emit("not an object");
  context.emitRaw("{");
  // A frame outside the protocol is dropped by the handler rather than thrown.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a failed call releases the microphone instead of stranding it", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);

  context.setConnectionState("failed");

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // FAILED offers "Start voice" again, so nothing may still hold the device.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.isConnected, false);
});

test("a disconnect reported after a failure keeps the call failed", async () => {
  const context = harness();
  await context.session.connect();

  context.setConnectionState("failed");
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);

  // The SDK's own disconnect can land a tick after the failure tore the call
  // down; "Voice off" for a call that failed would hide the retry.
  context.closeChannel();
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("a replaced peer's late failure does not end the new call", async () => {
  const context = harness();
  await context.session.connect();
  await context.session.close();
  await context.session.connect();
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  context.failStalePeer();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.isConnected, true);
});

test("a stalled handshake times out instead of hanging on connecting", async () => {
  const context = harness({ channelOpensImmediately: false, connectTimeoutMs: 40 });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // No press, no device: the stall held nothing that needs releasing.
  assert.ok(!context.calls.includes("microphone-requested"));
  assert.ok(context.errors.some((message) => message?.includes("timed out")));
});

test("a recoverable disconnect does not end the call", async () => {
  const context = harness();
  await context.session.connect();

  context.setConnectionState("disconnected");

  // ICE routinely passes through `disconnected` on a blip.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.isConnected, true);

  context.setConnectionState("failed");
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("an unexpected channel close releases the microphone", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);

  context.closeChannel();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("an error instead of response.done still frees the turn", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // An empty push-to-talk commit reports an error with no matching done.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { message: "Audio buffer is empty" },
  });

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Turn-taking still works rather than being stuck forever.
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("an error that is not ours is still reported and still ends the turn", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { type: "invalid_request_error", message: "The commit held no audio." },
  });

  assert.deepEqual(reportedErrors(context), ["The commit held no audio."]);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a transport close failure cannot strand teardown or the next call", async () => {
  const context = harness({ sdkCloseError: new Error("close failed") });
  await context.session.connect();
  await holdTurn(context);

  context.session.clearConversation();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.microphoneStopped(), true);
  assert.deepEqual(reportedErrors(context), ["close failed"]);
  assert.equal(await context.session.connect(), true);
  assert.doesNotThrow(() => context.session.clearConversation());
});

test("a reply ending at teardown still hands its words over, once", async () => {
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
    delta: "Half a sentence.",
  });

  // The call drops mid-reply. The words are still handed over — the caller's
  // history keeps them — and the retired call keeps nothing pending, so the
  // next call starts clean.
  context.closeChannel();
  assert.deepEqual(context.replyEndings, [{ texts: ["Half a sentence."], kind: undefined }]);
  assert.equal(context.captions.at(-1), undefined);

  await context.session.connect();
  await armDeveloperTurn(context);
  assert.equal(context.replyEndings.length, 1);
});
