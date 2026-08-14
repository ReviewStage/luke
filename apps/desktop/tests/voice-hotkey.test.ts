import assert from "node:assert/strict";
import test from "node:test";
import {
  capturedVoiceHotkey,
  DEFAULT_VOICE_HOTKEYS,
  parseVoiceHotkey,
  TALK_KEY_RELEASE,
  TALK_KEY_TAP_MS,
  talkKeyRelease,
  VOICE_HOTKEY_ABSENCE,
  VOICE_HOTKEY_CAPTURE,
  voiceHotkeyCandidates,
  voiceHotkeyLabel,
  voiceHotkeyReport,
  voiceHotkeyToShow,
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

test("a chord is read into one canonical spelling", () => {
  // Whatever a caller writes, one spelling comes out: aliases folded, the key
  // cased the way the defaults are, modifiers in the order macOS prints them.
  assert.equal(parseVoiceHotkey("Alt+Space"), "Alt+Space");
  assert.equal(parseVoiceHotkey("option+space"), "Alt+Space");
  assert.equal(parseVoiceHotkey("CommandOrControl+SHIFT+k"), "Shift+Command+K");
  assert.equal(parseVoiceHotkey("Command+Ctrl+a"), "Control+Command+A");
  // Naming a modifier twice under two aliases is still one modifier held.
  assert.equal(parseVoiceHotkey("Alt+Option+S"), "Alt+S");
});

test("a chord the helper cannot register is refused rather than guessed at", () => {
  // A bare key would take plain typing away from every app on the machine.
  assert.equal(parseVoiceHotkey("Space"), undefined);
  assert.equal(parseVoiceHotkey("K"), undefined);
  // A bare modifier cannot be a Carbon hot key at all.
  assert.equal(parseVoiceHotkey("Alt"), undefined);
  // Shift alone is a bare key in disguise: Shift+S is how capitals are typed,
  // and Shift+Space lands mid-sentence. Shift may only join a heavier chord.
  assert.equal(parseVoiceHotkey("Shift+S"), undefined);
  assert.equal(parseVoiceHotkey("Shift+Space"), undefined);
  assert.equal(parseVoiceHotkey("Shift+Command+S"), "Shift+Command+S");
  // Keys outside the helper's table: digits, function keys, two keys at once.
  assert.equal(parseVoiceHotkey("Alt+1"), undefined);
  assert.equal(parseVoiceHotkey("Alt+F5"), undefined);
  assert.equal(parseVoiceHotkey("Alt+A+B"), undefined);
  assert.equal(parseVoiceHotkey(""), undefined);
});

test("a chosen chord is tried first and the defaults stay behind it", () => {
  assert.deepEqual(voiceHotkeyCandidates(undefined), DEFAULT_VOICE_HOTKEYS);
  assert.deepEqual(voiceHotkeyCandidates("Command+L"), ["Command+L", "Alt+Space", "Alt+S"]);
  // Choosing a default outright must not ask the system for it twice.
  assert.deepEqual(voiceHotkeyCandidates("Alt+S"), ["Alt+S", "Alt+Space"]);
});

test("a keystroke is read as a chord from the physical key", () => {
  const chord = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  // `code` rather than `key`: Option moves letters on macOS, and Option-S is
  // the chord being recorded even while the event says `ß`.
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "KeyS", altKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.CAPTURED,
    accelerator: "Alt+S",
  });
  assert.deepEqual(
    capturedVoiceHotkey({ ...chord, code: "Space", metaKey: true, shiftKey: true }),
    {
      outcome: VOICE_HOTKEY_CAPTURE.CAPTURED,
      accelerator: "Shift+Command+Space",
    },
  );

  // A modifier going down on its own is a chord still being formed.
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "AltLeft", altKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.PENDING,
  });
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "MetaRight", metaKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.PENDING,
  });

  // A bare key, or one outside the helper's table, is an answer — a wrong one.
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "KeyS" }), {
    outcome: VOICE_HOTKEY_CAPTURE.REFUSED,
  });
  // So is a key Shift alone is holding: recording it would fire the talk key
  // on every capital S typed anywhere.
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "KeyS", shiftKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.REFUSED,
  });
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "Digit1", altKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.REFUSED,
  });
  assert.deepEqual(capturedVoiceHotkey({ ...chord, code: "Enter", metaKey: true }), {
    outcome: VOICE_HOTKEY_CAPTURE.REFUSED,
  });
});

test("a recorded chord and a stored one pass the same gate", () => {
  // What recording produces is what parsing accepts, spelled identically —
  // otherwise a chord could be registered today and dropped on next launch.
  const recorded = capturedVoiceHotkey({
    code: "KeyK",
    altKey: false,
    ctrlKey: true,
    metaKey: true,
    shiftKey: false,
  });
  assert.equal(recorded.outcome, VOICE_HOTKEY_CAPTURE.CAPTURED);
  if (recorded.outcome === VOICE_HOTKEY_CAPTURE.CAPTURED) {
    assert.equal(parseVoiceHotkey(recorded.accelerator), recorded.accelerator);
  }
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
