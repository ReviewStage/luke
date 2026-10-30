import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * use-until-found.ts -- what a capped surface folds away stays findable: drawn under `hidden="until-found"`, and opened when a find lands in it.
 *
 * A long code block's rest (`code-card.tsx`) and a card's notes past the
 * first few (`event-notes.tsx`) are still drawn while folded, so a find over
 * the page reaches them, the browser's own and the window's alike
 * (`find-matches.ts`), and the surface opens whole when a match lands there
 * (`beforematch`), as a closed `<details>` opens.
 */

/** The `hidden` a folded rest wears: drawn, and found by a find over the page, but not shown until a match lands in it. */
const UNTIL_FOUND = "until-found";

/** The event a find fires at what `UNTIL_FOUND` hides before it shows a match there. */
const BEFORE_MATCH = "beforematch";

/**
 * The element a surface's folded rest stands in, hidden until found while
 * `hiding`, and `onFound` called when a find lands in it. Note that the
 * attribute is set here rather than as a prop, because React draws `hidden`
 * as a flag and would set it to no value, which hides the rest from every
 * find.
 */
export function useUntilFound<Element extends HTMLElement>(
  hiding: boolean,
  onFound: () => void,
): RefObject<Element | null> {
  const rest = useRef<Element | null>(null);
  const [found] = useState(() => ({ current: onFound }));
  found.current = onFound;
  useLayoutEffect(() => {
    const element = rest.current;
    if (element === null) return;
    if (!hiding) {
      element.removeAttribute("hidden");
      return;
    }
    element.setAttribute("hidden", UNTIL_FOUND);
    const open = () => found.current();
    element.addEventListener(BEFORE_MATCH, open);
    return () => element.removeEventListener(BEFORE_MATCH, open);
  }, [hiding, found]);
  return rest;
}
