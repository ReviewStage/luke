/**
 * window-pointer.ts -- the floating call window's hover, not believed while the window moves under a still pointer.
 */

import { useEffect } from "react";
import { appBridge } from "../app-bridge";

/**
 * A drag region moves the window under the pointer, and the engine keeps the
 * hover the pointer had before, so a button the drag never touched can stay
 * lit after it. While the window is moving the root says the pointer is
 * stale (`data-pointer-stale`), which the stylesheet answers by taking hover
 * from the buttons, until the pointer itself moves again over the page. A
 * drag is the pointer's doing, though a native drag region sends the page no
 * press, so it also ends the keyboard's claim on focus rings: a button the
 * keyboard last reached keeps no ring through a drag.
 */
export function useStaleHoverAfterMove(): void {
  useEffect(() => {
    const root = document.documentElement;
    const stopMoved = appBridge().onCallWindowMoved(() => {
      root.dataset.pointerStale = "true";
      delete root.dataset.keyboard;
    });
    // Note that only a pointer that moved counts, because the engine follows
    // a window's move with a move of its own at the pointer's old place.
    const pointerMoved = (event: PointerEvent) => {
      if (event.movementX !== 0 || event.movementY !== 0) delete root.dataset.pointerStale;
    };
    window.addEventListener("pointermove", pointerMoved, true);
    return () => {
      stopMoved();
      window.removeEventListener("pointermove", pointerMoved, true);
      delete root.dataset.pointerStale;
    };
  }, []);
}
