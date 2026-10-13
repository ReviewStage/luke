import {
  isAgentTab,
  isChangesTab,
  isFileTab,
  isPageTab,
  isSubagentTab,
  sameTab,
} from "./tab-strip-model";
import { MAIN_TAB, type MainTab } from "./use-main-tabs";
import type { OpenFile, SidePanelTab } from "./use-side-panel";

/**
 * closed-tabs.ts -- the tabs the developer closed, newest last, which ⇧⌘T reopens one at a time where each stood.
 *
 * A tab closed in the plan's column or in its side panel is remembered as
 * where it stood: its plan, its strip, its place there, and a file's tab as
 * it last showed its file, lines lit and history and all. ⇧⌘T takes the
 * newest back, as a browser's Reopen Closed Tab does, and the one before it
 * on the next press. A tab whose subject has gone since, such as an agent
 * archived, a page or a plan deleted, is passed over for the one before it.
 * What still stands is known only of the open plan, so a tab of another
 * plan is reopened by opening that plan first and asking again once its
 * reads land (`closedTabStands`).
 *
 * The list is the window's moment rather than a preference, so it is kept
 * nowhere and held to a bound. A draft agent's tab is not remembered, since
 * closing it lets the draft go, and the plan's own never closes.
 */

/** Which of the plan's two strips a closed tab stood in. */
export const CLOSED_TAB_STRIP = {
  COLUMN: "column",
  PANEL: "panel",
} as const;

/** Where a closed tab stood: its plan, and its place in its strip, the plan's own tab not counted in the column's. */
interface ClosedPlace {
  readonly plan: string;
  readonly at: number;
}

/** A tab closed in the plan's column. */
interface ClosedColumnTab extends ClosedPlace {
  readonly strip: typeof CLOSED_TAB_STRIP.COLUMN;
  readonly tab: MainTab;
}

/** A tab closed in the side panel, and a file's as its tab last showed the file. */
interface ClosedPanelTab extends ClosedPlace {
  readonly strip: typeof CLOSED_TAB_STRIP.PANEL;
  readonly tab: SidePanelTab;
  readonly file?: OpenFile | undefined;
}

/** A tab the developer closed, as ⇧⌘T reopens it. */
export type ClosedTab = ClosedColumnTab | ClosedPanelTab;

/** How many closed tabs are remembered, the newest closed. */
const CLOSED_TABS_KEPT = 20;

/**
 * What the open plan holds that a closed tab may show, each nothing while
 * its read has not landed, so a tab is not passed over before it is known
 * to be gone.
 */
export interface OpenSubjects {
  /** The plan open, none on the new-plan page. */
  readonly planId: string | undefined;
  /** Every plan the account holds, the archived among them. */
  readonly plans: readonly string[] | undefined;
  /** The open plan's agents, an archived one left out. */
  readonly agents: readonly string[] | undefined;
  /** Whether the open plan's Inbox has something to stand on: an agent, archived or not, or an item waiting. */
  readonly inbox: boolean | undefined;
  /** The agents whose tabs stand in the open plan's column, beside which a worker they delegated to is drawn. */
  readonly openAgents: readonly string[] | undefined;
  /** The planning workers the open plan's work holds, by the call that started each. */
  readonly workers: readonly string[] | undefined;
  /** The files Luke showed on the open plan, by path. */
  readonly files: readonly string[] | undefined;
  /** The pages agents wrote for the open plan, by id. */
  readonly pages: readonly string[];
}

/** Whether two closed tabs are the same tab of the same strip of the same plan. */
function sameClosed(a: ClosedTab, b: ClosedTab): boolean {
  return a.plan === b.plan && a.strip === b.strip && sameTab(a.tab, b.tab);
}

/** Whether the subject of a tab closed in the open plan's column stands. */
function columnTabStands(tab: MainTab, open: OpenSubjects): boolean | undefined {
  if (isAgentTab(tab)) return open.agents?.includes(tab.agent);
  return tab === MAIN_TAB.INBOX ? open.inbox : false;
}

/**
 * Whether the subject of a tab closed in the open plan's side panel stands.
 * Note that a file browsed to on the plan stands as any file of its
 * repository may, so only a file Luke showed is looked for among his.
 */
function panelTabStands(closed: ClosedPanelTab, open: OpenSubjects): boolean | undefined {
  const { tab } = closed;
  if (isSubagentTab(tab)) {
    return tab.delegation === undefined
      ? open.workers?.includes(tab.subagent)
      : open.openAgents?.includes(tab.delegation.agent);
  }
  if (isFileTab(tab)) {
    return closed.file?.browsedOn === closed.plan ? true : open.files?.includes(tab.file);
  }
  if (isChangesTab(tab)) return open.agents?.includes(tab.changes);
  if (isPageTab(tab)) return open.pages.includes(tab.page);
  return true;
}

/** The closed tabs with `tab` closed newest, an older close of the same tab let go, and the oldest past the bound. */
export function withClosed(closed: readonly ClosedTab[], tab: ClosedTab): readonly ClosedTab[] {
  return [...closed.filter((each) => !sameClosed(each, tab)), tab].slice(-CLOSED_TABS_KEPT);
}

/**
 * Whether a closed tab's subject stands: known of the open plan once its
 * read lands, and of another plan only that the plan is gone, so nothing
 * there until it opens.
 */
export function closedTabStands(closed: ClosedTab, open: OpenSubjects): boolean | undefined {
  if (closed.plan !== open.planId) {
    return open.plans === undefined || open.plans.includes(closed.plan) ? undefined : false;
  }
  return closed.strip === CLOSED_TAB_STRIP.COLUMN
    ? columnTabStands(closed.tab, open)
    : panelTabStands(closed, open);
}

/**
 * The newest closed tab not known to be gone, and the tabs closed before it,
 * every newer one, gone, let go with it; nothing to reopen where every tab
 * is gone.
 */
export function nextToReopen(
  closed: readonly ClosedTab[],
  open: OpenSubjects,
): { next: ClosedTab | undefined; rest: readonly ClosedTab[] } {
  const at = closed.findLastIndex((each) => closedTabStands(each, open) !== false);
  return at < 0 ? { next: undefined, rest: [] } : { next: closed[at], rest: closed.slice(0, at) };
}
