import { surfaceKeepsPress } from "@repo/settings/shortcuts";

export const TERMINAL_KEY = {
  SHELL: "shell",
  WINDOW: "window",
  SEND: "send",
} as const;

export type TerminalKey =
  | { readonly kind: typeof TERMINAL_KEY.SHELL }
  | { readonly kind: typeof TERMINAL_KEY.WINDOW }
  | { readonly kind: typeof TERMINAL_KEY.SEND; readonly data: string };

const LINE_KEYS: ReadonlyMap<string, string> = new Map([
  ["ArrowLeft", "\x01"],
  ["ArrowRight", "\x05"],
  ["Backspace", "\x15"],
]);

const LINE_FEED = "\n";

function holdsOnly(event: KeyboardEvent, held: { meta?: true; shift?: true }): boolean {
  return (
    event.metaKey === (held.meta === true) &&
    event.shiftKey === (held.shift === true) &&
    !event.ctrlKey &&
    !event.altKey
  );
}

export function terminalKey(event: KeyboardEvent): TerminalKey {
  if (event.key === "Enter" && holdsOnly(event, { shift: true })) {
    return { kind: TERMINAL_KEY.SEND, data: LINE_FEED };
  }
  const line = LINE_KEYS.get(event.key);
  if (line !== undefined && holdsOnly(event, { meta: true })) {
    return { kind: TERMINAL_KEY.SEND, data: line };
  }
  if (surfaceKeepsPress(event)) return { kind: TERMINAL_KEY.SHELL };
  if (event.metaKey) return { kind: TERMINAL_KEY.WINDOW };
  if (event.key === "Tab" && event.ctrlKey && !event.altKey) return { kind: TERMINAL_KEY.WINDOW };
  return { kind: TERMINAL_KEY.SHELL };
}
