import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Either, type Schema } from "effect";
import { test } from "vitest";
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
  voiceStopSpeakingResultSchema,
} from "./protocol.js";

function parse<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

const LIVE_METHODS = [
  GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION,
  GATEWAY_METHOD.VOICE_END_LIVE_SESSION,
  GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT,
  GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY,
  GATEWAY_METHOD.VOICE_STOP_SPEAKING,
] as const;

test("the five live session methods are in the vocabulary, and every one of them mutates", () => {
  for (const method of LIVE_METHODS) {
    assert.equal(isGatewayMethod(method), true);
    assert.equal(isMutatingGatewayMethod(method), true);
  }
  assert.equal(isGatewayEventKind(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED), true);
});

test("a stop answer carries one boolean and nothing else is read from it", () => {
  assert.deepEqual(parse(voiceStopSpeakingResultSchema, { stopped: true }), { stopped: true });
  assert.deepEqual(parse(voiceStopSpeakingResultSchema, { stopped: false, extra: 1 }), {
    stopped: false,
  });
  assert.equal(parse(voiceStopSpeakingResultSchema, {}), undefined);
  assert.equal(parse(voiceStopSpeakingResultSchema, { stopped: "yes" }), undefined);
});

test("the retired Realtime vocabulary is no longer in the contract", () => {
  for (const method of [
    "voice.mintRealtimeCredential",
    "speech.settle",
    "receiver.report",
    "delivery.claim",
    "delivery.acknowledge",
  ]) {
    assert.equal(isGatewayMethod(method), false);
  }
  for (const event of [
    "speech.offered",
    "speech.withdrawn",
    "delivery.offered",
    "deliveries.withdrawn",
  ]) {
    assert.equal(isGatewayEventKind(event), false);
  }
});

test("a create request carries the offer and nothing else", () => {
  const offer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
  assert.deepEqual(parse(voiceCreateLiveSessionParamsSchema, { sdp: offer }), { sdp: offer });
  assert.equal(parse(voiceCreateLiveSessionParamsSchema, {}), undefined);
  assert.equal(parse(voiceCreateLiveSessionParamsSchema, { sdp: "" }), undefined);
  assert.equal(
    parse(voiceCreateLiveSessionParamsSchema, { sdp: offer, voice: "marin" }),
    undefined,
  );
  assert.equal(
    parse(voiceCreateLiveSessionParamsSchema, { sdp: "a".repeat(LIVE_SDP_MAX_CHARACTERS + 1) }),
    undefined,
  );
});

test("a create answer names the session and the SDP answer, tolerating what a newer host adds", () => {
  const answer = { sessionId: "sess_1", sdpAnswer: "v=0\r\n", quota: { remaining: 1 } };
  assert.deepEqual(parse(voiceCreateLiveSessionResultSchema, answer), {
    sessionId: "sess_1",
    sdpAnswer: "v=0\r\n",
  });
  assert.equal(parse(voiceCreateLiveSessionResultSchema, { sessionId: "sess_1" }), undefined);
  assert.equal(parse(voiceCreateLiveSessionResultSchema, { sdpAnswer: "v=0\r\n" }), undefined);
});

test("a transport report names one of the declared states", () => {
  for (const state of Object.values(LIVE_TRANSPORT_STATE)) {
    assert.deepEqual(parse(voiceReportLiveTransportParamsSchema, { state }), { state });
  }
  assert.equal(parse(voiceReportLiveTransportParamsSchema, { state: "new" }), undefined);
  assert.equal(parse(voiceReportLiveTransportParamsSchema, {}), undefined);
});

test("an activity report is one boolean", () => {
  assert.deepEqual(parse(voiceReportLiveActivityParamsSchema, { idle: true }), { idle: true });
  assert.deepEqual(parse(voiceReportLiveActivityParamsSchema, { idle: false }), { idle: false });
  assert.equal(parse(voiceReportLiveActivityParamsSchema, { idle: "yes" }), undefined);
  assert.equal(parse(voiceReportLiveActivityParamsSchema, { idle: true, sinceMs: 1 }), undefined);
});

test("a session change carries a phase, and a session id and reason only when the host has one", () => {
  for (const phase of Object.values(LIVE_SESSION_PHASE)) {
    assert.deepEqual(parse(voiceLiveSessionChangedSchema, { phase }), { phase });
  }
  assert.deepEqual(
    parse(voiceLiveSessionChangedSchema, {
      sessionId: "sess_1",
      phase: LIVE_SESSION_PHASE.CLOSED,
      reason: "expired",
    }),
    { sessionId: "sess_1", phase: LIVE_SESSION_PHASE.CLOSED, reason: "expired" },
  );
  assert.equal(parse(voiceLiveSessionChangedSchema, { phase: "speaking" }), undefined);
  assert.equal(parse(voiceLiveSessionChangedSchema, { sessionId: "sess_1" }), undefined);
  assert.equal(
    parse(voiceLiveSessionChangedSchema, { phase: LIVE_SESSION_PHASE.STARTED, sessionId: 7 }),
    undefined,
  );
});
