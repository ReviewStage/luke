/**
 * terminal-keys.ts -- which key presses in a terminal are the shell's, which are the window's, and the few a Mac terminal turns into a shell's own keys.
 *
 * Every Command chord is the window's, as a Mac terminal's are: the window's
 * keymap answers the ones a control offers (⌘K the palette, ⌘F find, ⌘W the
 * tab), and the menu bar the rest (⌘C and ⌘V through Edit's own items, which
 * the terminal hears as a copy and a paste). Three Command chords no command
 * takes are the line-editing keys of every Mac terminal, as VS Code's sends
 * them: ⌘← and ⌘→ to the line's start and end, and ⌘⌫ to delete back to it.
 * Shift+Return sends a line feed rather than Return's carriage return, which
 * a coding agent's prompt reads as a new line within the message rather than
 * as sending it. Everything else, Escape and Control chords included, is the
 * shell's, and Option types the character the keyboard layout gives it.
 */

/** Where a key press goes. */
export const TERMINAL_KEY = {
  /** To the terminal, which encodes it for the shell. */
  SHELL: "shell",
  /** Past the terminal to the window, its keymap and its menu bar. */
  WINDOW: "window",
  /** To the shell as these characters, in place of the key. */
  SEND: "send",
} as const;

export type TerminalKey =
  | { readonly kind: typeof TERMINAL_KEY.SHELL }
  | { readonly kind: typeof TERMINAL_KEY.WINDOW }
  | { readonly kind: typeof TERMINAL_KEY.SEND; readonly data: string };

/** The control characters a Mac terminal's own Command keys send, as readline reads them. */
const LINE_KEYS: ReadonlyMap<string, string> = new Map([
  ["ArrowLeft", "\x01"],
  ["ArrowRight", "\x05"],
  ["Backspace", "\x15"],
]);

/** A line feed, which Shift+Return sends in place of Return's carriage return. */
const LINE_FEED = "\n";

/** Whether the press holds no modifier but those named. */
function holdsOnly(event: KeyboardEvent, held: { meta?: true; shift?: true }): boolean {
  return (
    event.metaKey === (held.meta === true) &&
    event.shiftKey === (held.shift === true) &&
    !event.ctrlKey &&
    !event.altKey
  );
}

/** Where a key press in a terminal goes. */
export function terminalKey(event: KeyboardEvent): TerminalKey {
  if (event.key === "Enter" && holdsOnly(event, { shift: true })) {
    return { kind: TERMINAL_KEY.SEND, data: LINE_FEED };
  }
  const line = LINE_KEYS.get(event.key);
  if (line !== undefined && holdsOnly(event, { meta: true })) {
    return { kind: TERMINAL_KEY.SEND, data: line };
  }
  if (event.metaKey) return { kind: TERMINAL_KEY.WINDOW };
  return { kind: TERMINAL_KEY.SHELL };
}
