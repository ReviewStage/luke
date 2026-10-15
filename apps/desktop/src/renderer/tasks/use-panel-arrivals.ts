import type { Board } from "@luke/features/board-wire";
import type { PageLine } from "@luke/features/page-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { useEffect, useRef, useState } from "react";
import { SIDE_PANEL_TAB, type SidePanelControl, type SidePanelTab } from "./use-side-panel";

/**
 * use-panel-arrivals.ts -- shows the side panel's tab for each drawing Luke puts on the open plan's board, and each snippet and page he shows on its call.
 *
 * Luke tells the developer what he drew or showed is on screen as he does
 * it, so each arrival shows its tab: the panel opens where it was hidden,
 * the tab is chosen where another was, and it opens again where the
 * developer closed it (`use-side-panel.ts`). Full screen is left as it is,
 * and nothing here moves focus.
 *
 * An arrival is live, while the developer is on the plan: a drawing of
 * Luke's numbered past the one the visit first read, or a snippet the call
 * did not start with. The developer's own strokes number no drawing, so
 * they arrive nothing. A plan opened with a drawing or code already on it
 * has nothing arriving; what it holds counts as seen. The code last shown
 * stays on the plan past its call, so code is read only while a call
 * stands, and what a call starts with is what the plan already held. Two
 * arriving on one read show the code, Luke's latest pointing, and the
 * board's tab reads in semibold until it is shown. A page arrives on a call
 * the same way, as a page the call did not start with or a newer version of
 * one it did, and its tab is shown over any other that arrived with it. A fixture run draws
 * staged plans and has nothing arriving.
 */

/** What the open plan held when this visit first read it, and has read since. */
interface Visit {
  taskId: string;
  /** The number of Luke's latest drawing read, 0 before any, or none before the board is read. */
  drawing: number | undefined;
  /** The snippets on screen as the call stands, by call id, or none while no call does. */
  code: Set<string> | undefined;
  /** The newest version of each page read as the call stands, by page id, or none while no call does. */
  pages: Map<string, number> | undefined;
}

/** The tabs with an arrival not yet shown, and the plan they arrived on. */
interface Unread {
  taskId: string | undefined;
  tabs: readonly SidePanelTab[];
}

/** The number of Luke's latest drawing, 0 where he has drawn nothing, whether or not the scene holds it yet. */
function lukeDrawing(board: Board): number {
  return (board.drawing?.elements.length ?? 0) > 0 ? (board.drawing?.number ?? 0) : 0;
}

/** Whether any snippet is one the visit has not read, reading each as it goes. */
function readNewCode(read: Set<string>, code: readonly TaskCodeShowing[]): boolean {
  let fresh = false;
  for (const showing of code) {
    if (read.has(showing.callId)) continue;
    read.add(showing.callId);
    fresh = true;
  }
  return fresh;
}

/** The newest page the visit has not read at the version listed, reading each as it goes; the list is newest written first. */
function readNewPage(read: Map<string, number>, pages: readonly PageLine[]): string | undefined {
  let fresh: string | undefined;
  for (const page of pages) {
    if ((read.get(page.id) ?? 0) >= page.version) continue;
    read.set(page.id, page.version);
    fresh ??= page.id;
  }
  return fresh;
}

/** The unread tabs with one more, the plan's alone: another plan's news is not this one's. */
function withUnread(was: Unread, taskId: string, tab: SidePanelTab): Unread {
  if (was.taskId !== taskId) return { taskId, tabs: [tab] };
  return was.tabs.includes(tab) ? was : { taskId, tabs: [...was.tabs, tab] };
}

/**
 * Shows the tab of each drawing and snippet Luke puts on the open plan, and
 * answers the tabs whose arrival came while another arrival's tab was shown.
 */
export function usePanelArrivals(input: {
  /** The open plan, or none where nothing may arrive: no plan open, or a fixture run's staged one. */
  taskId: string | undefined;
  board: Board | undefined;
  /** The code shown on the plan, or nothing while no call about it stands, since only a call shows code. */
  code: readonly TaskCodeShowing[] | undefined;
  /** The plan's pages, or nothing while no call about it stands, since a page shown on a call is what arrives. */
  pages: readonly PageLine[] | undefined;
  panel: SidePanelControl;
}): readonly SidePanelTab[] {
  const { taskId, code, pages, panel } = input;
  const visit = useRef<Visit | undefined>(undefined);
  const [unread, setUnread] = useState<Unread>({ taskId: undefined, tabs: [] });
  // Note that a board not yet read is unknown rather than empty, because the
  // read landing is the plan opening, not anything Luke drew.
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
    // Note that a plan left ends its visit, because the plan opened again
    // is read again, and what it holds by then was drawn while it was away.
    if (taskId === undefined) {
      visit.current = undefined;
      return;
    }
    if (visit.current?.taskId !== taskId)
      visit.current = { taskId, drawing: undefined, code: undefined, pages: undefined };
    const seen = visit.current;
    const arrived: SidePanelTab[] = [];
    // The first read of the board is what the plan already held.
    if (drawing !== undefined) {
      if (seen.drawing !== undefined && drawing > seen.drawing) arrived.push(SIDE_PANEL_TAB.BOARD);
      seen.drawing = Math.max(seen.drawing ?? 0, drawing);
    }
    // A call's first read is what the plan already held, and a call ended
    // reads its successor's afresh.
    if (code === undefined) seen.code = undefined;
    else if (seen.code === undefined) seen.code = new Set(code.map((showing) => showing.callId));
    else if (readNewCode(seen.code, code)) arrived.push(SIDE_PANEL_TAB.CODE);
    if (pages === undefined) seen.pages = undefined;
    else if (seen.pages === undefined)
      seen.pages = new Map(pages.map((page) => [page.id, page.version]));
    else {
      const page = readNewPage(seen.pages, pages);
      if (page !== undefined) arrived.push({ page });
    }
    const shown = arrived.at(-1);
    if (shown === undefined) return;
    panel.onChoose(shown);
    for (const tab of arrived) {
      if (tab !== shown) setUnread((was) => withUnread(was, taskId, tab));
    }
  }, [taskId, drawing, code, pages, panel.onChoose]);

  if (unread.taskId !== taskId) return [];
  return unread.tabs.filter((tab) => tab !== shownTab);
}
