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
 * Whether a press is the send of a box that sends on ⌘ or Ctrl with Enter and
 * lets a bare Enter add a line, as every pull request and review box does:
 * ⌘↩ on a Mac, Ctrl+↩ elsewhere. Note that both are read on every platform,
 * because a Mac's keyboard has a Ctrl and another's attached to it a Meta key,
 * and neither is a chord that does anything else in a box.
 */
export function modEnterSends(press: Pick<EnterPress, "key" | "metaKey" | "ctrlKey">): boolean {
  return press.key === "Enter" && (press.metaKey || press.ctrlKey);
}

/** Whether a press is the send of a box whose `submit` key is given: Enter as `enterSends` reads it, or ⌘ or Ctrl with Enter as `modEnterSends` does. */
export function submitSends(
  press: EnterPress,
  submit: TextAreaSubmit = TEXT_AREA_SUBMIT.ENTER,
): boolean {
  return submit === TEXT_AREA_SUBMIT.MOD_ENTER ? modEnterSends(press) : enterSends(press);
}

/** The return key's label as the pointer stands now. */
export function enterKeyHint(): EnterKeyHint {
  return coarsePointer() ? ENTER_KEY_HINT.NEW_LINE : ENTER_KEY_HINT.SEND;
}

/** The key a plain text area sends on, as `enterSends` reads a press: Return with a mouse, ⌘Return on a finger's keyboard. */
export function enterSubmitKey(): TextAreaSubmit {
  return coarsePointer() ? TEXT_AREA_SUBMIT.MOD_ENTER : TEXT_AREA_SUBMIT.ENTER;
}
