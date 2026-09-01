import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/realtime";
import { createActor } from "xstate";
import {
  type NoticeQueueSnapshot,
  selectDuckActive,
  selectExchangeKind,
  selectForcedCaptions,
  selectRealtimeStatus,
  selectTalkOpening,
  selectToolsAllowed,
  selectVoiceRestart,
  VOICE_EXCHANGE_KIND,
  VOICE_MACHINE_EVENT,
  VOICE_MICROPHONE_PERMISSION,
  VOICE_PRESS_RELEASE,
  VOICE_RESOURCE,
  VOICE_RESTART,
  VOICE_TURN_ORIGIN,
  type VoiceResource,
  voiceMachine,
} from "./voice-machine.js";

function resourceHarness() {
  const active = new Map<VoiceResource, number>();
  const starts: VoiceResource[] = [];
  const stops: VoiceResource[] = [];
  const actor = createActor(voiceMachine, {
    input: {
      onResourceStart: (resource) => {
        starts.push(resource);
        active.set(resource, (active.get(resource) ?? 0) + 1);
      },
      onResourceStop: (resource) => {
        stops.push(resource);
        active.set(resource, (active.get(resource) ?? 1) - 1);
      },
    },
  }).start();
  return { actor, active, starts, stops };
}

function grantMicrophone(actor: ReturnType<typeof resourceHarness>["actor"]): void {
  actor.send({
    type: VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED,
    permission: VOICE_MICROPHONE_PERMISSION.GRANTED,
  });
}

test("a typed ask opens no capture device and is the only forced-caption tool turn", () => {
  const { actor, active } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });

  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.CONNECTING);
  assert.equal(active.get(VOICE_RESOURCE.PEER_CONNECTION), 1);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM) ?? 0, 0);
  assert.equal(active.get(VOICE_RESOURCE.PRESS_AUDIO_BUFFER) ?? 0, 0);

  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.RESPONDING);
  assert.equal(selectToolsAllowed(actor.getSnapshot()), true);
  assert.equal(selectForcedCaptions(actor.getSnapshot()), true);
  assert.equal(selectExchangeKind(actor.getSnapshot()), VOICE_EXCHANGE_KIND.TYPED);
  actor.stop();
});

test("a spoken press owns capture through the reply and its connect attempt alone owns audio", () => {
  const { actor, active, stops } = resourceHarness();
  grantMicrophone(actor);
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });

  assert.equal(selectTalkOpening(actor.getSnapshot()), true);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);
  assert.equal(active.get(VOICE_RESOURCE.PRESS_AUDIO_BUFFER), 1);

  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.LISTENING);
  assert.equal(active.get(VOICE_RESOURCE.PRESS_AUDIO_BUFFER), 0);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);

  actor.send({
    type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
    release: VOICE_PRESS_RELEASE.SEND,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.RESPONDING);
  assert.equal(selectToolsAllowed(actor.getSnapshot()), true);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);

  actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.READY);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 0);
  assert.ok(stops.includes(VOICE_RESOURCE.PRESS_AUDIO_BUFFER));
  assert.ok(stops.includes(VOICE_RESOURCE.CAPTURE_STREAM));
  actor.stop();
});

test("a failed connect discards both press audio and capture with that attempt", () => {
  const { actor, active } = resourceHarness();
  grantMicrophone(actor);
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_FAILED });

  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.FAILED);
  assert.equal(active.get(VOICE_RESOURCE.PEER_CONNECTION), 0);
  assert.equal(active.get(VOICE_RESOURCE.PRESS_AUDIO_BUFFER), 0);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 0);

  actor.send({ type: VOICE_MACHINE_EVENT.AVAILABILITY_RESTORED });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.IDLE);
  assert.equal(selectTalkOpening(actor.getSnapshot()), false);
  actor.stop();
});

test("a tap latches a pending turn and the next release sends it", () => {
  const { actor } = resourceHarness();
  grantMicrophone(actor);
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
  actor.send({
    type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
    release: VOICE_PRESS_RELEASE.LATCH,
  });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });

  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.LISTENING);
  actor.send({
    type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
    release: VOICE_PRESS_RELEASE.SEND,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.RESPONDING);
  actor.stop();
});

test("microphone refusal drops a pending press and quota refusal is unavailable", () => {
  const { actor, active } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });
  assert.equal(selectTalkOpening(actor.getSnapshot()), false);
  actor.send({
    type: VOICE_MACHINE_EVENT.MICROPHONE_PERMISSION_CHANGED,
    permission: VOICE_MICROPHONE_PERMISSION.DENIED,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.IDLE);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM) ?? 0, 0);

  actor.send({ type: VOICE_MACHINE_EVENT.QUOTA_SPENT });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.UNAVAILABLE);
  actor.stop();
});

test("introduction can listen and respond but never ducks or enables tools", () => {
  const { actor, active } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.INTRODUCTION_STARTED });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });

  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.LISTENING);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);
  assert.equal(selectDuckActive(actor.getSnapshot()), false);
  assert.equal(selectToolsAllowed(actor.getSnapshot()), false);

  actor.send({
    type: VOICE_MACHINE_EVENT.PRESS_RELEASED,
    release: VOICE_PRESS_RELEASE.SEND,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.RESPONDING);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);
  assert.equal(selectDuckActive(actor.getSnapshot()), false);
  actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 0);
  actor.stop();
});

