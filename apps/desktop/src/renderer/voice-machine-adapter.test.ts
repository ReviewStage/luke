import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EXCHANGE_KIND } from "@sidecar/analytics";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { selectDuckActive } from "@sidecar/voice-machine";
import {
  type LegacyVoiceView,
  shadowExchangeKind,
  VoiceMachineShadowAdapter,
} from "./voice-machine-adapter";
import { voiceMachineInspectionAllowed } from "./voice-machine-inspector";

function view(status: RealtimeStatus, overrides: Partial<LegacyVoiceView> = {}): LegacyVoiceView {
  return {
    meetingQuiet: false,
    microphoneCall: true,
    microphoneStatus: "granted",
    outputSilent: false,
    status,
    typedExchange: false,
    ...overrides,
  };
}

test("the shadow adapter preserves typed exchange status, duck, and count meaning", () => {
  const subject = new VoiceMachineShadowAdapter();
  assert.deepEqual(subject.sync(view(REALTIME_STATUS.IDLE)), {
    duckActive: false,
    status: REALTIME_STATUS.IDLE,
  });
  assert.deepEqual(subject.sync(view(REALTIME_STATUS.CONNECTING, { typedExchange: true })), {
    duckActive: true,
    status: REALTIME_STATUS.CONNECTING,
  });
  assert.equal(shadowExchangeKind(subject), PRODUCT_EXCHANGE_KIND.TYPED);
  assert.deepEqual(subject.sync(view(REALTIME_STATUS.RESPONDING, { typedExchange: true })), {
    duckActive: true,
    status: REALTIME_STATUS.RESPONDING,
  });
  assert.deepEqual(subject.sync(view(REALTIME_STATUS.READY)), {
    duckActive: false,
    status: REALTIME_STATUS.READY,
  });
  subject.stop();
});

test("spoken and announcement exchanges keep their existing classifications", () => {
  const spoken = new VoiceMachineShadowAdapter();
  spoken.sync(view(REALTIME_STATUS.IDLE));
  spoken.sync(view(REALTIME_STATUS.CONNECTING));
  assert.equal(shadowExchangeKind(spoken), PRODUCT_EXCHANGE_KIND.SPOKEN);
  spoken.sync(view(REALTIME_STATUS.LISTENING));
  spoken.sync(view(REALTIME_STATUS.RESPONDING));
  assert.equal(selectDuckActive(spoken.snapshot), true);
  spoken.stop();

  const announcement = new VoiceMachineShadowAdapter();
  announcement.sync(view(REALTIME_STATUS.IDLE, { microphoneCall: false }));
  announcement.sync(view(REALTIME_STATUS.CONNECTING, { microphoneCall: false }));
  assert.equal(shadowExchangeKind(announcement), PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT);
  announcement.sync(view(REALTIME_STATUS.RESPONDING, { microphoneCall: false }));
  assert.equal(selectDuckActive(announcement.snapshot), true);
  announcement.stop();
});

test("parity mismatches are observable without changing the legacy source of truth", () => {
  const mismatches: RealtimeStatus[] = [];
  const subject = new VoiceMachineShadowAdapter({
    onMismatch: (legacy) => mismatches.push(legacy.status),
  });
  subject.sync(view(REALTIME_STATUS.IDLE));
  subject.sync(view(REALTIME_STATUS.READY));
  assert.deepEqual(mismatches, [REALTIME_STATUS.READY]);
  subject.stop();
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
