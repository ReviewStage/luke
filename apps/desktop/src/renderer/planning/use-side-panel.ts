import { Option, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

/**
 * use-side-panel.ts -- the open plan's side panel: whether it is shown, which of its tabs, and how wide, kept across launches.
 *
 * The plan's document is always the page's main content; what supports it
 * (the whiteboard, the code Luke has on screen, what was said on the plan's
 * calls, and each coding agent started on the plan) stands in a panel at
 * the window's right that the developer opens and closes, as every devtool
 * window's secondary sidebar does. The one thing that opens it on its own is
 * Luke first drawing on a plan's board or first showing its code
 * (`use-panel-arrivals.ts`), once per plan and kind, and a coding agent
 * just started, whose tab opens selected. Not to be confused with "the
 * panel", which in this renderer is Luke's whole surface.
 *
 * The three fixed tabs are a constant; the agent tabs are the plan's, one
 * per agent, and come and go with the plan. A kept tab naming an agent the
 * open plan has none of reads as the board, so leaving a plan or opening
 * another never shows a tab with nothing behind it, while the kept value
 * stands until the next choice: the plan whose agent it names shows it
 * again.
 *
 * The three facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage and read once at
 * mount. A fixture run neither draws nor writes them: what it draws is
 * staged, and a capture must not depend on how the last run left the panel.
 *
 * The open panel may also fill the window's work, over the document, as
 * ChatGPT's canvas does. That is a moment's view rather than a preference,
 * so it is kept nowhere: a launch, and a panel shown again, start beside
 * the document.
 */

/** The panel's fixed tabs. A tab is one entry here, one label below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  BOARD: "board",
  CODE: "code",
  TRANSCRIPT: "transcript",
} as const;

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** One coding agent's tab, named by the agent it shows. */
export interface AgentSidePanelTab {
  readonly agent: string;
}

/** A tab of the panel: one of the fixed three, or one agent's. */
export type SidePanelTab = FixedSidePanelTab | AgentSidePanelTab;

/** The fixed tab strip, in order; the agent tabs follow it. */
export const SIDE_PANEL_TABS = [
  { tab: SIDE_PANEL_TAB.BOARD, label: "Board" },
  { tab: SIDE_PANEL_TAB.CODE, label: "Code" },
  { tab: SIDE_PANEL_TAB.TRANSCRIPT, label: "Transcript" },
] as const satisfies readonly { tab: FixedSidePanelTab; label: string }[];

const FIXED_TABS: ReadonlySet<SidePanelTab> = new Set(Object.values(SIDE_PANEL_TAB));

/** Whether a tab is one agent's: any tab that is not one of the fixed three. */
export function isAgentTab(tab: SidePanelTab): tab is AgentSidePanelTab {
  return !FIXED_TABS.has(tab);
}

/** Whether two tabs are the same tab. */
export function sameTab(a: SidePanelTab, b: SidePanelTab): boolean {
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  return a === b;
}

/** A tab's key for a list that draws one element per tab: a fixed tab's word, or the agent's own id, which no fixed word spells. */
export function tabKey(tab: SidePanelTab): string {
  return isAgentTab(tab) ? tab.agent : tab;
}

/** How wide the panel may be dragged, in CSS pixels, and where it starts. */
export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  MAX: 720,
  DEFAULT: 400,
} as const;

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidePanel";

const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: Schema.Union([
    Schema.Literals(Object.values(SIDE_PANEL_TAB)),
    Schema.Struct({ agent: Schema.String }),
  ]),
  width: Schema.Number,
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

const storedSidePanel = Schema.fromJsonString(sidePanelStateSchema);
const decodeStored = Schema.decodeUnknownOption(storedSidePanel);
const encodeStored = Schema.encodeSync(storedSidePanel);

/** A first launch: closed, on the board, at the default width. */
const FIRST_LAUNCH: SidePanelState = {
  open: false,
  tab: SIDE_PANEL_TAB.BOARD,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

/** What the panel and its toggle draw, and their presses. */
export interface SidePanelControl {
  open: boolean;
  /** Whether the open panel fills the work column in the document's place. */
  fullScreen: boolean;
  tab: SidePanelTab;
  /** The panel's width in CSS pixels, always within {@link SIDE_PANEL_WIDTH}. */
  width: number;
  /** Shows or hides the panel; hiding it leaves full screen too. */
  onToggle: () => void;
  onToggleFullScreen: () => void;
  onChoose: (tab: SidePanelTab) => void;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.min(SIDE_PANEL_WIDTH.MAX, Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width)));
}

/** What storage holds under the key, or nothing where it refuses the read. */
function storedText(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The kept preference, or the first launch's where none was kept or it no longer reads. */
function readStored(): SidePanelState {
  const stored = Option.getOrElse(decodeStored(storedText()), () => FIRST_LAUNCH);
  return { ...stored, width: clampWidth(stored.width) };
}

/**
 * The tab the panel shows for the one kept: an agent tab whose agent the
 * open plan has none of reads as the board. With the plan's agents not yet
 * read, the kept tab stands, so a tab kept across a launch is not swapped
 * for the board and back while the list is on its way.
 */
export function shownTab(kept: SidePanelTab, agents: readonly string[] | undefined): SidePanelTab {
  if (!isAgentTab(kept) || agents === undefined) return kept;
  return agents.includes(kept.agent) ? kept : SIDE_PANEL_TAB.BOARD;
}

/**
 * The side panel's state: the kept preference, kept again on every change,
 * or where a fixture run stages one, that staged state and the presses on
 * it, which are kept nowhere. `agents` are the open plan's agent tabs, by
 * agent id, or nothing while they have not been read; the tab shown is held
 * to them.
 */
export function useSidePanel(
  staged: SidePanelState | undefined,
  agents?: readonly string[] | undefined,
): SidePanelControl {
  // Note that the fixture run's panel is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<SidePanelState>(readStored);
  const [moved, setMoved] = useState<SidePanelState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const state = staged === undefined ? kept : (moved ?? staged);
  const update = useCallback(
    (change: (held: SidePanelState) => SidePanelState) => {
      if (staged === undefined) setKept(change);
      else setMoved((held) => change(held ?? staged));
    },
    [staged],
  );

  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (staged !== undefined) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(kept));
    } catch {
      // The panel keeps working on the state it holds.
    }
  }, [staged, kept]);

  const onToggle = useCallback(() => {
    update((held) => ({ ...held, open: !held.open }));
    setFullScreen(false);
  }, [update]);
  const onToggleFullScreen = useCallback(() => setFullScreen((was) => !was), []);
  const onChoose = useCallback(
    (tab: SidePanelTab) => update((held) => ({ ...held, open: true, tab })),
    [update],
  );
  const onResize = useCallback(
    (width: number) => update((held) => ({ ...held, width: clampWidth(width) })),
    [update],
  );
  return {
    ...state,
    tab: shownTab(state.tab, agents),
    fullScreen: state.open && fullScreen,
    onToggle,
    onToggleFullScreen,
    onChoose,
    onResize,
  };
}
