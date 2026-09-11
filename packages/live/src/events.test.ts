import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  closeEvent,
  commentaryAppend,
  decodeLivePayload,
  instructionsAppend,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  liveExchangeActive,
  muteEvent,
  parseLiveServerEvent,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  thinkingAppend,
  unmuteEvent,
} from "./events.js";

const SERVER_EVENT_TYPES: readonly string[] = Object.values(LIVE_SERVER_EVENT);
const CLIENT_EVENT_TYPES: readonly string[] = Object.values(LIVE_CLIENT_EVENT);

test("every append carries its event id and a required delegation id, null included", () => {
  const spoken = commentaryAppend({ eventId: "say-1", delegationId: "item_abc", content: "Done." });
  const quiet = thinkingAppend({ eventId: "ctx-1", delegationId: null, content: "Roster: 2." });
  const steer = instructionsAppend({ eventId: "stop-1", delegationId: null, content: "Stop." });

  assert.equal(spoken.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(quiet.type, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(steer.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(spoken.delegation_id, "item_abc");
  assert.ok(Object.hasOwn(quiet, "delegation_id"));
  assert.equal(quiet.delegation_id, null);
  assert.equal(steer.delegation_id, null);
  assert.deepEqual(Object.keys(spoken).sort(), ["content", "delegation_id", "event_id", "type"]);
  assert.equal(spoken.event_id, "say-1");
});

test("the microphone switch and the close carry only a type and an event id", () => {
  assert.deepEqual(muteEvent("m-1"), { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m-1" });
  assert.deepEqual(unmuteEvent("u-1"), {
    type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    event_id: "u-1",
  });
  assert.deepEqual(closeEvent("c-1"), { type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c-1" });
});

test("no client event starts a session or appends audio", () => {
  assert.equal(CLIENT_EVENT_TYPES.includes("session.start"), false);
  assert.equal(CLIENT_EVENT_TYPES.includes("session.input_audio.append"), false);
});

test("an acknowledgment is matched to its command through client_event_id", () => {
  const event = parseLiveServerEvent(
    JSON.stringify({
      type: LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
      event_id: "event_7",
      client_event_id: "say-1",
      start_ms: 4_000,
      end_ms: 4_800,
    }),
  );

  assert.ok(event);
  assert.equal(event.type, LIVE_SERVER_EVENT.COMMENTARY_APPENDED);
  if (event.type !== LIVE_SERVER_EVENT.COMMENTARY_APPENDED) return;
  assert.equal(event.client_event_id, "say-1");
  assert.equal(event.start_ms, 4_000);
  assert.equal(event.end_ms, 4_800);
});

test("a transcript delta keeps its text exactly, whitespace included", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    event_id: "event_1",
    delta: " is",
    start_ms: 1_000,
    end_ms: 1_200,
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA) assert.fail(event.type);
  assert.equal(event.delta, " is");
  assert.equal(event.delta.length, 3);
});

test("a delegation is read for its id, target, and offset, never for words", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
    event_id: "event_delegation",
    offset_ms: 1_000,
    delegation: { id: "item_9tA2bF3h7K9m2P5q8R1s4", type: "delegation", target: "client" },
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.DELEGATION_CREATED) assert.fail(event.type);
  assert.equal(event.delegation.id, "item_9tA2bF3h7K9m2P5q8R1s4");
  assert.equal(event.delegation.target, LIVE_DELEGATION_TARGET.CLIENT);
  assert.equal(event.offset_ms, 1_000);
  assert.deepEqual(Object.keys(event.delegation).sort(), ["id", "target"]);
});

test("session.closed carries its reason and the usage snapshot", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "event_closed",
    reason: "expired",
    usage: { seconds: 91.5 },
    session: { id: "live_123", status: "active", model: "gpt-live-1", expires_at: 1 },
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.SESSION_CLOSED) assert.fail(event.type);
  assert.equal(event.reason, LIVE_CLOSE_REASON.EXPIRED);
  assert.equal(event.usage.seconds, 91.5);
  assert.equal(event.session?.id, "live_123");
});

test("an unlisted close reason refuses the event rather than inventing one", () => {
  assert.equal(
    parseLiveServerEvent({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "event_closed",
      reason: "someday",
      usage: { seconds: 1 },
    }),
    undefined,
  );
});

test("an error may name no client event and may carry a null code", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: "event_error",
    error: { type: "invalid_request_error", code: null, message: "Refused." },
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.ERROR) assert.fail(event.type);
  assert.equal(event.client_event_id, undefined);
  assert.equal(event.error.client_event_id, undefined);
  assert.equal(event.error.code, undefined);
  assert.equal(event.error.type, "invalid_request_error");
});

