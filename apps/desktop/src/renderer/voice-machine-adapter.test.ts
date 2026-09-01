import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EXCHANGE_KIND } from "@sidecar/analytics";
import { REALTIME_STATUS } from "@sidecar/realtime";
import {
  VOICE_MACHINE_ORIGIN,
  VOICE_MACHINE_RELEASE,
  VoiceMachineController,
} from "./voice-machine-adapter";
import { voiceMachineInspectionAllowed } from "./voice-machine-inspector";

test("the controller is the public status and exchange-kind authority", () => {
  const subject = new VoiceMachineController();
  subject.setMicrophoneStatus("granted");
  subject.pressDown();
  assert.equal(subject.status, REALTIME_STATUS.CONNECTING);
  assert.equal(subject.talkOpening, true);
  assert.equal(subject.exchangeKind, PRODUCT_EXCHANGE_KIND.SPOKEN);

  subject.observeSessionStatus(REALTIME_STATUS.LISTENING);
  assert.equal(subject.status, REALTIME_STATUS.LISTENING);
  subject.pressReleased(VOICE_MACHINE_RELEASE.SEND);
  assert.equal(subject.status, REALTIME_STATUS.RESPONDING);
  subject.observeSessionStatus(REALTIME_STATUS.READY);
  assert.equal(subject.status, REALTIME_STATUS.READY);
  subject.stopActor();
});

test("typed and Luke-opened turns preserve count and tool meanings", () => {
  const typed = new VoiceMachineController();
  typed.typedAsk();
  assert.equal(typed.exchangeKind, PRODUCT_EXCHANGE_KIND.TYPED);
  assert.equal(typed.toolsAllowed, true);
  assert.equal(typed.microphoneCall, true);
  typed.stopActor();

  const announcement = new VoiceMachineController();
  assert.equal(announcement.speakLuke(VOICE_MACHINE_ORIGIN.PROACTIVE), true);
  assert.equal(announcement.exchangeKind, PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT);
  assert.equal(announcement.toolsAllowed, false);
  assert.equal(announcement.microphoneCall, false);
  announcement.stopActor();
});

test("a discarded cold press settles only when its call opens", () => {
  const subject = new VoiceMachineController();
  subject.setMicrophoneStatus("granted");
  subject.pressDown();
  subject.pressReleased(VOICE_MACHINE_RELEASE.SEND);
  subject.pressDiscarded();
  assert.equal(subject.status, REALTIME_STATUS.CONNECTING);
  assert.equal(subject.talkOpening, false);
  subject.observeSessionStatus(REALTIME_STATUS.READY);
  assert.equal(subject.status, REALTIME_STATUS.READY);
  subject.stopActor();
});

test("the controller exposes the press buffer owned by the active connect state", () => {
  const subject = new VoiceMachineController();
  subject.setMicrophoneStatus("granted");
  subject.pressDown();
  const buffer = subject.createPressAudioBuffer();
  buffer.push(new Int16Array([1, 2, 3]));
  assert.equal(buffer.isEmpty, false);
  assert.deepEqual(
    buffer.drain().map((chunk) => [...chunk]),
    [[1, 2, 3]],
  );
  subject.observeSessionStatus(REALTIME_STATUS.FAILED);
  assert.throws(() => buffer.push(new Int16Array([4])), /owns no press audio buffer/);
  subject.stopActor();
});

test("resource actors own their cleanup when the chart leaves a state", () => {
  const resources: string[] = [];
  const subject = new VoiceMachineController({
    onResourceStart: (resource) => {
      resources.push(`start:${resource}`);
      return () => resources.push(`cleanup:${resource}`);
    },
    onResourceStop: (resource) => resources.push(`stop:${resource}`),
  });
  subject.typedAsk();
  subject.observeSessionStatus(REALTIME_STATUS.READY);
  subject.observeSessionStatus(REALTIME_STATUS.READY);
  assert.ok(resources.includes("start:idle-timer"));

  subject.setMicrophoneStatus("granted");
  subject.pressDown();
  assert.ok(resources.includes("cleanup:idle-timer"));
  assert.ok(resources.includes("stop:idle-timer"));
  subject.stopActor();
});

test("Stately inspection is opt-in and impossible in packaged, fixture, or capture runs", () => {
  const development = {
    captureMode: false,
    fixtureMode: false,
    packaged: false,
    requested: true,
  };
  assert.equal(voiceMachineInspectionAllowed(development), true);
  assert.equal(voiceMachineInspectionAllowed({ ...development, requested: false }), false);
  assert.equal(voiceMachineInspectionAllowed({ ...development, packaged: true }), false);
  assert.equal(voiceMachineInspectionAllowed({ ...development, fixtureMode: true }), false);
  assert.equal(voiceMachineInspectionAllowed({ ...development, captureMode: true }), false);
});
