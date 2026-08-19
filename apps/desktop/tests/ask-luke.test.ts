import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/core";
import { askRefusal } from "../src/renderer/ask-luke";

test("a refused ask is diagnosed from how far the voice loop got", () => {
  // Voice off is the one refusal with a fix the developer can go and do, so
  // it names where the fix lives — and both ways in, because naming only the
  // key would send a signed-in developer to buy one they do not need.
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE, "granted"), /Sign in/);
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE, "granted"), /OpenAI key/);
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE, "granted"), /Settings/);
  // An open microphone is the developer's own turn, not a fault.
  assert.match(askRefusal(REALTIME_STATUS.LISTENING, "granted"), /microphone is open/i);
  assert.match(askRefusal(REALTIME_STATUS.CONNECTING, "granted"), /connecting/i);
  // The failure's own message lands on the caption strip directly below the
  // field, so this one sends nobody to a settings page.
  assert.doesNotMatch(askRefusal(REALTIME_STATUS.FAILED, "granted"), /Settings/);
});

test("a missing microphone explains the conversation, not the keystroke", () => {
  // The reply is spoken, so the call needs the device even though typing does
  // not — the sentence has to say why a text field wants a microphone.
  for (const microphone of ["denied", "restricted", "not-determined", "unknown"] as const) {
    const refusal = askRefusal(REALTIME_STATUS.IDLE, microphone);
    assert.match(refusal, /microphone/i);
    assert.match(refusal, /out loud/i);
  }
});

test("a failure the loop cannot name still answers with something to do", () => {
  assert.ok(askRefusal(REALTIME_STATUS.READY, "granted").length > 0);
});
