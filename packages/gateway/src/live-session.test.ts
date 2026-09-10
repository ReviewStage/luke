import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  isGatewayEventKind,
  isGatewayMethod,
  isMutatingGatewayMethod,
  LIVE_SDP_MAX_CHARACTERS,
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
  voiceLiveSessionChangedSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "./protocol.js";

const LIVE_METHODS = [
  GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION,
  GATEWAY_METHOD.VOICE_END_LIVE_SESSION,
  GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT,
  GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY,
] as const;

test("the four live session methods are in the vocabulary, and every one of them mutates", () => {
  for (const method of LIVE_METHODS) {
    assert.equal(isGatewayMethod(method), true);
    assert.equal(isMutatingGatewayMethod(method), true);
  }
  assert.equal(isGatewayEventKind(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED), true);
});

test("the realtime vocabulary the live methods will replace still stands beside them", () => {
  for (const method of [
    GATEWAY_METHOD.VOICE_MINT_REALTIME_CREDENTIAL,
    GATEWAY_METHOD.SPEECH_SETTLE,
    GATEWAY_METHOD.RECEIVER_REPORT,
    GATEWAY_METHOD.DELIVERY_CLAIM,
  ]) {
    assert.equal(isGatewayMethod(method), true);
  }
  assert.equal(isGatewayEventKind(GATEWAY_EVENT.SPEECH_OFFERED), true);
  assert.equal(isGatewayEventKind(GATEWAY_EVENT.SPEECH_WITHDRAWN), true);
});

test("a create request carries the offer and nothing else", () => {
  const offer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
  assert.deepEqual(voiceCreateLiveSessionParamsSchema.parse({ sdp: offer }), { sdp: offer });
  assert.equal(voiceCreateLiveSessionParamsSchema.parse({}), undefined);
  assert.equal(voiceCreateLiveSessionParamsSchema.parse({ sdp: "" }), undefined);
  assert.equal(voiceCreateLiveSessionParamsSchema.parse({ sdp: offer, voice: "marin" }), undefined);
  assert.equal(
    voiceCreateLiveSessionParamsSchema.parse({ sdp: "a".repeat(LIVE_SDP_MAX_CHARACTERS + 1) }),
    undefined,
  );
});

test("a create answer names the session and the SDP answer, tolerating what a newer host adds", () => {
  const answer = { sessionId: "sess_1", sdpAnswer: "v=0\r\n", quota: { remaining: 1 } };
  assert.deepEqual(voiceCreateLiveSessionResultSchema.parse(answer), {
    sessionId: "sess_1",
    sdpAnswer: "v=0\r\n",
  });
  assert.equal(voiceCreateLiveSessionResultSchema.parse({ sessionId: "sess_1" }), undefined);
  assert.equal(voiceCreateLiveSessionResultSchema.parse({ sdpAnswer: "v=0\r\n" }), undefined);
});

test("a transport report names one of the declared states", () => {
  for (const state of Object.values(LIVE_TRANSPORT_STATE)) {
    assert.deepEqual(voiceReportLiveTransportParamsSchema.parse({ state }), { state });
  }
  assert.equal(voiceReportLiveTransportParamsSchema.parse({ state: "new" }), undefined);
  assert.equal(voiceReportLiveTransportParamsSchema.parse({}), undefined);
});

test("an activity report is one boolean", () => {
  assert.deepEqual(voiceReportLiveActivityParamsSchema.parse({ idle: true }), { idle: true });
  assert.deepEqual(voiceReportLiveActivityParamsSchema.parse({ idle: false }), { idle: false });
  assert.equal(voiceReportLiveActivityParamsSchema.parse({ idle: "yes" }), undefined);
  assert.equal(voiceReportLiveActivityParamsSchema.parse({ idle: true, sinceMs: 1 }), undefined);
});

test("a session change carries a phase, and a session id and reason only when the host has one", () => {
  for (const phase of Object.values(LIVE_SESSION_PHASE)) {
    assert.deepEqual(voiceLiveSessionChangedSchema.parse({ phase }), { phase });
  }
  assert.deepEqual(
    voiceLiveSessionChangedSchema.parse({
      sessionId: "sess_1",
      phase: LIVE_SESSION_PHASE.CLOSED,
      reason: "expired",
    }),
    { sessionId: "sess_1", phase: LIVE_SESSION_PHASE.CLOSED, reason: "expired" },
  );
  assert.equal(voiceLiveSessionChangedSchema.parse({ phase: "speaking" }), undefined);
  assert.equal(voiceLiveSessionChangedSchema.parse({ sessionId: "sess_1" }), undefined);
  assert.equal(
    voiceLiveSessionChangedSchema.parse({ phase: LIVE_SESSION_PHASE.STARTED, sessionId: 7 }),
    undefined,
  );
});
