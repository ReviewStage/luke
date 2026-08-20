import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/realtime";
import { askRefusal } from "./ask-luke";

test("a refused ask is diagnosed from how far the voice loop got", () => {
  // Voice off is the one refusal with a fix the developer can go and do, so
  // it names where the fix lives — and both ways in, because naming only the
  // key would send a signed-in developer to buy one they do not need.
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE), /Sign in/);
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE), /OpenAI key/);
  assert.match(askRefusal(REALTIME_STATUS.UNAVAILABLE), /Settings/);
  // An open microphone is the developer's own turn, not a fault.
  assert.match(askRefusal(REALTIME_STATUS.LISTENING), /microphone is open/i);
  assert.match(askRefusal(REALTIME_STATUS.CONNECTING), /connecting/i);
  // The failure's own message lands on the caption strip directly below the
  // field, so this one sends nobody to a settings page.
  assert.doesNotMatch(askRefusal(REALTIME_STATUS.FAILED), /Settings/);
});

test("no refusal sends a typed ask after the microphone permission", () => {
  // Typing opens no capture device and the reply arrives on the call's
  // receiving half, so a typed ask goes whether or not the system would let
  // a press capture. The one microphone sentence left is the developer's own
  // open turn, which is a turn under way, not a permission.
  for (const status of Object.values(REALTIME_STATUS)) {
    if (status === REALTIME_STATUS.LISTENING) continue;
    assert.doesNotMatch(askRefusal(status), /microphone/i);
    assert.doesNotMatch(askRefusal(status), /allow/i);
  }
});

test("a spent free day is named as itself, never as a missing way in", () => {
  // A signed-in account whose allowance is used up needs neither a key nor a
  // sign-in, it needs tomorrow — sent to Settings, the spent day reads as a
  // breakage. The sentence is the caller's, minted from the voice service's
  // own diagnostics, so the field and the settings meters tell one story.
  const spent = "Today's voice is spent. Back at 5:00 PM.";
  assert.equal(askRefusal(REALTIME_STATUS.UNAVAILABLE, spent), spent);
  // The spent sentence stands in only for unavailability — every other
  // refusal keeps its own diagnosis.
  assert.match(askRefusal(REALTIME_STATUS.LISTENING, spent), /microphone is open/i);
});

test("a failure the loop cannot name still answers with something to do", () => {
  assert.ok(askRefusal(REALTIME_STATUS.READY).length > 0);
});
