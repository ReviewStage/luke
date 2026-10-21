/**
 * column-dock.ts -- how tall the dock at the foot of a column stands, said where what floats over that foot reads it: the folded sidebar's call card, and on a phone the toasts and the voice's notice line.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list, pull request row, and composer, and a call's video, whichever stand. */
const DOCKED = ".agent-todos-dock, .agent-published-dock, .agent-composer, .agent-call-foot";

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
const COLUMN_DOCK = "--column-dock";

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

/** From the column's foot to the top of its highest docked part, or nothing where none stands. */
function dockHeight(column: Element, docked: string, card: DOMRect | undefined): number {
  const foot = column.getBoundingClientRect().bottom;
  let top = foot;
  for (const part of column.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    // A part in a pane a narrow room hides draws no box, and docks nothing.
    if (box.width === 0 && box.height === 0) continue;
    // Where only the card reads the dock, a chat's composer beside it docks nothing.
    const beside = card !== undefined && (box.left >= card.right || box.right <= card.left);
    if (beside && part.matches(CHAT_DOCKED)) continue;
    top = Math.min(top, box.top);
  }
  return Math.max(0, foot - top);
}

/**
 * Keeps two lengths for the folded sidebar's call card: the dock of the
 * column it stands over (`--column-dock`), which it stands just above, and
 * its own height (`--floating-card`), which the transcript under it keeps
 * clear. The dock is written on the document's root, because the toasts,
 * which a phone stands above it too, are portalled out of the shell; the
 * card's height on the shell. The column is the task's, or an agent's page standing in
 * its place, or the Chat page in a narrow room, or the side panel while it
 * fills the window, where a chat's composer docks too (`CHAT_DOCKED`). One ResizeObserver follows the column, its docked parts, and
 * the card; a MutationObserver re-reads when the column or a part arrives
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
    let column = host.querySelector(columnSelector);
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
    }
    function follow(): void {
      if (host === null) return;
      const card = host.querySelector(FLOATING_CARD);
      const standing = [
        ...(column === null ? [] : [column, ...column.querySelectorAll(docked)]),
        ...(card === null ? [] : [card]),
      ];
      if (sameElements(standing, followed)) return;
      followed = standing;
      sized.disconnect();
      for (const element of standing) sized.observe(element);
    }
    let frame: number | undefined;
    const arrived = new MutationObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        column = host.querySelector(columnSelector);
        follow();
        write();
      });
    });
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
  }, [shell, panelFull, narrow, key]);
}
