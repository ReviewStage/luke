/**
 * column-dock.ts -- how tall the dock at the foot of a column stands, said where the folded sidebar's call card, which floats over that foot, reads it.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list, pull request row, and composer, whichever stand. */
const DOCKED = ".agent-todos-dock, .agent-published-dock, .agent-composer";

/** The length the dock's height is written in. */
const COLUMN_DOCK = "--luke-column-dock";

/** The card that floats over the column while the sidebar is folded. */
const FLOATING_CARD = '.call-card[data-surface="floating"]';

/** The length the floating card's own height is written in. */
const FLOATING_CARD_HEIGHT = "--floating-card";

/** Writes `length` on `element` as `value`, or takes it away where there is none, touching the style only when it changes. */
function writeLength(element: HTMLElement, length: string, value: string | undefined): void {
  const was = element.style.getPropertyValue(length);
  if (value === undefined) {
    if (was !== "") element.style.removeProperty(length);
    return;
  }
  if (was !== value) element.style.setProperty(length, value);
}

/** Whether two lists hold the same elements in the same order. */
function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

/**
 * Whether `element` is on screen at `box`: it draws a box, across `within`'s
 * own span where one is given, and stands in no inert subtree, as a pane or
 * a panel on its way out does. Note that a pane a narrow room hides draws no
 * box, and one sliding away stands inert or off its column, so neither docks
 * anything under what floats over the column it left.
 */
function seen(element: Element, box: DOMRect, within?: DOMRect): boolean {
  if (box.width === 0 && box.height === 0) return false;
  if (within !== undefined && (box.right <= within.left || box.left >= within.right)) return false;
  return element.closest("[inert]") === null;
}

/** The first of the columns `selector` finds under `host` that is on screen, or none. */
function shownColumn(host: Element, selector: string): Element | null {
  for (const column of host.querySelectorAll(selector))
    if (seen(column, column.getBoundingClientRect())) return column;
  return null;
}

/** From the column's foot to the top of its highest docked part on screen, or nothing where none stands. */
function dockHeight(column: Element, docked: string): number {
  const span = column.getBoundingClientRect();
  const foot = span.bottom;
  let top = foot;
  for (const part of column.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    if (!seen(part, box, span)) continue;
    top = Math.min(top, box.top);
  }
  return Math.max(0, foot - top);
}

/**
 * Keeps two lengths for the folded sidebar's call card: the dock of the
 * column it stands over (`--luke-column-dock`), which it stands just above, and
 * its own height (`--floating-card`), which the transcript under it keeps
 * clear. The dock is written on the document's root, the card's height on
 * the shell. The column is the task's, or an agent's page
 * standing in its place, or the side panel while it fills the window; of
 * those found, the first on screen, and of its docked
 * parts, those on screen, so a pane or a panel on its way out lifts nothing.
 *
 * One ResizeObserver follows the column, its docked parts, and the card;
 * a MutationObserver re-reads when the column or a part arrives or goes, a
 * task's column once it has loaded, a to-do list appearing over the
 * composer. `key` names what the shell is drawing, so a page or a panel coming and going finds its column afresh. A shell
 * with no such column (Settings, a version history) says no dock at all.
 *
 * Note that every change under the shell (a transcript's message landing, a
 * hover card) wakes the MutationObserver, and each measure lays out the whole
 * window, so the changes of one frame are read once, at that frame, the
 * column and its parts followed afresh only where they are others than were
 * followed; and that a length is written only when it changes, since a
 * length on the document's root restyles every element under it.
 */
export function useColumnDock(
  shell: RefObject<HTMLElement | null>,
  panelFull: boolean,
  key: string,
): void {
  useLayoutEffect(() => {
    const host = shell.current;
    if (host === null) return;
    const root = host.ownerDocument.documentElement;
    // Found afresh on every change under the shell, because a task still
    // loading draws its column only once its document lands.
    const columnSelector = panelFull ? ".side-panel" : ".desktop-task-main, .agent-page";
    let column = shownColumn(host, columnSelector);
    // What the observer follows, so a change that leaves them standing follows nothing anew.
    let followed: readonly Element[] = [];
    const sized = new ResizeObserver(() => write());
    function write(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const dock = column === null ? undefined : dockHeight(column, DOCKED);
      writeLength(root, COLUMN_DOCK, dock === undefined ? undefined : `${dock}px`);
      writeLength(
        host,
        FLOATING_CARD_HEIGHT,
        card === null ? undefined : `${card.getBoundingClientRect().height}px`,
      );
    }
    function follow(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const standing = [
        ...(column === null ? [] : [column, ...column.querySelectorAll(DOCKED)]),
        ...(card === null ? [] : [card]),
      ];
      if (sameElements(standing, followed)) return;
      followed = standing;
      sized.disconnect();
      for (const element of standing) sized.observe(element);
    }
    let frame: number | undefined;
    function measure(): void {
      if (host === null || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        column = shownColumn(host, columnSelector);
        follow();
        write();
      });
    }
    const arrived = new MutationObserver(measure);
    arrived.observe(host, { childList: true, subtree: true });
    follow();
    write();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      sized.disconnect();
      arrived.disconnect();
      root.style.removeProperty(COLUMN_DOCK);
      host.style.removeProperty(FLOATING_CARD_HEIGHT);
    };
  }, [shell, panelFull, key]);
}
