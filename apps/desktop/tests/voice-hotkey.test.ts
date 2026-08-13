import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VOICE_HOTKEYS,
  TALK_KEY_RELEASE,
  TALK_KEY_TAP_MS,
  talkKeyRelease,
  VOICE_HOTKEY_ABSENCE,
  voiceHotkeyLabel,
  voiceHotkeyReport,
} from "../src/shared/voice-hotkey";

test("the default is the chord a macOS voice assistant is reached for", () => {
  // Option-Space is where Superwhisper, the ChatGPT desktop app and Alfred sit;
  // Option-S is Wispr Flow's default, for a machine where the first is taken.
  assert.deepEqual(DEFAULT_VOICE_HOTKEYS, ["Alt+Space", "Alt+S"]);
});

test("an accelerator reads the way macOS writes it", () => {
  assert.equal(voiceHotkeyLabel("Alt+Space"), "⌥Space");
  assert.equal(voiceHotkeyLabel("Alt+S"), "⌥S");
  assert.equal(voiceHotkeyLabel("Command+Shift+K"), "⌘⇧K");
});

test("a missing talk key says which absence it is", () => {
  assert.equal(
    voiceHotkeyReport("Alt+Space", VOICE_HOTKEY_ABSENCE.ALREADY_OWNED),
    "Luke talk key: ⌥Space",
  );

  // Blaming a conflict for an absence nobody attempted sends the reader off to
  // hunt for the app that stole the key, when no key was ever asked for.
  const withoutCredential = voiceHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.NO_CREDENTIAL);
  assert.match(withoutCredential, /voice is off/);
  assert.ok(!withoutCredential.includes("another app"));

  assert.match(
    voiceHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.ALREADY_OWNED),
    /another app already owns it/,
  );
  assert.match(voiceHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.CAPTURE_RUN), /capture run/);
});

test("holding sends on release and tapping leaves the turn open", () => {
  // Held: the turn lasted exactly as long as the key was down.
  assert.equal(
    talkKeyRelease({ heldMs: TALK_KEY_TAP_MS + 1, latched: false }),
    TALK_KEY_RELEASE.SEND,
  );
  assert.equal(talkKeyRelease({ heldMs: 4_000, latched: false }), TALK_KEY_RELEASE.SEND);

  // Tapped: for the question too long to hold through.
  assert.equal(talkKeyRelease({ heldMs: 40, latched: false }), TALK_KEY_RELEASE.LATCH);
  assert.equal(talkKeyRelease({ heldMs: 0, latched: false }), TALK_KEY_RELEASE.LATCH);
});

test("a latched turn is ended by the next release, however brief", () => {
  // The gesture that opened this turn is already over. A second tap is someone
  // saying they are done, and holding the key down to say it would be a turn
  // that never ends.
  assert.equal(talkKeyRelease({ heldMs: 10, latched: true }), TALK_KEY_RELEASE.SEND);
  assert.equal(talkKeyRelease({ heldMs: 4_000, latched: true }), TALK_KEY_RELEASE.SEND);
});
