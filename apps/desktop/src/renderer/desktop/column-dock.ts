/**
 * column-dock.ts -- how tall the dock at the foot of the column under the folded sidebar's call card stands, said where the card reads it.
 */

import { type RefObject, useLayoutEffect } from "react";

/** What docks at a column's foot: an agent's to-do list and composer, and a plan's call bar, whichever stand. */
const DOCKED = ".agent-todos-dock, .agent-composer, .desktop-call-bar";

/** The card that floats over the column while the sidebar is folded. */
const FLOATING_CARD = '.call-card[data-surface="floating"]';

/** From the column's foot to the top of its highest docked part, or nothing where none stands. */
function dockHeight(column: Element): number {
  const foot = column.getBoundingClientRect().bottom;
  let top = foot;
  for (const part of column.querySelectorAll(DOCKED)) {
    top = Math.min(top, part.getBoundingClientRect().top);
  }
  return Math.max(0, foot - top);
}

/**
 * Keeps two lengths on the shell for the folded sidebar's call card: the
 * dock of the column it stands over (`--column-dock`), which it stands just
 * above, and its own height (`--floating-card`), which the transcript under
 * it keeps clear. The column is the plan's, or the side panel while it fills
 * the window. One ResizeObserver follows the column, its docked parts, and
 * the card; a MutationObserver re-reads when a part arrives or goes, a to-do
 * list appearing over the composer. `key` names what the shell is drawing,
 * so a page or a panel coming and going finds its column afresh. A shell
 * with no such column (Settings, a version history) says no dock at all.
 */
export function useColumnDock(
  shell: RefObject<HTMLElement | null>,
  panelFull: boolean,
  key: string,
): void {
  useLayoutEffect(() => {
    const host = shell.current;
    if (host === null) return;
    const column = host.querySelector(panelFull ? ".side-panel" : ".desktop-plan-main");
    const sized = new ResizeObserver(() => write());
    function write(): void {
      if (host === null) return;
      if (column === null) host.style.removeProperty("--column-dock");
      else host.style.setProperty("--column-dock", `${dockHeight(column)}px`);
      const card = host.querySelector(FLOATING_CARD);
      if (card === null) host.style.removeProperty("--floating-card");
      else host.style.setProperty("--floating-card", `${card.getBoundingClientRect().height}px`);
    }
    function follow(): void {
      if (host === null) return;
      sized.disconnect();
      if (column !== null) {
        sized.observe(column);
        for (const part of column.querySelectorAll(DOCKED)) sized.observe(part);
      }
      const card = host.querySelector(FLOATING_CARD);
      if (card !== null) sized.observe(card);
    }
    const arrived = new MutationObserver(() => {
      follow();
      write();
    });
    if (column !== null) arrived.observe(column, { childList: true, subtree: true });
    arrived.observe(host, { childList: true });
    follow();
    write();
    return () => {
      sized.disconnect();
      arrived.disconnect();
      host.style.removeProperty("--column-dock");
      host.style.removeProperty("--floating-card");
    };
  }, [shell, panelFull, key]);
}