for (const origin of [
  VOICE_TURN_ORIGIN.ARRIVAL,
  VOICE_TURN_ORIGIN.EVALUATOR,
  VOICE_TURN_ORIGIN.PROACTIVE,
  VOICE_TURN_ORIGIN.TOOL_OUTCOME,
] as const) {
  test(`${origin} speech stays tool-free`, () => {
    const { actor } = resourceHarness();
    actor.send({ type: VOICE_MACHINE_EVENT.SPEAK_LUKE, origin });
    actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
    assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.RESPONDING);
    assert.equal(selectToolsAllowed(actor.getSnapshot()), false);
    assert.equal(selectExchangeKind(actor.getSnapshot()), VOICE_EXCHANGE_KIND.ANNOUNCEMENT);
    actor.stop();
  });
}

test("a talk key tears down speak-only speech before opening the developer exchange", () => {
  const { actor, starts, stops, active } = resourceHarness();
  grantMicrophone(actor);
  actor.send({
    type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
    origin: VOICE_TURN_ORIGIN.PROACTIVE,
  });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  actor.send({ type: VOICE_MACHINE_EVENT.PRESS_DOWN });

  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.CONNECTING);
  assert.equal(selectExchangeKind(actor.getSnapshot()), VOICE_EXCHANGE_KIND.SPOKEN);
  assert.equal(active.get(VOICE_RESOURCE.CAPTURE_STREAM), 1);
  assert.equal(active.get(VOICE_RESOURCE.PRESS_AUDIO_BUFFER), 1);
  assert.equal(starts.filter((resource) => resource === VOICE_RESOURCE.PEER_CONNECTION).length, 2);
  assert.equal(stops.filter((resource) => resource === VOICE_RESOURCE.PEER_CONNECTION).length, 1);
  actor.stop();
});

test("meeting quiet preserves queued notice order and releases the same notices", () => {
  const { actor } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED, active: true });
  actor.send({ type: VOICE_MACHINE_EVENT.NOTICE_ENQUEUED, noticeId: "session-a" });
  actor.send({ type: VOICE_MACHINE_EVENT.NOTICE_ENQUEUED, noticeId: "session-b" });

  const queue = actor.getSnapshot().children[VOICE_RESOURCE.NOTICE_HOLD_QUEUE];
  assert.ok(queue);
  const queueSnapshot = () => (queue.getSnapshot() as { context: NoticeQueueSnapshot }).context;
  assert.deepEqual(queueSnapshot().held, ["session-a", "session-b"]);

  actor.send({
    type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
    origin: VOICE_TURN_ORIGIN.PROACTIVE,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.IDLE);

  actor.send({ type: VOICE_MACHINE_EVENT.MEETING_QUIET_CHANGED, active: false });
  assert.deepEqual(queueSnapshot().ready, ["session-a", "session-b"]);
  actor.send({
    type: VOICE_MACHINE_EVENT.SPEAK_LUKE,
    origin: VOICE_TURN_ORIGIN.PROACTIVE,
  });
  assert.equal(selectRealtimeStatus(actor.getSnapshot()), REALTIME_STATUS.CONNECTING);
  actor.stop();
});

test("quiet and idle timers exist only in the states whose clocks they own", () => {
  const { actor, active } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  assert.equal(active.get(VOICE_RESOURCE.QUIET_TIMER), 1);
  assert.equal(active.get(VOICE_RESOURCE.IDLE_TIMER) ?? 0, 0);

  actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
  assert.equal(active.get(VOICE_RESOURCE.QUIET_TIMER), 0);
  assert.equal(active.get(VOICE_RESOURCE.IDLE_TIMER), 1);

  actor.send({ type: VOICE_MACHINE_EVENT.STOP });
  assert.equal(active.get(VOICE_RESOURCE.IDLE_TIMER), 0);
  actor.stop();
});

test("mute forces captions only while output is silent", () => {
  const { actor } = resourceHarness();
  actor.send({ type: VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED, silent: true });
  assert.equal(selectForcedCaptions(actor.getSnapshot()), true);
  actor.send({ type: VOICE_MACHINE_EVENT.OUTPUT_SILENCE_CHANGED, silent: false });
  assert.equal(selectForcedCaptions(actor.getSnapshot()), false);
  actor.stop();
});

test("voice restart waits for a live reply, restarts on settle, and drops with the call", () => {
  const restarts: string[] = [];
  const actor = createActor(voiceMachine, {
    input: { onRestart: (restart) => restarts.push(restart) },
  }).start();

  actor.send({ type: VOICE_MACHINE_EVENT.VOICE_CHANGED, live: false });
  assert.equal(selectVoiceRestart(actor.getSnapshot()), VOICE_RESTART.NONE);

  actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  actor.send({ type: VOICE_MACHINE_EVENT.VOICE_CHANGED, live: true });
  assert.equal(selectVoiceRestart(actor.getSnapshot()), VOICE_RESTART.WAIT);
  actor.send({ type: VOICE_MACHINE_EVENT.REPLY_SETTLED });
  assert.deepEqual(restarts, [VOICE_RESTART.RESTART]);

  actor.send({ type: VOICE_MACHINE_EVENT.TYPED_ASK });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_CONNECTED });
  actor.send({ type: VOICE_MACHINE_EVENT.VOICE_CHANGED, live: true });
  actor.send({ type: VOICE_MACHINE_EVENT.CALL_FAILED });
  assert.deepEqual(restarts, [VOICE_RESTART.RESTART, VOICE_RESTART.DROP]);
  actor.stop();
});
