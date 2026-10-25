/**
 * enter-sends.ts -- whether Enter in a message box sends it, and the label its return key wears saying so.
 *
 * With a mouse, Enter sends and Shift+Enter is a new line. A phone's or a
 * tablet's keyboard has no Shift+Enter to type a line with, so on a coarse
 * pointer Enter is the new line and the box's visible Send sends; ⌘ or Ctrl
 * with Enter, from a keyboard attached to it, still sends. Every box that
 * sends asks here, the composer's editor (`plan-editor/composer-editor.ts`),
 * a pull request's Markdown boxes (`tasks/comment-editor.tsx`), and the plain
 * text areas that stand in for them, so one key does one thing in each. A
 * document's text, a plan's or a pull request's description, is the one
 * place Enter writes and ⌘ or Ctrl with Enter finishes (`modEnterSends`).
 */

import { ENTER_KEY_HINT, type EnterKeyHint, TEXT_AREA_SUBMIT, type TextAreaSubmit } from "@luke/ui";

/** The pointer a phone or a tablet has, a finger. */
const COARSE_POINTER = "(pointer: coarse)";

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

/**
 * Whether a press finishes a document's text, whose bare Enter writes a
 * paragraph: ⌘↩ on a Mac, Ctrl+↩ elsewhere. Note that both are read on every platform,
 * because a Mac's keyboard has a Ctrl and another's attached to it a Meta key,
 * and neither is a chord that does anything else in a box.
 */
export function modEnterSends(press: Pick<EnterPress, "key" | "metaKey" | "ctrlKey">): boolean {
  return press.key === "Enter" && (press.metaKey || press.ctrlKey);
}

/** The return key's label as the pointer stands now. */
export function enterKeyHint(): EnterKeyHint {
  return coarsePointer() ? ENTER_KEY_HINT.NEW_LINE : ENTER_KEY_HINT.SEND;
}

/** The key a plain text area sends on, as `enterSends` reads a press: Return with a mouse, ⌘Return on a finger's keyboard. */
export function enterSubmitKey(): TextAreaSubmit {
  return coarsePointer() ? TEXT_AREA_SUBMIT.MOD_ENTER : TEXT_AREA_SUBMIT.ENTER;
}
