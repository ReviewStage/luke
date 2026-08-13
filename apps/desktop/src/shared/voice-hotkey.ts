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
