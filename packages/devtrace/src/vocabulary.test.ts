import assert from "node:assert/strict";
import test from "node:test";
import { isAgentWireTrace, sanitizedTraceEvent, TRACE_DIRECTION } from "./vocabulary.js";

test("isAgentWireTrace accepts a tapped event and refuses anything else", () => {
  assert.equal(
    isAgentWireTrace({ direction: TRACE_DIRECTION.CLIENT, event: { type: "response.create" } }),
    true,
  );
  assert.equal(
    isAgentWireTrace({ direction: TRACE_DIRECTION.SERVER, event: { type: "response.done" } }),
    true,
  );
  assert.equal(isAgentWireTrace({ direction: "sideways", event: {} }), false);
  assert.equal(isAgentWireTrace({ direction: TRACE_DIRECTION.CLIENT, event: "text" }), false);
  assert.equal(isAgentWireTrace({ direction: TRACE_DIRECTION.CLIENT }), false);
  assert.equal(isAgentWireTrace("trace"), false);
  assert.equal(isAgentWireTrace(undefined), false);
});

test("sanitizedTraceEvent replaces appended audio with its byte count", () => {
  const sanitized = sanitizedTraceEvent({
    type: "input_audio_buffer.append",
    audio: "AAAAAAA=",
  });
  assert.deepEqual(sanitized, { type: "input_audio_buffer.append", audioBytes: 5 });
});

test("sanitizedTraceEvent leaves every other event exactly as it went over the wire", () => {
  const event = {
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
  };
  assert.equal(sanitizedTraceEvent(event), event);
});
