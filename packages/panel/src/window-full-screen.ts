/**
 * window-full-screen.ts -- whether the window stands in full screen, told to the CSS, so the title bar's buttons take the place of the traffic lights macOS hides there.
 *
 * Main says it among this window's own facts (`AppWindowFacts`), as the
 * window goes into full screen and comes out. The root wears it, as it wears
 * the zoom (`window-zoom.ts`), because desktop.css derives every inset that
 * clears the traffic lights from the one length on the root, and an
 * attribute lower down could not move a length the root already computed.
 */

import { useLayoutEffect } from "react";

/** The attribute desktop.css moves the title bar's buttons to the window's edge under. */
const FULL_SCREEN_ATTRIBUTE = "data-full-screen";

/** Keeps the document's root saying whether the window stands in full screen, `undefined` until the window's facts have arrived. */
export function useWindowFullScreen(fullScreen: boolean | undefined): void {
  // A layout effect, so the title bar is laid out at its new place in the
  // same frame the window first draws in full screen.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (fullScreen === true) root.setAttribute(FULL_SCREEN_ATTRIBUTE, "true");
    else root.removeAttribute(FULL_SCREEN_ATTRIBUTE);
  }, [fullScreen]);
}
