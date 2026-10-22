/**
 * visible-viewport.ts -- the part of the window that can be seen, in the window's own coordinates, for a layer placed in script to clamp and turn within.
 *
 * `window.innerHeight` is the layout viewport, which on a phone runs on
 * under the on-screen keyboard; the visual viewport is what is actually
 * seen, and a phone may pan it down the layout viewport to a focused field.
 * A menu, a hint, or a popover measured by the first opens behind the
 * keyboard, so each is measured by this instead. Its edges are in the same
 * coordinates `getBoundingClientRect` and a `position: fixed` box speak.
 * Where there is no visual viewport it is the window, as before; on the
 * desktop, with no keyboard, the visual viewport is the window, so nothing
 * there moves.
 */

/** A rectangle's edges, in CSS pixels from the layout viewport's top-left. */
export interface ViewportBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** The visible part of the window now: the visual viewport where there is one, otherwise the window. */
export function visibleViewport(): ViewportBox {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) {
    return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }
  return {
    top: viewport.offsetTop,
    bottom: viewport.offsetTop + viewport.height,
    left: viewport.offsetLeft,
    right: viewport.offsetLeft + viewport.width,
  };
}
