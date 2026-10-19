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
 */

import { visibleViewport } from "@luke/ui/visible-viewport";
import { useLayoutEffect } from "react";

/** How far down the layout viewport the visible part begins, as a phone pans it to a focused field. */
const VIEWPORT_TOP = "--luke-viewport-top";
/** The visible height, in CSS pixels. */
const STAGE_HEIGHT = "--luke-stage-height";
/** How much of the layout viewport stands below the visible part: the keyboard's height while it is up. */
const KEYBOARD_INSET = "--luke-keyboard-inset";

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
    const write = () => {
      // A panned viewport (`offsetTop`) is seen, not covered: what stands
      // above it is the top's, and only what stands below its foot is the
      // keyboard's.
      const seen = visibleViewport();
      const inset = Math.max(0, window.innerHeight - seen.bottom);
      root.setProperty(VIEWPORT_TOP, `${seen.top}px`);
      root.setProperty(STAGE_HEIGHT, `${seen.bottom - seen.top}px`);
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
