import { type RefObject, useEffect } from "react";

/**
 * held-focus.ts -- focus handed to a dialog's control once its card stands,
 * and held while it is for.
 */

/**
 * Keeps focus on an element for as long as holding it is what that element is
 * for.
 *
 * Note that focus is handed over at once, because the card's entrance fades
 * and grows it (`--animate-dialog-in`) and never hides it, so its controls
 * take focus from the render they stand in.
 *
 * A control that goes disabled hands focus out and does not take it back, so
 * `active` falls while a dialog is at work and rises again with the refusal
 * that re-opens the field, which puts someone straight back to correcting it.
 */
export function useHeldFocus<Element extends HTMLElement>(
  target: RefObject<Element | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (active) target.current?.focus({ preventScroll: true });
  }, [active, target]);
}
