import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VOICE_HOTKEYS, voiceHotkeyLabel } from "../src/shared/voice-hotkey";

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
