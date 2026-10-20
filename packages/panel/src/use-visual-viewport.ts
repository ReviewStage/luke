/**
 * use-visual-viewport.ts -- how much of the window can be seen, written on the root for the layout that must stay above a phone's toolbars and keyboard.
 *
 * A `vh` is the layout viewport's height, which on a phone stands behind its
 * browser toolbars and, while it is up, the on-screen keyboard; `dvh` follows
 * the toolbars but never the keyboard. The visual viewport is the part that
 * is actually seen, so the panel writes where it begins, its height, and the
 * keyboard's height below it over `@luke/ui`'s `--luke-viewport-top`,
 * `--luke-stage-height`, and `--luke-keyboard-inset`,
 * and the stage, the palette, the dialogs, and the viewers are measured by
 * those. They are written on the document's root rather than the stage,
 * because a dialog is drawn over `document.body`, outside the stage, and must
 * read them too. Where there is no visual viewport nothing is written, and
 * the tokens' own `100vh` and no inset stand.
 *
 * A pinch-zoom shrinks the visual viewport too, and pans it as the finger
 * moves, but covers nothing: the page is only drawn larger. So the stage is
 * measured by the zoomed box only while the page is drawn at its own scale.
 * Zoomed in, its top stands where it was, and only the keyboard is read, from
 * the box as it would stand unzoomed (its height times the scale): a phone
 * that opens its keyboard on a field while zoomed, or zooms in on one as it
 * focuses it, still lifts the composer, while the pinch and the pan alone
 * leave the layout as it was rather than re-laying it into the zoomed box.
 */

import { visibleViewport } from "@luke/ui/visible-viewport";
import { useLayoutEffect } from "react";

/** How far down the layout viewport the visible part begins, as a phone pans it to a focused field. */
const VIEWPORT_TOP = "--luke-viewport-top";
/** The visible height, in CSS pixels. */
const STAGE_HEIGHT = "--luke-stage-height";
/** How much of the layout viewport stands below the visible part: the keyboard's height while it is up. */
const KEYBOARD_INSET = "--luke-keyboard-inset";

/** How far from 1 a visual viewport's scale may stand and still be the page at its own scale, for a phone's rounding. */
const UNZOOMED_TOLERANCE = 0.01;

/** Whether the page is drawn at its own scale rather than pinch-zoomed. */
function unzoomed(viewport: VisualViewport): boolean {
  return Math.abs(viewport.scale - 1) <= UNZOOMED_TOLERANCE;
}

/**
 * Writes the visual viewport's height and the keyboard's inset on the root
 * as they change, and takes them away again on unmount. Note that it writes
 * before the window paints, so a phone never draws a frame measured by the
 * tokens' `100vh`, which is taller than what it shows.
 */
export function useVisualViewport(): void {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null || viewport === undefined) return undefined;
    const root = document.documentElement.style;
    /** Where the stage begins, as last measured at the page's own scale. */
    let top = 0;
    const write = () => {
      let bottom: number;
      if (unzoomed(viewport)) {
        // A panned viewport (`offsetTop`) is seen, not covered: what stands
        // above it is the top's, and only what stands below its foot is the
        // keyboard's.
        const seen = visibleViewport();
        top = seen.top;
        bottom = seen.bottom;
      } else {
        // Note that rounding keeps a pinch's fractions from moving the stage by a pixel.
        bottom = Math.min(window.innerHeight, top + Math.round(viewport.height * viewport.scale));
      }
      const inset = Math.max(0, window.innerHeight - bottom);
      root.setProperty(VIEWPORT_TOP, `${top}px`);
      root.setProperty(STAGE_HEIGHT, `${bottom - top}px`);
      root.setProperty(KEYBOARD_INSET, `${inset}px`);
    };
    write();
    viewport.addEventListener("resize", write);
    viewport.addEventListener("scroll", write);
    return () => {
      viewport.removeEventListener("resize", write);
      viewport.removeEventListener("scroll", write);
      root.removeProperty(VIEWPORT_TOP);
      root.removeProperty(STAGE_HEIGHT);
      root.removeProperty(KEYBOARD_INSET);
    };
  }, []);
}
