/**
 * The capture device's own lifetime on a standing call, a call that drops, and
 * whose reply each ending belongs to.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_SERVER_EVENT, REALTIME_STATUS } from "@sidecar/realtime";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { REPLY_KIND } from "@sidecar/voice/orchestrator";
import {
  armDeveloperTurn,
  askBrainDone,
  brainAnswer,
  deviceArrives,
  harness,
  holdTurn,
  reportedErrors,
  settleReply,
} from "#testing/conversation-call-harness";
import { IDLE_CALL_RETIRE_MS } from "./conversation-call";

test("an idle developer call retires itself after five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const context = harness();
  await context.session.connect();

  t.mock.timers.tick(IDLE_CALL_RETIRE_MS - 1);
  assert.equal(context.session.isConnected, true);

  t.mock.timers.tick(1);

  // An ordinary end: no fault drawn, and the next press opens a fresh call.
  // The conversation itself is the brain's History, not the call's.
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
  assert.deepEqual(reportedErrors(context), []);
  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a press during the idle countdown keeps the call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const context = harness();
  await context.session.connect();

  t.mock.timers.tick(4 * 60_000);
  context.session.beginTurn();
  // The device's arrival is a promise, not a timer, so it lands under the mock.
  await drainMicrotasks();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  context.session.stopListening(true);
  settleReply(context);
  // The countdown starts over at the exchange's end, not from the connect.
  t.mock.timers.tick(4 * 60_000);
  assert.equal(context.session.isConnected, true);

  t.mock.timers.tick(60_000);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("the device closes with the exchange and the conversation stays", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);

  context.session.stopListening(true);
  settleReply(context);

  // The settle is the device's end — tracks stopped, the sender emptied —
  // while the call, and the conversation on it, stay warm and stay the
  // developer's: the next press reopens the device, never replaces the call.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.replacedTracks().at(-1), context.silenceTrack);
  assert.equal(context.session.isConnected, true);
  assert.equal(context.session.microphoneCall, true);
});

test("each exchange opens its own device on the same call", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  settleReply(context);
  const before = context.calls.length;

  context.session.beginTurn();
  // The press is an intention while the device opens, not a turn yet.
  assert.equal(context.session.turnPending, true);
  await deviceArrives();

  assert.deepEqual(context.calls.slice(before), ["microphone-requested"]);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  // The fresh track rode the sender the last one vacated: no new call.
  assert.notEqual(context.replacedTracks().at(-1), null);
  assert.equal(context.session.isConnected, true);
});

test("two presses while the device opens ask for it once", async () => {
  const context = harness();
  await context.session.connect();
  const before = context.calls.length;

  context.session.beginTurn();
  context.session.beginTurn();
  await deviceArrives();

  assert.deepEqual(context.calls.slice(before), ["microphone-requested"]);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a press let go while the device opens drops the turn", async () => {
  const context = harness();
  await context.session.connect();
  const sentAfterConnect = context.sent.length;

  context.session.beginTurn();
  context.session.endTurn(true);
  await deviceArrives();

  // Nothing was captured, so nothing is sent — and the device that arrived
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // for the dropped press closes as fast as it came.
  assert.deepEqual(context.sent.slice(sentAfterConnect), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.microphoneStopped(), true);
});

test("typing never opens the device", async () => {
  const context = harness();
  await context.session.connect();

  assert.equal(context.session.speakReply("The checkout fix is on its tests."), true);

  // A typed ask needs no capture device: its reply is all the call carries,
  // and the device — the part other audio can hear — was never touched.
  assert.ok(!context.calls.includes("microphone-requested"));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a device that arrives for a replaced call is stopped, not adopted", async () => {
  const context = harness();
  await context.session.connect();
  context.gateMicrophone();
  context.session.beginTurn();
  // The call is closed and a fresh one opened while the device is still on
  // its way; the old press's device belongs to nobody.
  await context.session.close();
  await context.session.connect();
  context.ungateMicrophone();
  await deviceArrives();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Nothing rode the fresh call's sender: no track, not even a release.
  assert.deepEqual(context.replacedTracks(), []);
});

test("a device refused after its call was replaced fails nothing", async () => {
  const context = harness();
  await context.session.connect();
  context.failMicrophone();
  context.session.beginTurn();
  await context.session.close();
  await context.session.connect();
  await deviceArrives();

  // The refusal belonged to the closed call and died with it: the call now
  // up keeps standing, ready for its own press.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.ok(!reportedErrors(context).some((message) => /microphone went away/i.test(message)));
});

test("a press against a fresh call is served once a stale open clears", async () => {
  const context = harness();
  await context.session.connect();
  context.gateMicrophone();
  context.session.beginTurn();
  await context.session.close();
  await context.session.connect();
  // The new call's own press lands while the stale open still holds the
  // single-flight slot; it must wait its turn, not be dropped.
  context.session.beginTurn();
  context.ungateMicrophone();
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
});

test("a device that vanishes mid-conversation fails the call at the press", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);
  settleReply(context);
  context.failMicrophone();

  context.session.beginTurn();
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.equal(context.session.turnPending, false);
  assert.ok(reportedErrors(context).some((message) => /microphone went away/i.test(message)));
});

test("a call that drops goes quietly, because the history lost nothing", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  // The service ends every session at an hour, so this is how a long
  // conversation ordinarily ends rather than an exotic failure — and the
  // conversation lives in the history, which the next press re-feeds, so a
  // warning here would report a loss that no longer happens.
  context.closeChannel();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.deepEqual(reportedErrors(context), []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a call put away on purpose does not report itself as lost", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  await context.session.close();

  assert.deepEqual(reportedErrors(context), []);
});

test("a reply voicing a run's end names that run when it ends, and a plain reply names none", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  assert.equal(context.session.speakReply("Two agents are waiting.", "run-7"), true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "Two agents are waiting.",
  });
  context.session.stopSpeaking();
  assert.deepEqual(context.replyEndings, [
    { texts: ["Two agents are waiting."], kind: REPLY_KIND.REPLY, runId: "run-7" },
  ]);
});

test("two replies overlapping each carry their own run: the one cut off keeps its attribution, the next takes none of it", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  assert.equal(context.session.speakReply("First answer.", "run-a"), true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-a" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-a",
    delta: "First answer.",
  });
  // The second reply interrupts the first: the first ends here, as its own.
  assert.equal(context.session.speakReply("Second answer.", "run-b"), true);
  assert.deepEqual(context.replyEndings, [
    { texts: ["First answer."], kind: REPLY_KIND.REPLY, runId: "run-a" },
  ]);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-b" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-b",
    delta: "Second answer.",
  });
  context.session.stopSpeaking();
  assert.deepEqual(context.replyEndings.at(-1), {
    texts: ["Second answer."],
    kind: REPLY_KIND.REPLY,
    runId: "run-b",
  });
  // A reply nobody's run produced carries no run at all.
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-c" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-c",
    delta: "Just talking.",
  });
  context.session.stopSpeaking();
  assert.deepEqual(context.replyEndings.at(-1), { texts: ["Just talking."], kind: undefined });
});

test("the follow-up voicing a spoken ask's answer names the run the answer came from", async () => {
  const context = harness({
    askBrain: async () => brainAnswer("Claude Code is on the tests now.", "run-spoken"),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit(askBrainDone("ask claude code to add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-answer" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-answer",
    delta: "Claude Code is on the tests now.",
  });
  context.session.stopSpeaking();
  assert.deepEqual(context.replyEndings.at(-1), {
    texts: ["Claude Code is on the tests now."],
    kind: REPLY_KIND.REPLY,
    runId: "run-spoken",
  });
});

test("a run's reply cut off before a word arrived still hands its ending over, so its delivery is acknowledged", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  assert.equal(context.session.speakReply("Two agents are waiting.", "run-7"), true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  // The developer stops it before any transcript reached the caption.
  context.session.stopSpeaking();
  assert.deepEqual(context.replyEndings, [{ texts: [], kind: REPLY_KIND.REPLY, runId: "run-7" }]);
  // A reply of nobody's run that said nothing still hands nothing over.
  await armDeveloperTurn(context);
  context.session.stopSpeaking();
  assert.equal(context.replyEndings.length, 1);
});
