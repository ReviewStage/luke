/**
 * enter-sends.ts -- whether Enter in a message box sends it, and the label its return key wears saying so.
 *
 * With a mouse, Enter sends and Shift+Enter is a new line. A phone's or a
 * tablet's keyboard has no Shift+Enter to type a line with, so on a coarse
 * pointer Enter is the new line and the box's visible Send sends; ⌘ or Ctrl
 * with Enter, from a keyboard attached to it, still sends. Every message box
 * asks here, the editor's (`plan-editor/composer-editor.ts`) and Chat's
 * plain one where the editor could not load, so one key does one thing in
 * each.
 */

/** The pointer a phone or a tablet has, a finger. */
const COARSE_POINTER = "(pointer: coarse)";

/** The label an on-screen keyboard draws on its return key: Send where Enter sends, a return where it is a new line. */
export const ENTER_KEY_HINT = {
  SEND: "send",
  NEW_LINE: "enter",
} as const;

export type EnterKeyHint = (typeof ENTER_KEY_HINT)[keyof typeof ENTER_KEY_HINT];

/** The keys of a press this reads. */
interface EnterPress {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/** Whether the device's pointer is a finger. */
function coarsePointer(): boolean {
  return window.matchMedia(COARSE_POINTER).matches;
}

/** Whether a press is the box's send: Enter without Shift, and on a coarse pointer only with ⌘ or Ctrl. */
export function enterSends(press: EnterPress): boolean {
  if (press.key !== "Enter" || press.shiftKey) return false;
  return press.metaKey || press.ctrlKey || !coarsePointer();
}

/** The return key's label as the pointer stands now. */
export function enterKeyHint(): EnterKeyHint {
  return coarsePointer() ? ENTER_KEY_HINT.NEW_LINE : ENTER_KEY_HINT.SEND;
}
