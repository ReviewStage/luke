/**
 * The key that starts, sends, and interrupts a spoken turn.
 *
 * It is registered with the system rather than with a window, so it answers
 * from whatever app is frontmost. That is also why it is chosen carefully: a
 * global shortcut takes its key away from every other app on the machine.
 */

/**
 * Tried in order when the user has not chosen one.
 *
 * Option-Space is where a macOS user reaches for a voice assistant —
 * Superwhisper, the ChatGPT desktop app and Alfred all sit there. Option-S is
 * Wispr Flow's default, and is the fallback for a machine where something
 * already owns Option-Space.
 */
export const DEFAULT_VOICE_HOTKEYS: readonly string[] = ["Alt+Space", "Alt+S"];

/**
 * The talk key a panel should show.
 *
 * Two things can say what the key is, and neither is reliably first. The helper
 * that registers it answers over its own stdout, which happens while the
 * renderer is still loading — so that message is sent to a window with nothing
 * listening yet and is simply gone. Bootstrap is the one the renderer asks for,
 * so it always arrives; a later change is what supersedes it, and that only
 * happens if the helper stops answering and the toggle takes over.
 *
 * Reading them in this order rather than seeding state from bootstrap is what
 * makes a lost message cost nothing.
 */
export function voiceHotkeyToShow(
  bootstrap: { voiceHotkey?: string; voiceHotkeyHeld: boolean },
  changed?: { hotkey?: string; held: boolean },
): { hotkey?: string; held: boolean } {
  if (changed) return changed;
  return {
    ...(bootstrap.voiceHotkey ? { hotkey: bootstrap.voiceHotkey } : {}),
    held: bootstrap.voiceHotkeyHeld,
  };
}

/**
 * Longer than a key is down when it was pressed rather than held.
 *
 * Under this, the press and the release are one gesture and mean one thing;
 * over it, the key was being held and the release is the end of what was said.
 * Too low and a deliberate quick answer is cut off mid-word; too high and a tap
 * feels like it did nothing for a quarter of a second. This is roughly where
 * the tools that do both put it.
 */
export const TALK_KEY_TAP_MS = 250;

/**
 * What a release of the talk key does to the turn it opened.
 *
 * Holding is the plain case: the turn lasts exactly as long as the key is down,
 * which is what makes it feel like a walkie-talkie and what stops a turn
 * outliving the finger that started it. A tap is for the question too long to
 * hold through — it leaves the turn open, and the next press ends it.
 */
export const TALK_KEY_RELEASE = {
  SEND: "send",
  LATCH: "latch",
} as const;

export type TalkKeyRelease = (typeof TALK_KEY_RELEASE)[keyof typeof TALK_KEY_RELEASE];

/**
 * Reads a release. `latched` is whether this key had already been tapped once
 * and left a turn open: the release that ends a latched turn sends it however
 * briefly it was held, because the gesture that opened the turn is over and
 * this press is a second one.
 */
export function talkKeyRelease(input: { heldMs: number; latched: boolean }): TalkKeyRelease {
  if (input.latched) return TALK_KEY_RELEASE.SEND;
  return input.heldMs < TALK_KEY_TAP_MS ? TALK_KEY_RELEASE.LATCH : TALK_KEY_RELEASE.SEND;
}

const MODIFIER_SYMBOLS: Readonly<Record<string, string>> = {
  Command: "⌘",
  CommandOrControl: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

/** Renders an accelerator the way macOS writes it, for the panel to show. */
export function voiceHotkeyLabel(accelerator: string): string {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts
    .slice(0, -1)
    .map((modifier) => MODIFIER_SYMBOLS[modifier] ?? `${modifier}+`)
    .join("");
  return `${modifiers}${key}`;
}

/**
 * Why there is no talk key. Each of these is a different thing to go and do
 * about it, so a startup line that names the wrong one sends the reader after
 * a conflict that was never there.
 */
export const VOICE_HOTKEY_ABSENCE = {
  /** A capture run drives the panel itself and must not grab a system key. */
  CAPTURE_RUN: "capture-run",
  /** No credential, so there is nothing to talk to and no key worth taking. */
  NO_CREDENTIAL: "no-credential",
  /** Every candidate was refused: something else on the machine has them. */
  ALREADY_OWNED: "already-owned",
} as const;

export type VoiceHotkeyAbsence = (typeof VOICE_HOTKEY_ABSENCE)[keyof typeof VOICE_HOTKEY_ABSENCE];

const ABSENCE_REASONS: Readonly<Record<VoiceHotkeyAbsence, string>> = {
  [VOICE_HOTKEY_ABSENCE.CAPTURE_RUN]: "not registered during a capture run",
  [VOICE_HOTKEY_ABSENCE.NO_CREDENTIAL]: "voice is off, so no key was claimed",
  [VOICE_HOTKEY_ABSENCE.ALREADY_OWNED]: "another app already owns it",
};

/** The startup line stating which key talks to Luke, or why none does. */
export function voiceHotkeyReport(hotkey: string | undefined, absence: VoiceHotkeyAbsence): string {
  if (hotkey) return `Luke talk key: ${voiceHotkeyLabel(hotkey)}`;
  return `Luke talk key: unavailable — ${ABSENCE_REASONS[absence]}`;
}
