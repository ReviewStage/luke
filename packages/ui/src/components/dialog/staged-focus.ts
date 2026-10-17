import { type RefObject, useEffect } from "react";

/**
 * staged-focus.ts -- focus handed to a dialog's control the moment it can
 * take it, and held while it is for.
 */

/** Long enough for any stage to arrive, and short enough to be a backstop. */
const FOCUS_FRAME_LIMIT = 60;

/**
 * Hands focus to `element` once its surface has finished arriving, and
 * answers the way to stop waiting.
 *
 * Note that a surface an app stages in stands `visibility: hidden` until its
 * arrival delay has passed, and a hidden element refuses focus outright, so
 * this waits frame by frame for the stage rather than guessing at its delay.
 * An element never drawn is given up on quietly, because the alternative is
 * a seek that never stops.
 */
function focusWhenVisible(element: HTMLElement | null): () => void {
  if (!element) return () => undefined;
  let frame = 0;
  let waited = 0;
  const seek = () => {
    if (getComputedStyle(element).visibility === "visible") {
      element.focus({ preventScroll: true });
      return;
    }
    if (waited++ > FOCUS_FRAME_LIMIT) return;
    frame = requestAnimationFrame(seek);
  };
  seek();
  return () => cancelAnimationFrame(frame);
}

/**
 * Keeps focus on an element for as long as holding it is what that element is
 * for.
 *
 * A control that goes disabled hands focus out and does not take it back, so
 * `active` falls while a dialog is at work and rises again with the refusal
 * that re-opens the field, which puts someone straight back to correcting it.
 */
export function useStagedFocus<Element extends HTMLElement>(
  target: RefObject<Element | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    return focusWhenVisible(target.current);
  }, [active, target]);
}
