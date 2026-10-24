/**
 * drawn-in.ts -- whether the stylesheet draws a part of a view, and whether a pane's tab has no room for it beside the work, read again as the view is resized.
 *
 * Which place a pane stands in, beside its tab or over it, is the
 * stylesheet's to say, by the panel's width (`@container side-panel`) and
 * the shell's room (`data-room`): it draws the toggle for the place the pane
 * can stand and hides the other. The view reads that answer back off its
 * toggle, so the width that moves the pane and the width that moves the
 * toggle are one.
 */

import { useLayoutEffect, useState } from "react";

/** Whether an element of the view is drawn, which is the stylesheet's to say. */
export function drawnIn(view: Element | null, selector: string): boolean {
  const element = view?.querySelector(selector);
  return element !== null && element !== undefined && getComputedStyle(element).display !== "none";
}

/**
 * Whether the pane's tab has no room for it beside the work, read again
 * whenever the view's box changes size: the stylesheet draws the toggle that
 * floats it, `over`, and not the one that docks it, `beside`. Note that both
 * are drawn where no stylesheet says otherwise, which stands the pane beside.
 */
export function useFloatsOver(view: Element | null, over: string, beside: string): boolean {
  const [floats, setFloats] = useState(false);
  useLayoutEffect(() => {
    if (view === null) return undefined;
    const read = () => setFloats(drawnIn(view, over) && !drawnIn(view, beside));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(view);
    return () => observer.disconnect();
  }, [view, over, beside]);
  return floats;
}
