import { type RefObject, useEffect } from "react";
import { focusSeek } from "./focus-seek";

/**
 * staged-focus.ts -- focus handed to a control the moment it can take it, and held while it is for.
 */

/**
 * Hands focus to an element as soon as it can take it, and answers with the way
 * to stop waiting. An element that is not there at all is given up on at once:
 * the caller already holds it, so no later frame could find a different one.
 */
export function focusWhenVisible(element: HTMLElement | null): () => void {
  if (!element) return () => undefined;
  return focusSeek({
    find: () => element,
    act: (target) => target.focus({ preventScroll: true }),
  });
}

/**
 * Keeps focus on an element for as long as holding it is what that element is
 * for.
 *
 * A control that goes disabled hands focus out and does not take it back, so
 * `active` falls while a note is being sent and rises again with the refusal
 * that re-opens the field — which is what puts someone straight back to
 * correcting it rather than clicking to get there.
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
