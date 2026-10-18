/**
 * closed-tabs.ts -- the tabs closed in this window, the latest last, which ⇧⌘T opens again one at a time, as a browser's Reopen Closed Tab does.
 *
 * Each close of a tab of either strip, the task's column's or the side
 * panel's, is kept as what it was: the task it stood on, the strip, the tab,
 * its place there, and for a file's tab the file, lines, and history it
 * showed. A reopen takes the latest and opens it through the strip's own
 * open, so it stands where it stood showing what it showed, and the one
 * closed before it is next. A tab its strip would not draw again on the
 * open task, its agent archived or its page gone since, is passed over for
 * the one before it, so every press opens a tab; every other opens as its
 * strip opens any such tab, a file gone since on the file tab's own word
 * for it. The list is a moment's, kept nowhere, and held to a bound.
 */

import type { MainTab } from "@luke/panel/tasks/use-main-tabs";
import type { OpenFile, SidePanelTab } from "./use-side-panel";

/** How many closed tabs are kept, the latest closed; the oldest is let go past it. */
const CLOSED_TABS_KEPT = 20;

/** Which strip a closed tab stood in. */
export const CLOSED_TAB_STRIP = {
  COLUMN: "column",
  SIDE_PANEL: "side-panel",
} as const;

/** A tab of the task's column as it stood when closed: `at` its place among the tabs after the task's. */
interface ClosedColumnTab {
  readonly strip: typeof CLOSED_TAB_STRIP.COLUMN;
  readonly task: string;
  readonly tab: MainTab;
  readonly at: number;
}

/** A tab of the side panel as it stood when closed: `at` its place in the strip, and a file's tab's file as it showed it. */
interface ClosedSidePanelTab {
  readonly strip: typeof CLOSED_TAB_STRIP.SIDE_PANEL;
  readonly task: string;
  readonly tab: SidePanelTab;
  readonly at: number;
  readonly file: OpenFile | undefined;
}

export type ClosedTab = ClosedColumnTab | ClosedSidePanelTab;

/** No tab closed yet. */
export const NO_CLOSED_TABS: readonly ClosedTab[] = [];

/** The closed tabs with `closed` the latest, the oldest let go past the bound. */
export function withClosedTab(was: readonly ClosedTab[], closed: ClosedTab): readonly ClosedTab[] {
  return [...was, closed].slice(-CLOSED_TABS_KEPT);
}

/**
 * The closed tabs without those latest closed on `task`, the open task, that
 * its strips would not draw again (`draws`), so the latest left is the one a
 * reopen opens. A tab of another task stops the walk, since what that task
 * draws is read only once it opens.
 */
export function withUndrawnPassed(
  was: readonly ClosedTab[],
  task: string | undefined,
  draws: (closed: ClosedTab) => boolean,
): readonly ClosedTab[] {
  const kept = was.findLastIndex((closed) => closed.task !== task || draws(closed));
  return kept === was.length - 1 ? was : was.slice(0, kept + 1);
}
