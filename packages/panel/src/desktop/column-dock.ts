/**
 * column-dock.ts -- how tall the dock at the foot of a column stands, said where what floats over that foot reads it: the folded sidebar's call card, the toasts, and the voice's notice line; and how much of the window's foot the toasts take, which a page's scroll leaves room for.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list, pull request row, and composer, and a call's video, whichever stand. */
const DOCKED =
  ".agent-todos-dock, .agent-published-dock, .agent-composer:not(.chat-composer), .agent-call-foot";

/**
 * A chat's composer at its foot, never a thread's reply box, which scrolls
 * with the messages. It docks wherever it spans under what floats: in a
 * narrow room and in the side panel filling the window always, and beside
 * the work on the Chat page only where it reaches under the floating card,
 * as it does past a rail drawn narrower than the card. Over a rail as wide,
 * the card stands over the rail's rows and rises for nothing.
 */
const CHAT_DOCKED = '.chat-composer[data-compact="false"]';

/** Where the floating card stands across the window, or a span nothing meets where no card floats. */
function cardSpan(card: Element | null): DOMRect {
  return card === null ? DOMRect.fromRect({ x: -1, width: 0 }) : card.getBoundingClientRect();
}

/** The length the dock's height is written in. */
const COLUMN_DOCK = "--luke-column-dock";

/** The card that floats over the column while the sidebar is folded. */
const FLOATING_CARD = '.call-card[data-surface="floating"]';

/** The length the floating card's own height is written in. */
const FLOATING_CARD_HEIGHT = "--floating-card";

/** The window's toasts, portalled out of the shell to the document's body (`@luke/ui`'s `ToastStack`). */
const TOAST_STACK = ".luke-toast-stack";

/** The length the dock under the toasts is written in, beside the work, where they stand in the window's corner rather than across a column. */
const TOAST_DOCK = "--luke-toast-dock";

/** The length the toasts standing take of the window's foot is written in, which a page's scroll leaves free at its end. */
const TOAST_ROOM = "--luke-toast-room";

/** The token the toasts' corner stands in from the window's by. */
const CORNER_STEP = "--luke-space-16";

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
function dockHeight(column: Element, docked: string, card: DOMRect | undefined): number {
  const span = column.getBoundingClientRect();
  const foot = span.bottom;
  let top = foot;
  for (const part of column.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    if (!seen(part, box, span)) continue;
    // Where only the card reads the dock, a chat's composer beside it docks nothing.
    const beside = card !== undefined && (box.left >= card.right || box.right <= card.left);
    if (beside && part.matches(CHAT_DOCKED)) continue;
    top = Math.min(top, box.top);
  }
  return Math.max(0, foot - top);
}

/** The toasts' step in from the window's corner, read from its token on the document's root, or none where it is unset. */
function cornerStep(root: HTMLElement): number {
  const step = Number.parseFloat(getComputedStyle(root).getPropertyValue(CORNER_STEP));
  return Number.isNaN(step) ? 0 : step;
}

/**
 * From the window's foot to the top of the highest docked part on screen
 * under the toasts' corner, or nothing where none stands there. A part
 * counts only once one under the corner reaches into where the toasts rest
 * (their height and the corner's step up from the window's foot): a draft
 * reply that flows at a short thread's end, well above the foot, leaves
 * them in their corner, over the empty room below it.
 */
function toastDockHeight(shell: Element, docked: string, stack: DOMRect, step: number): number {
  const foot = shell.getBoundingClientRect().bottom;
  const resting = foot - step - stack.height;
  let top = foot;
  let reached = false;
  for (const part of shell.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    if (!seen(part, box)) continue;
    if (box.left >= stack.right || box.right <= stack.left) continue;
    reached ||= box.bottom > resting;
    top = Math.min(top, box.top);
  }
  return reached ? Math.max(0, foot - top) : 0;
}

