import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VOICE_HOTKEYS,
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
