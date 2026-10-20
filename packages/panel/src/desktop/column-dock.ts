/**
 * column-dock.ts -- how tall the dock at the foot of a column stands, said where what floats over that foot reads it: the folded sidebar's call card, and on a phone the toasts and the captions.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list, pull request row, and composer, and a task's call bar, whichever stand. */
const DOCKED = ".agent-todos-dock, .agent-published-dock, .agent-composer, .desktop-call-bar";

/**
 * A chat's composer at its foot, never a thread's reply box, which scrolls
 * with the messages. It docks only where it spans under what floats: in a
 * narrow room, or in the side panel filling the window. Beside the work on
 * the Chat page the card stands over the rail, never over the composer.
 */
const CHAT_DOCKED = '.chat-composer[data-compact="false"]';

/** The length the dock's height is written in. */
const COLUMN_DOCK = "--column-dock";

/** The card that floats over the column while the sidebar is folded. */
const FLOATING_CARD = '.call-card[data-surface="floating"]';

/** From the column's foot to the top of its highest docked part, or nothing where none stands. */
function dockHeight(column: Element, docked: string): number {
  const foot = column.getBoundingClientRect().bottom;
  let top = foot;
  for (const part of column.querySelectorAll(docked)) {
    const box = part.getBoundingClientRect();
    // A part in a pane a narrow room hides draws no box, and docks nothing.
    if (box.width === 0 && box.height === 0) continue;
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
      : `.desktop-task-main, .agent-page${narrow ? ", .chat-view" : ""}`;
    const docked = panelFull || narrow ? `${DOCKED}, ${CHAT_DOCKED}` : DOCKED;
    let column = host.querySelector(columnSelector);
    const sized = new ResizeObserver(() => write());
    function write(): void {
      if (host === null) return;
      if (column === null) root.style.removeProperty(COLUMN_DOCK);
      else root.style.setProperty(COLUMN_DOCK, `${dockHeight(column, docked)}px`);
      const card = host.querySelector(FLOATING_CARD);
      if (card === null) host.style.removeProperty("--floating-card");
      else host.style.setProperty("--floating-card", `${card.getBoundingClientRect().height}px`);
    }
    function follow(): void {
      if (host === null) return;
      sized.disconnect();
      if (column !== null) {
        sized.observe(column);
        for (const part of column.querySelectorAll(docked)) sized.observe(part);
      }
      const card = host.querySelector(FLOATING_CARD);
      if (card !== null) sized.observe(card);
    }
    const arrived = new MutationObserver(() => {
      column = host.querySelector(columnSelector);
      follow();
      write();
    });
    arrived.observe(host, { childList: true, subtree: true });
    follow();
    write();
    return () => {
      sized.disconnect();
      arrived.disconnect();
      root.style.removeProperty(COLUMN_DOCK);
      host.style.removeProperty("--floating-card");
    };
  }, [shell, panelFull, narrow, key]);
}