/**
 * Keeps two lengths for the folded sidebar's call card: the dock of the
 * column it stands over (`--luke-column-dock`), which it stands just above, and
 * its own height (`--floating-card`), which the transcript under it keeps
 * clear. The dock is written on the document's root, because the toasts,
 * which a phone stands above it too, are portalled out of the shell; the
 * card's height on the shell. The column is the task's, or an agent's page
 * standing in its place, or the Chat page in a narrow room, or the side
 * panel while it fills the window, where a chat's composer docks too
 * (`CHAT_DOCKED`); of those found, the first on screen, and of its docked
 * parts, those on screen, so a pane or a panel on its way out lifts nothing.
 *
 * The toasts stand in the window's corner, over whichever column reaches
 * it, so they read a dock of their own too (`--luke-toast-dock`): the
 * docked parts on screen under their corner, whatever column holds them, a
 * draft reply at the foot of an Inbox thread among them. In any room, how much of the window's foot the
 * standing toasts take (`--luke-toast-room`) is written too, which a page's
 * scroll leaves free at its end, so its last row can always be scrolled
 * clear of them.
 *
 * One ResizeObserver follows the column, the docked parts, the card, and
 * the toasts; a scroll anywhere under the shell re-reads, since it moves a
 * part that flows with what it scrolls; a MutationObserver re-reads when the column or a part arrives
 * or goes, a task's column once it has loaded, a to-do list appearing over
 * the composer. `key` names what the shell is drawing,
 * so a page or a panel coming and going finds its column afresh. A shell
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
  narrow: boolean,
  key: string,
): void {
  useLayoutEffect(() => {
    const host = shell.current;
    if (host === null) return;
    const root = host.ownerDocument.documentElement;
    // Found afresh on every change under the shell, because a task still
    // loading draws its column only once its document lands.
    const columnSelector = panelFull
      ? ".side-panel"
      : ".desktop-task-main, .agent-page, .chat-view";
    const docked = `${DOCKED}, ${CHAT_DOCKED}`;
    // Beside the work only the card reads the dock, so a chat's composer docks only under it.
    const besideCard = !panelFull && !narrow;
    let column = shownColumn(host, columnSelector);
    // What the observer follows, so a change that leaves them standing follows nothing anew.
    let followed: readonly Element[] = [];
    const sized = new ResizeObserver(() => write());
    function write(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const under = besideCard ? cardSpan(card) : undefined;
      writeLength(
        root,
        COLUMN_DOCK,
        column === null ? undefined : `${dockHeight(column, docked, under)}px`,
      );
      writeLength(
        host,
        FLOATING_CARD_HEIGHT,
        card === null ? undefined : `${card.getBoundingClientRect().height}px`,
      );
      const stack = root.querySelector(TOAST_STACK);
      writeLength(
        root,
        TOAST_DOCK,
        stack === null
          ? undefined
          : `${toastDockHeight(host, docked, stack.getBoundingClientRect(), cornerStep(root))}px`,
      );
      // Note that the room is read once the dock above is written, since the dock moves the stack.
      const standing = stack?.getBoundingClientRect();
      writeLength(
        root,
        TOAST_ROOM,
        standing === undefined || standing.height === 0
          ? undefined
          : `${Math.max(0, host.getBoundingClientRect().bottom - standing.top)}px`,
      );
    }
    function follow(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const stack = root.querySelector(TOAST_STACK);
      // The toasts read docked parts in any column, so each is followed.
      const elsewhere = [...host.querySelectorAll(docked)].filter(
        (part) => !column?.contains(part),
      );
      const standing = [
        ...(column === null ? [] : [column, ...column.querySelectorAll(docked)]),
        ...elsewhere,
        ...(card === null ? [] : [card]),
        ...(stack === null ? [] : [stack]),
      ];
      if (sameElements(standing, followed)) return;
      followed = standing;
      sized.disconnect();
      for (const element of standing) sized.observe(element);
    }
    let frame: number | undefined;
    function measure(): void {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        column = shownColumn(host, columnSelector);
        follow();
        write();
      });
    }
    const arrived = new MutationObserver(measure);
    arrived.observe(host, { childList: true, subtree: true });
    // Note that a scroll moves a part that flows with what it scrolls, an Inbox reply box, under the toasts, and neither observer sees it.
    host.addEventListener("scroll", measure, { capture: true, passive: true });
    follow();
    write();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      sized.disconnect();
      arrived.disconnect();
      host.removeEventListener("scroll", measure, { capture: true });
      root.style.removeProperty(COLUMN_DOCK);
      root.style.removeProperty(TOAST_DOCK);
      root.style.removeProperty(TOAST_ROOM);
      host.style.removeProperty(FLOATING_CARD_HEIGHT);
    };
  }, [shell, panelFull, narrow, key]);
}
