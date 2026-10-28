import type { PageLine } from "@luke/features/page-wire";
import { useEffect, useRef, useState } from "react";
import type { SidePanelControl, SidePanelTab } from "./use-side-panel.js";

/**
 * use-panel-arrivals.ts -- shows the side panel's tab for each page Luke shows on the open task's call.
 *
 * Luke tells the developer what he showed is on screen as he does it, so
 * each arrival shows its tab: the panel opens where it was hidden,
 * the tab is chosen where another was, and it opens again where the
 * developer closed it (`use-side-panel.ts`). Full screen is left as it is,
 * and nothing here moves focus.
 *
 * An arrival is live, while the developer is on the task: a page the call
 * did not start with, or a newer version of one it did, since pages are
 * read only while a call stands, and its tab is shown over any other that
 * arrived with it, the other reading in semibold until it is shown. A
 * fixture run draws staged tasks and has nothing arriving.
 */

/** What the open task held when this visit first read it, and has read since. */
interface Visit {
  taskId: string;
  /** The newest version of each page read as the call stands, by page id, or none while no call does. */
  pages: Map<string, number> | undefined;
}

/** The tabs with an arrival not yet shown, and the task they arrived on. */
interface Unread {
  taskId: string | undefined;
  tabs: readonly SidePanelTab[];
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

/** The unread tabs with one more, the task's alone: another task's news is not this one's. */
function withUnread(was: Unread, taskId: string, tab: SidePanelTab): Unread {
  if (was.taskId !== taskId) return { taskId, tabs: [tab] };
  return was.tabs.includes(tab) ? was : { taskId, tabs: [...was.tabs, tab] };
}

/**
 * Shows the tab of each page Luke puts on the open task, and
 * answers the tabs whose arrival came while another arrival's tab was shown.
 */
export function usePanelArrivals(input: {
  /** The open task, or none where nothing may arrive: no task open, or a fixture run's staged one. */
  taskId: string | undefined;
  /** The plan's pages, or nothing while no call about it stands, since a page shown on a call is what arrives. */
  pages: readonly PageLine[] | undefined;
  panel: SidePanelControl;
}): readonly SidePanelTab[] {
  const { taskId, pages, panel } = input;
  const visit = useRef<Visit | undefined>(undefined);
  const [unread, setUnread] = useState<Unread>({ taskId: undefined, tabs: [] });

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
    if (visit.current?.taskId !== taskId) visit.current = { taskId, pages: undefined };
    const seen = visit.current;
    const arrived: SidePanelTab[] = [];
    // A call's first read is what the task already held, and a call ended
    // reads its successor's afresh.
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
  }, [taskId, pages, panel.onChoose]);

  if (unread.taskId !== taskId) return [];
  return unread.tabs.filter((tab) => tab !== shownTab);
}
