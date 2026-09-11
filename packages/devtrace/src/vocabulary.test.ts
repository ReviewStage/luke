import assert from "node:assert/strict";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "@sidecar/live";
import { test } from "vitest";
import {
  isAgentWireTrace,
  sanitizedTraceEvent,
  TRACE_DIRECTION,
  TRACE_LIVE_EVENT,
} from "./vocabulary.js";

test("isAgentWireTrace accepts a tapped event and refuses anything else", () => {
  assert.equal(
    isAgentWireTrace({
      direction: TRACE_DIRECTION.CLIENT,
      event: { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE },
    }),
    true,
  );
  assert.equal(
    isAgentWireTrace({
      direction: TRACE_DIRECTION.SERVER,
      event: { type: LIVE_SERVER_EVENT.SESSION_STARTED },
    }),
    true,
  );
  assert.equal(isAgentWireTrace({ direction: "sideways", event: {} }), false);
  assert.equal(isAgentWireTrace({ direction: TRACE_DIRECTION.CLIENT, event: "text" }), false);
  assert.equal(isAgentWireTrace({ direction: TRACE_DIRECTION.CLIENT }), false);
  assert.equal(isAgentWireTrace("trace"), false);
  assert.equal(isAgentWireTrace(undefined), false);
});

test("the traced live events are live events", () => {
  const liveEvents: readonly string[] = [
    ...Object.values(LIVE_SERVER_EVENT),
    ...Object.values(LIVE_CLIENT_EVENT),
  ];
  for (const type of Object.values(TRACE_LIVE_EVENT)) {
    assert.equal(liveEvents.includes(type), true);
  }
});

test("sanitizedTraceEvent replaces reflected audio with its byte count, on either speaker's event", () => {
  assert.deepEqual(
    sanitizedTraceEvent({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAAAAA=" }),
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audioBytes: 5 },
  );
  assert.deepEqual(
    sanitizedTraceEvent({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" }),
    { type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, audioBytes: 3 },
  );
});

test("sanitizedTraceEvent leaves every other event exactly as it went over the wire", () => {
  const event = {
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    delta: "hello",
    start_ms: 0,
    end_ms: 400,
  };
  assert.equal(sanitizedTraceEvent(event), event);
});
