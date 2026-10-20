/**
 * narrow-focus.ts -- keeps the keyboard's and a screen reader's place as a narrow room swaps a screen's list for the item chosen in it, and back.
 *
 * A narrow room shows Settings', a version history's, and Chat's list or
 * the item chosen in it one at a time (`hiddenColumns`), so the press that
 * chose a row hides the column holding it, and the focus falls to the page's
 * body with it. This hook hands it on: as the item comes to stand, to the
 * first control in its column, the way back to the list each screen leads
 * it with, or its heading; and as the list comes back, to the row chosen in
 * it, which the list marks `aria-current`. Only a focus the swap took away
 * is handed on, never one standing somewhere still shown, such as a field
 * the step to the list was taken for. A wide room shows both columns, hides
 * neither, and is left alone.
 *
 * The screen's list is its root's `<nav>` and the item its `<section>`,
 * as all three draw them.
 */

import { type RefObject, useLayoutEffect, useRef } from "react";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";

/** What takes a press of Tab, in the order it is reached. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The row a list marks as the one chosen. */
const CHOSEN = '[aria-current]:not([aria-current="false"])';

/** The first element in `column` a selector names that is not behind an `inert` pane, as the version list's is while a revision's sections stand. */
function firstIn(column: HTMLElement, selector: string): HTMLElement | undefined {
  return [...column.querySelectorAll<HTMLElement>(selector)].find(
    (each) => each.closest("[inert]") === null,
  );
}

/** The column's heading, made able to take the focus it is handed, where the column has no control. */
function headingOf(column: HTMLElement): HTMLElement | undefined {
  const heading = firstIn(column, "h1, h2");
  if (heading !== undefined && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

/** Whether the focus went with a column just hidden: it stood in it, or has already fallen to the body. */
function focusLost(hidden: HTMLElement): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || hidden.contains(active);
}

/**
 * Hands the focus on as a narrow room swaps the screen between its list and
 * its item, `listed` saying which stands. Returns the ref for the screen's
 * root, the element whose `<nav>` and `<section>` are the two columns.
 */
export function useNarrowFocus(room: ShellRoom, listed: boolean): RefObject<HTMLDivElement | null> {
  const screen = useRef<HTMLDivElement>(null);
  const was = useRef(listed);
  // Note that this runs before paint, so the focus moves before the browser
  // settles a focus left in a hidden column on the body, and before a screen
  // reader is told of the body.
  useLayoutEffect(() => {
    const before = was.current;
    was.current = listed;
    if (before === listed || room !== SHELL_ROOM.NARROW) return;
    const root = screen.current;
    const list = root?.querySelector<HTMLElement>(":scope > nav");
    const item = root?.querySelector<HTMLElement>(":scope > section");
    if (list === null || list === undefined || item === null || item === undefined) return;
    if (!focusLost(listed ? item : list)) return;
    const target = listed
      ? (firstIn(list, CHOSEN) ?? firstIn(list, FOCUSABLE))
      : (firstIn(item, FOCUSABLE) ?? headingOf(item));
    target?.focus();
  }, [room, listed]);
  return screen;
}
