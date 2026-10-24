/**
 * trapped-tab.ts -- Tab kept among the controls of a box that holds the keyboard: a dialog's card, a pane floating over the work.
 *
 * The box hears Tab as it bubbles and hands it here; past either end the
 * move wraps to the other, so the browser's own move never leaves the box
 * for the window behind it.
 */

import type { KeyboardEvent } from "react";

/**
 * What Tab may land on inside the box: its enabled controls and links, and
 * anything else given a place in the Tab order. Note that one taken out of
 * that order, as a menu's rows are, is dropped by its `tabIndex` rather than
 * here, because any negative value takes it out, and one inside an inert
 * part of the box, a dialog's body while its foot asks, by its ancestor,
 * because the browser will not focus it.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled]):not([hidden])",
  "[tabindex]:not(:disabled)",
].join(", ");

/** Whether `first` comes before `second` in the document's order. */
function precedes(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The move Tab makes from the focused element, kept to the controls of the box that heard it. */
export function trappedTab(event: KeyboardEvent<HTMLElement>): void {
  const box = event.currentTarget;
  const controls = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (control) => control.tabIndex >= 0 && control.closest("[inert]") === null,
  );
  const focused = document.activeElement;
  const at = focused instanceof HTMLElement ? controls.indexOf(focused) : -1;
  // Note that a focus inside the box off its controls, a picker's list that
  // holds the keyboard, moves to the control beside it in the box's order,
  // because counting it as off the controls would send it to an end instead.
  if (at === -1 && focused !== null && focused !== box && box.contains(focused)) {
    const beside = event.shiftKey
      ? controls.findLast((control) => precedes(control, focused))
      : controls.find((control) => precedes(focused, control));
    event.preventDefault();
    (beside ?? (event.shiftKey ? controls.at(-1) : controls[0]))?.focus();
    return;
  }
  // Note that the ends wrap and a focus off the controls (the box itself,
  // while a dialog is at work) comes back onto them, because past either
  // end the browser's own move would leave the box for the window behind it.
  const wraps = event.shiftKey ? at <= 0 : at === -1 || at === controls.length - 1;
  if (!wraps) return;
  event.preventDefault();
  (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
}
