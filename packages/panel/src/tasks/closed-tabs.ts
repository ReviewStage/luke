import type { MainTab } from "./use-main-tabs.js";
import type { OpenFile, SidePanelTab } from "./use-side-panel.js";

const CLOSED_TABS_KEPT = 20;

export const CLOSED_TAB_STRIP = {
  COLUMN: "column",
  SIDE_PANEL: "side-panel",
} as const;

interface ClosedColumnTab {
  readonly strip: typeof CLOSED_TAB_STRIP.COLUMN;
  readonly task: string;
  readonly tab: MainTab;
  readonly at: number;
}

interface ClosedSidePanelTab {
  readonly strip: typeof CLOSED_TAB_STRIP.SIDE_PANEL;
  readonly task: string;
  readonly tab: SidePanelTab;
  readonly at: number;
  readonly file: OpenFile | undefined;
}

export type ClosedTab = ClosedColumnTab | ClosedSidePanelTab;

export const NO_CLOSED_TABS: readonly ClosedTab[] = [];

export function withClosedTab(was: readonly ClosedTab[], closed: ClosedTab): readonly ClosedTab[] {
  return [...was, closed].slice(-CLOSED_TABS_KEPT);
}

export function withUndrawnPassed(
  was: readonly ClosedTab[],
  task: string | undefined,
  draws: (closed: ClosedTab) => boolean,
  drawsAnywhere: (closed: ClosedTab) => boolean,
): readonly ClosedTab[] {
  const kept = was.findLastIndex(
    (closed) => drawsAnywhere(closed) && (closed.task !== task || draws(closed)),
  );
  return kept === was.length - 1 ? was : was.slice(0, kept + 1);
}
