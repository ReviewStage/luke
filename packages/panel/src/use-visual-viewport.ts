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
 *
 * The unzoomed reference is the initial containing block, the root's
 * `clientHeight`, which no engine resizes under a pinch (where WebKit's
 * `innerHeight` follows it) and which is the stage's own containing block. A
 * window that shrinks for the keyboard (Android's `resizes-content`) shrinks
 * it too, so no inset is read there; at the page's own scale `innerHeight`
 * stays the reference, as before.
 *
 * iOS Safari opens its keyboard over the page and pans the visual viewport
 * down to the focused field, so the whole page slides up, and a stage that
 * followed the pan slid back down after it; WebKit does not redraw the caret
 * through that move, so it stood a keyboard's height from the words. So at
 * the page's own scale the pan is undone (`scrollTo(0, 0)`): the stage stays
 * at the window's top, ends where the keyboard begins, and the caret of the
 * field focused is scrolled into view within its own column, as a native app
 * keeps it above the keyboard. Where an engine keeps its pan anyway, the
 * stage still follows it, as before. A pinch's pan is the developer's own and
 * is never undone, and a window that shrinks for the keyboard pans nothing.
 * The stage is let down again as the focus leaves the field, ahead of the
 * keyboard's slide away, which WebKit measures only once it has ended.
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

/** How far above the keyboard a focused field's caret is kept, in CSS pixels. */
const CARET_MARGIN = 24;

/** Whether the page is drawn at its own scale rather than pinch-zoomed. */
function unzoomed(viewport: VisualViewport): boolean {
  return Math.abs(viewport.scale - 1) <= UNZOOMED_TOLERANCE;
}

/** The nearest box around `element` that scrolls its content up and down; none where nothing does. */
function scrollerOf(element: Element): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return undefined;
}

/** Where the caret of the focused field stands in the window: the selection's box, or the field's own where the selection draws none. */
function caretBox(field: Element): DOMRect {
  const selection = window.getSelection();
  const range =
    selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  // Note that a range's box is read as possibly missing, since a page with no layout, as a test's is, draws none.
  const measured: Partial<Pick<Range, "getBoundingClientRect">> | undefined = range;
  const box = measured?.getBoundingClientRect?.();
  return box === undefined || (box.top === 0 && box.bottom === 0)
    ? field.getBoundingClientRect()
    : box;
}

/** What a keyboard is raised for: a field words are typed into, not a box, a switch, or a slider. */
const TYPED_FIELD =
  'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"], [type="radio"], [type="range"])';

/** Whether `target` is a field a keyboard is raised for. */
function typedField(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches(TYPED_FIELD));
}

/**
 * The focused field's caret scrolled up into view within its own column,
 * above `bottom`, where the keyboard now covers it; nothing while no field
 * is focused.
 */
function caretAboveKeyboard(bottom: number): void {
  const field = document.activeElement;
  if (!typedField(field)) return;
  const column = scrollerOf(field);
  if (column === undefined) return;
  const below =
    caretBox(field).bottom + CARET_MARGIN - Math.min(bottom, column.getBoundingClientRect().bottom);
  if (below > 0) column.scrollTop += below;
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
    /** How much of the window the keyboard covered as last measured. */
    let covered = 0;
    /**
     * Whether the keyboard is going: the focus left every field it was up
     * for, while the viewport still measures it. Note that the stage is let
     * down at once, because WebKit measures the keyboard gone only once it
     * has slid away (WebKit bug 265578, with Safari's address bar at the
     * bottom), and the stage held short until then trailed it by its whole
     * slide, the room it left standing empty.
     */
    let going = false;
    const write = () => {
      let layout: number;
      let bottom: number;
      if (unzoomed(viewport)) {
        // The keyboard's pan undone, so the stage stays at the window's top.
        if (viewport.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
        // A viewport still panned (`offsetTop`) is seen, not covered: what
        // stands above it is the top's, and only what stands below its foot
        // is the keyboard's.
        const seen = visibleViewport();
        top = seen.top;
        layout = window.innerHeight;
        bottom = seen.bottom;
      } else {
        layout = document.documentElement.clientHeight;
        // Note that rounding keeps a pinch's fractions from moving the stage by a pixel.
        bottom = Math.min(layout, top + Math.round(viewport.height * viewport.scale));
      }
      // The keyboard measured gone, or let go of ahead of it.
      if (going && bottom >= layout) going = false;
      if (going) bottom = layout;
      const inset = Math.max(0, layout - bottom);
      root.setProperty(VIEWPORT_TOP, `${top}px`);
      root.setProperty(STAGE_HEIGHT, `${bottom - top}px`);
      root.setProperty(KEYBOARD_INSET, `${inset}px`);
      // A keyboard that rose, or grew, over the focused field keeps its caret in view.
      if (inset > covered) caretAboveKeyboard(bottom);
      covered = inset;
    };
    // Focus leaving every typed field lets the keyboard go at once; a field taking it measures the keyboard again.
    const left = (event: FocusEvent) => {
      if (covered === 0 || typedField(event.relatedTarget)) return;
      going = true;
      write();
    };
    const entered = (event: FocusEvent) => {
      if (!typedField(event.target)) return;
      going = false;
      write();
    };
    write();
    viewport.addEventListener("resize", write);
    viewport.addEventListener("scroll", write);
    document.addEventListener("focusout", left);
    document.addEventListener("focusin", entered);
    return () => {
      viewport.removeEventListener("resize", write);
      viewport.removeEventListener("scroll", write);
      document.removeEventListener("focusout", left);
      document.removeEventListener("focusin", entered);
      root.removeProperty(VIEWPORT_TOP);
      root.removeProperty(STAGE_HEIGHT);
      root.removeProperty(KEYBOARD_INSET);
    };
  }, []);
}
