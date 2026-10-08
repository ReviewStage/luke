import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { Option, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { SIDE_PANEL_TAB, type SidePanelControl, type SidePanelTab } from "./use-side-panel";

/**
 * use-panel-arrivals.ts -- opens the side panel on what Luke first draws on a plan's board or first shows of its code, once per plan and kind, kept across launches.
 *
 * An arrival is live: Luke drawing on the open plan's board where he had
 * not, or code coming on screen where there was none, while the developer
 * is on that plan. The developer's own strokes are not Luke's, so they
 * arrive nothing. A plan opened with Luke's drawing already on its board, or
 * with code already on screen, has nothing arriving; what it holds counts as seen, which is
 * also how a plan drawn on before this existed is read. Each kind arrives
 * once per plan: after that, the panel is the developer's to open, however
 * often Luke redraws and whether or not they closed it.
 *
 * A closed panel opens on the arrival's tab. An open one is left as it is,
 * its tab and full screen included, and the arrival's tab carries a dot
 * until it is shown. Nothing here moves focus.
 *
 * Which plans' arrivals have happened is this window's to remember, so it
 * is kept in the renderer's own storage beside the panel's preference, read
 * and written at the moment of an arrival. A deleted plan's entry is left
 * behind: it is a few bytes, and nothing reads it again. A fixture run draws staged plans
 * and has nothing arriving.
 */

/** The tabs whose first content opens the panel. */
const ARRIVING_TABS = [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE] as const;

type ArrivingTab = (typeof ARRIVING_TABS)[number];

/** Where the plans' arrivals are kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidePanelArrivals";

/** The tabs each plan has had its arrival on, by plan id. */
const storedArrivals = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Array(Schema.Literals(ARRIVING_TABS))),
);

type Arrivals = typeof storedArrivals.Type;

const decodeStored = Schema.decodeUnknownOption(storedArrivals);
const encodeStored = Schema.encodeSync(storedArrivals);

/** What the open plan held of each tab when this visit first read it, and which may still arrive. */
interface Visit {
  planId: string;
  /** The tabs read at least once on this visit. */
  read: Set<ArrivingTab>;
  /** The tabs first read empty on this visit, which arrive once they hold something. */
  waiting: Set<ArrivingTab>;
}

/** The tabs with an arrival not yet shown, and the plan they arrived on. */
interface Unread {
  planId: string | undefined;
  tabs: readonly SidePanelTab[];
}

/** The kept arrivals, or none where none were kept, they no longer read, or storage refuses the read. */
function readArrivals(): Arrivals {
  try {
    return Option.getOrElse(decodeStored(window.localStorage.getItem(STORAGE_KEY)), () => ({}));
  } catch {
    return {};
  }
}

/** Keeps the arrivals; a write that fails costs only a second opening, so it is not worth a word. */
function writeArrivals(arrivals: Arrivals): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStored(arrivals));
  } catch {
    // The panel may open once more for this plan.
  }
}

/** Records the plan's arrival on a tab, answering whether it is the first. */
function recordArrival(planId: string, tab: ArrivingTab): boolean {
  const arrivals = readArrivals();
  const had = arrivals[planId] ?? [];
  if (had.includes(tab)) return false;
  writeArrivals({ ...arrivals, [planId]: [...had, tab] });
  return true;
}

/** Whether Luke has drawn on a board, whether or not its scene holds his drawing yet. */
function lukeDrew(board: Board): boolean {
  return (board.drawing?.elements.length ?? 0) > 0;
}

/** The unread tabs with one more, the plan's alone: another plan's dots are not this one's. */
function withUnread(was: Unread, planId: string, tab: SidePanelTab): Unread {
  if (was.planId !== planId) return { planId, tabs: [tab] };
  return was.tabs.includes(tab) ? was : { planId, tabs: [...was.tabs, tab] };
}

/**
 * Opens the panel on the open plan's first board and first code, and answers
 * the tabs whose arrival came while the open panel showed another.
 */
export function usePanelArrivals(input: {
  /** The open plan, or none where nothing may arrive: no plan open, or a fixture run's staged one. */
  planId: string | undefined;
  board: Board | undefined;
  code: PlanCode | undefined;
  panel: SidePanelControl;
}): readonly SidePanelTab[] {
  const { planId, panel } = input;
  const visit = useRef<Visit | undefined>(undefined);
  const [unread, setUnread] = useState<Unread>({ planId: undefined, tabs: [] });
  // Note that a board not yet read is unknown rather than empty, because the
  // read landing is the plan opening, not anything Luke drew.
  const board = input.board === undefined ? undefined : lukeDrew(input.board);
  const code = input.code !== undefined;

  useEffect(() => {
    // Note that a plan left ends its visit, because the plan opened again
    // is read again, and what it holds by then was drawn while it was away.
    if (planId === undefined) {
      visit.current = undefined;
      return;
    }
    if (visit.current?.planId !== planId)
      visit.current = { planId, read: new Set(), waiting: new Set() };
    const { read, waiting } = visit.current;
    const holds = {
      [SIDE_PANEL_TAB.BOARD]: board,
      [SIDE_PANEL_TAB.CODE]: code,
    } satisfies Record<ArrivingTab, boolean | undefined>;
    for (const tab of ARRIVING_TABS) {
      const held = holds[tab];
      if (held === undefined) continue;
      // The first read of a visit is what the plan already held.
      if (!read.has(tab)) {
        read.add(tab);
        if (held) recordArrival(planId, tab);
        else waiting.add(tab);
        continue;
      }
      if (!held || !waiting.delete(tab) || !recordArrival(planId, tab)) continue;
      if (!panel.open) panel.onChoose(tab);
      else if (panel.tab !== tab) setUnread((was) => withUnread(was, planId, tab));
    }
  }, [planId, board, code, panel.open, panel.tab, panel.onChoose]);

  // A tab shown is a tab seen.
  const shownTab = panel.open ? panel.tab : undefined;
  useEffect(() => {
    if (shownTab === undefined) return;
    setUnread((was) =>
      was.tabs.includes(shownTab)
        ? { ...was, tabs: was.tabs.filter((tab) => tab !== shownTab) }
        : was,
    );
  }, [shownTab]);

  if (unread.planId !== planId) return [];
  return unread.tabs.filter((tab) => tab !== shownTab);
}
