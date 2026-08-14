import assert from "node:assert/strict";
import test from "node:test";
import {
  askHotkeyReport,
  DEFAULT_ASK_HOTKEYS,
  DEFAULT_VOICE_HOTKEYS,
  TALK_KEY_RELEASE,
  TALK_KEY_TAP_MS,
  talkKeyRelease,
  VOICE_HOTKEY_ABSENCE,
  voiceHotkeyLabel,
  voiceHotkeyReport,
  voiceHotkeyToShow,
} from "../src/shared/voice-hotkey";

test("the default is the chord a macOS voice assistant is reached for", () => {
  // Option-Space is where Superwhisper, the ChatGPT desktop app and Alfred sit;
  // Option-S is Wispr Flow's default, for a machine where the first is taken.
  assert.deepEqual(DEFAULT_VOICE_HOTKEYS, ["Alt+Space", "Alt+S"]);
});

test("the ask key is the talk key's sibling, never its rival", () => {
  // One modifier for both halves of the conversation — and Command-L is
  // deliberately not here: globally registered, it would swallow the address
  // bar of every browser on the machine.
  for (const accelerator of DEFAULT_ASK_HOTKEYS) {
    assert.match(accelerator, /^Alt\+/);
    assert.ok(!accelerator.startsWith("Command"));
    assert.ok(!accelerator.startsWith("CommandOrControl"));
  }
  // Two Luke keys must never compete for one chord: whichever registered
  // first would silently cost the other its whole feature.
  for (const accelerator of DEFAULT_ASK_HOTKEYS) {
    assert.ok(!DEFAULT_VOICE_HOTKEYS.includes(accelerator));
  }
});

test("a missing ask key reports on the talk key's terms", () => {
  assert.equal(askHotkeyReport("Alt+L", VOICE_HOTKEY_ABSENCE.ALREADY_OWNED), "Luke ask key: ⌥L");
  assert.match(
    askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.ALREADY_OWNED),
    /another app already owns it/,
  );
  assert.match(askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.CAPTURE_RUN), /capture run/);
  assert.match(askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.NO_CREDENTIAL), /voice is off/);
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

test("the key survives the message that announces it being lost", () => {
  // The helper registers while the renderer is still loading, so the message
  // saying which key it got is sent to a window with nothing listening yet.
  // Bootstrap is the one the renderer asks for, so it is what answers.
  assert.deepEqual(voiceHotkeyToShow({ voiceHotkey: "⌥Space", voiceHotkeyHeld: true }, undefined), {
    hotkey: "⌥Space",
    held: true,
  });

  // A change only arrives when the helper stopped answering and the toggle took
  // over, which is news bootstrap cannot have.
  assert.deepEqual(
    voiceHotkeyToShow(
      { voiceHotkey: "⌥Space", voiceHotkeyHeld: true },
      { hotkey: "⌥S", held: false },
    ),
    { hotkey: "⌥S", held: false },
  );

  // No key anywhere is the only way the panel should read "Unavailable".
  assert.deepEqual(voiceHotkeyToShow({ voiceHotkeyHeld: false }, undefined), { held: false });
  assert.deepEqual(
    voiceHotkeyToShow({ voiceHotkey: "⌥Space", voiceHotkeyHeld: true }, { held: true }),
    {
      held: true,
    },
  );
});
