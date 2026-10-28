import type { Board } from "@luke/features/board-wire";
import { useEffect, useRef, useState } from "react";
import { SIDE_PANEL_TAB, type SidePanelControl, type SidePanelTab } from "./use-side-panel.js";

/**
 * use-panel-arrivals.ts -- shows the side panel's tab for each drawing Luke puts on the open task's board.
 *
 * Luke tells the developer what he drew is on screen as he does it, so
 * each arrival shows its tab: the panel opens where it was hidden,
 * the tab is chosen where another was, and it opens again where the
 * developer closed it (`use-side-panel.ts`). Full screen is left as it is,
 * and nothing here moves focus.
 *
 * An arrival is live, while the developer is on the task: a drawing of
 * Luke's numbered past the one the visit first read. The developer's own
 * strokes number no drawing, so they arrive nothing. A task opened with a
 * drawing already on it has nothing arriving; what it holds counts as seen.
 * A fixture run draws staged tasks and has nothing arriving.
 */

/** What the open task held when this visit first read it, and has read since. */
interface Visit {
  taskId: string;
  /** The number of Luke's latest drawing read, 0 before any, or none before the board is read. */
  drawing: number | undefined;
}

/** The tabs with an arrival not yet shown, and the task they arrived on. */
interface Unread {
  taskId: string | undefined;
  tabs: readonly SidePanelTab[];
}

/** The number of Luke's latest drawing, 0 where he has drawn nothing, whether or not the scene holds it yet. */
function lukeDrawing(board: Board): number {
  return (board.drawing?.elements.length ?? 0) > 0 ? (board.drawing?.number ?? 0) : 0;
}

/** The unread tabs with one more, the task's alone: another task's news is not this one's. */
function withUnread(was: Unread, taskId: string, tab: SidePanelTab): Unread {
  if (was.taskId !== taskId) return { taskId, tabs: [tab] };
  return was.tabs.includes(tab) ? was : { taskId, tabs: [...was.tabs, tab] };
}

/**
 * Shows the tab of each drawing Luke puts on the open task, and
 * answers the tabs whose arrival came while another arrival's tab was shown.
 */
export function usePanelArrivals(input: {
  /** The open task, or none where nothing may arrive: no task open, or a fixture run's staged one. */
  taskId: string | undefined;
  board: Board | undefined;
  panel: SidePanelControl;
}): readonly SidePanelTab[] {
  const { taskId, panel } = input;
  const visit = useRef<Visit | undefined>(undefined);
  const [unread, setUnread] = useState<Unread>({ taskId: undefined, tabs: [] });
  // Note that a board not yet read is unknown rather than empty, because the
  // read landing is the task opening, not anything Luke drew.
  const drawing = input.board === undefined ? undefined : lukeDrawing(input.board);

  // A tab shown is a tab seen. Note that this runs before the arrivals,
  // because a tab the render showed may be one an arrival just moved off.
  const shownTab = panel.open ? panel.tab : undefined;
  useEffect(() => {
    if (shownTab === undefined) return;
    setUnread((was) =>
      was.tabs.includes(shownTab)
        ? { ...was, tabs: was.tabs.filter((tab) => tab !== shownTab) }
        : was,
    );
  }, [shownTab]);

  useEffect(() => {
    // Note that a task left ends its visit, because the task opened again
    // is read again, and what it holds by then was drawn while it was away.
    if (taskId === undefined) {
      visit.current = undefined;
      return;
    }
    if (visit.current?.taskId !== taskId) visit.current = { taskId, drawing: undefined };
    const seen = visit.current;
    const arrived: SidePanelTab[] = [];
    // The first read of the board is what the task already held.
    if (drawing !== undefined) {
      if (seen.drawing !== undefined && drawing > seen.drawing) arrived.push(SIDE_PANEL_TAB.BOARD);
      seen.drawing = Math.max(seen.drawing ?? 0, drawing);
    }
    const shown = arrived.at(-1);
    if (shown === undefined) return;
    panel.onChoose(shown);
    for (const tab of arrived) {
      if (tab !== shown) setUnread((was) => withUnread(was, taskId, tab));
    }
  }, [taskId, drawing, panel.onChoose]);

  if (unread.taskId !== taskId) return [];
  return unread.tabs.filter((tab) => tab !== shownTab);
}
