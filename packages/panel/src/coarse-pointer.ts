/**
 * coarse-pointer.ts -- whether the window is worked by a finger, where the system draws its own selection menu over words selected.
 *
 * iOS and Android stand their selection toolbar over the words a finger
 * selects, so what the panel offers on a selection, a comment's bubble or
 * Reply, stands under the words there instead, clear of the handle a
 * finger drags. The question is asked as the offer is placed, never kept,
 * because a tablet that takes a keyboard and a trackpad answers otherwise
 * from one moment to the next. What is drawn by it follows it as it
 * changes (`useCoarsePointer`).
 */

import { useEffect, useState } from "react";

/** The media query a finger answers: the device's main pointer is coarse. */
export const COARSE_POINTER = "(pointer: coarse)";

/** Whether the device's main pointer is a finger, now. */
export function coarsePointerNow(): boolean {
  return window.matchMedia(COARSE_POINTER).matches;
}

/** Whether the device's main pointer is a finger, drawn again as that changes: a row a finger cannot drag to is drawn only for a mouse. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointerNow);
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER);
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}
