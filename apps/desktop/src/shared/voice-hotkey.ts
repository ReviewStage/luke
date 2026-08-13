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