test("usage updates are read as snapshots with an optional context ratio", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.USAGE_UPDATED,
    event_id: "event_usage_1",
    usage: { seconds: 12 },
    context_window: { usage_ratio: 0.42 },
  });

  assert.ok(event);
  if (event.type !== LIVE_SERVER_EVENT.USAGE_UPDATED) assert.fail(event.type);
  assert.equal(event.usage.seconds, 12);
  assert.equal(event.context_window?.usage_ratio, 0.42);
});

test("reflected audio parses to its type alone", () => {
  const event = parseLiveServerEvent({
    type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
    delta: "AAAA",
    start_ms: 0,
    end_ms: 20,
  });

  assert.ok(event);
  assert.deepEqual(Object.keys(event), ["type"]);
  assert.equal(event.type, LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA);
});

test("a payload that is not an event, or not this build's, is discarded", () => {
  assert.equal(parseLiveServerEvent("{not json"), undefined);
  assert.equal(parseLiveServerEvent(JSON.stringify([1, 2])), undefined);
  assert.equal(parseLiveServerEvent({ type: "transport.ringing", event_id: "e" }), undefined);
  assert.equal(parseLiveServerEvent({ type: LIVE_SERVER_EVENT.SESSION_STARTED }), undefined);
  assert.deepEqual(decodeLivePayload('{"type":"info"}'), { type: "info" });
});

test("every server event this build parses is one the vocabulary names", () => {
  const payloads: readonly UnparsedWireValue[] = [
    { type: LIVE_SERVER_EVENT.SESSION_STARTED, event_id: "e", session: { id: "live_1" } },
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "e", client_event_id: "m-1" },
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "e" },
    { type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED, event_id: "e", start_ms: 0, end_ms: 1 },
    { type: LIVE_SERVER_EVENT.THINKING_APPENDED, event_id: "e", start_ms: 0, end_ms: 1 },
    {
      type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
      event_id: "e",
      delta: "a",
      start_ms: 0,
      end_ms: 1,
    },
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAA" },
    { type: LIVE_SERVER_EVENT.INFO, event_id: "e", code: "data_channel_permissions", message: "" },
  ];
  const parsedTypes = payloads.map((payload) => parseLiveServerEvent(payload)?.type);

  for (const type of parsedTypes) {
    assert.ok(type !== undefined);
    assert.ok(SERVER_EVENT_TYPES.includes(type));
  }
});

test("the renderer's channel may send the microphone switch and the close, and nothing that appends", () => {
  assert.deepEqual(RENDERER_CLIENT_EVENTS, [
    LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    LIVE_CLIENT_EVENT.CLOSE,
  ]);
  for (const type of RENDERER_CLIENT_EVENTS) assert.ok(CLIENT_EVENT_TYPES.includes(type));
});

test("the renderer's channel is shown captions and lifecycle, never delegations or reflected audio", () => {
  const shown = RENDERER_SERVER_EVENTS.map((selector) => selector.type);
  for (const type of shown) assert.ok(SERVER_EVENT_TYPES.includes(type));
  assert.equal(new Set(shown).size, shown.length);
  assert.equal(shown.includes(LIVE_SERVER_EVENT.DELEGATION_CREATED), false);
  assert.equal(shown.includes(LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND), false);
  assert.equal(shown.includes(LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA), false);
  assert.equal(shown.includes(LIVE_SERVER_EVENT.COMMENTARY_APPENDED), false);
  assert.ok(shown.includes(LIVE_SERVER_EVENT.SESSION_STARTED));
  assert.ok(shown.includes(LIVE_SERVER_EVENT.SESSION_CLOSED));
  assert.ok(shown.includes(LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA));
  assert.ok(shown.includes(LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA));
  assert.ok(shown.includes(LIVE_SERVER_EVENT.ERROR));
});

test("an exchange is live while the session comes up, the developer is heard, or Luke speaks, and while a press waits on its session", () => {
  const active = Object.values(LIVE_STATUS).filter((voiceStatus) =>
    liveExchangeActive({ voiceStatus, talkOpening: false }),
  );
  assert.deepEqual(active, [LIVE_STATUS.CONNECTING, LIVE_STATUS.LISTENING, LIVE_STATUS.SPEAKING]);
  assert.equal(liveExchangeActive({ voiceStatus: LIVE_STATUS.MUTED, talkOpening: true }), true);
});
