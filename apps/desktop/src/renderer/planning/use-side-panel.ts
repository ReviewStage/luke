import { Option, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

/**
 * use-side-panel.ts -- the open plan's side panel: whether it is shown, which tabs it holds and which is chosen, and how wide, kept across launches.
 *
 * The plan's document is always the page's main content; what supports it
 * (the whiteboard, the code Luke has on screen, what was said on the plan's
 * calls, what Luke's planning model wrote and ran on them, and each coding
 * agent started on the plan) stands in a panel at the window's right that
 * the developer opens and closes, as every devtool
 * window's secondary sidebar does. The one thing that opens it on its own is
 * Luke first drawing on a plan's board or first showing its code
 * (`use-panel-arrivals.ts`), once per plan and kind, and a coding agent
 * just started, whose tab opens selected. Not to be confused with "the
 * panel", which in this renderer is Luke's whole surface.
 *
 * The four fixed kinds are a constant; the agent tabs are the plan's, one
 * per agent, drawn after them, and come and go with the plan, so none of
 * them closes. A kept tab naming an agent the open plan has none of reads
 * as the first open fixed tab, so leaving a plan or opening another never
 * shows a tab with nothing behind it, while the kept value stands until the
 * next choice: the plan whose agent it names shows it again. A subagent's
 * tab, opened from its call in the Work tab, follows the agents: it is held
 * to the open plan's work the same way, it closes, and it is kept nowhere,
 * so a launch opens none.
 *
 * The panel holds tabs the way an editor's pane does: the developer closes
 * the ones they do not want, and the "+" or a tab's shortcut opens one again
 * at the end of the strip. Closing the chosen tab chooses its neighbour, and
 * closing the last leaves the panel open and empty rather than shutting it.
 * A tab dragged or moved from the keyboard to another place in the strip is
 * kept there.
 *
 * These facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage and read once at
 * mount. What an earlier version kept, before the panel's tabs could close,
 * still reads, with every tab open. A fixture run neither draws nor writes
 * them: what it draws is staged, and a capture must not depend on how the
 * last run left the panel.
 *
 * The open panel may also fill the window's work, over the document, as
 * ChatGPT's canvas does. That is a moment's view rather than a preference,
 * so it is kept nowhere: a launch, and a panel shown again, start beside
 * the document.
 */

/** The panel's kinds of tab, the fixed four. A kind is one entry here, one row below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  BOARD: "board",
  CODE: "code",
  TRANSCRIPT: "transcript",
  WORK: "work",
} as const;

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** One coding agent's tab, named by the agent it shows. */
export interface AgentSidePanelTab {
  readonly agent: string;
}

/** One subagent's tab, named by the call that started it on the open plan's work. */
export interface SubagentSidePanelTab {
  readonly subagent: string;
}

/** A tab of the panel: one of the fixed kinds, one agent's, or one subagent's. */
export type SidePanelTab = FixedSidePanelTab | AgentSidePanelTab | SubagentSidePanelTab;

/** A tab the developer may close: a fixed one, or a subagent's; an agent's always stands. */
type ClosableSidePanelTab = FixedSidePanelTab | SubagentSidePanelTab;

/** What the panel knows of a kind of tab. */
export interface SidePanelTabKind {
  label: string;
  /**
   * Whether at most one tab of the kind stands, so a kind already open is
   * not offered again. Note that the open tabs are kept as their kinds, so a
   * kind that may stand twice also needs its tabs told apart, which none
   * needs yet.
   */
  singleInstance: boolean;
}

export const SIDE_PANEL_TAB_KIND = {
  [SIDE_PANEL_TAB.BOARD]: { label: "Board", singleInstance: true },
  [SIDE_PANEL_TAB.CODE]: { label: "Code", singleInstance: true },
  [SIDE_PANEL_TAB.TRANSCRIPT]: { label: "Transcript", singleInstance: true },
  [SIDE_PANEL_TAB.WORK]: { label: "Work", singleInstance: true },
} as const satisfies Record<FixedSidePanelTab, SidePanelTabKind>;

/** Every kind of tab, in the order a first launch opens them and the "+" offers them; the agent tabs follow them. */
export const SIDE_PANEL_TABS: readonly FixedSidePanelTab[] = Object.values(SIDE_PANEL_TAB);

const FIXED_TABS: ReadonlySet<SidePanelTab> = new Set(SIDE_PANEL_TABS);

/** Whether a tab is one of the fixed kinds. */
function isFixedTab(tab: SidePanelTab): tab is FixedSidePanelTab {
  return FIXED_TABS.has(tab);
}

/** Whether a tab is one agent's. */
export function isAgentTab(tab: SidePanelTab): tab is AgentSidePanelTab {
  return !isFixedTab(tab) && "agent" in tab;
}

/** Whether a tab is one subagent's. */
export function isSubagentTab(tab: SidePanelTab): tab is SubagentSidePanelTab {
  return !isFixedTab(tab) && "subagent" in tab;
}

/** Whether two tabs are the same tab. */
export function sameTab(a: SidePanelTab, b: SidePanelTab): boolean {
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  if (isSubagentTab(a)) return isSubagentTab(b) && a.subagent === b.subagent;
  return a === b;
}

/** A tab's key for a list that draws one element per tab: a fixed tab's word, or the agent's or call's own id, which no fixed word spells. */
export function tabKey(tab: SidePanelTab): string {
  if (isAgentTab(tab)) return tab.agent;
  return isSubagentTab(tab) ? tab.subagent : tab;
}

/**
 * How narrow the panel may be dragged, in CSS pixels, and where it starts. It
 * has no greatest width of its own: it is dragged as wide as the document
 * beside it leaves room for (side-panel.tsx), as an editor's secondary side
 * bar is.
 */
export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  DEFAULT: 400,
} as const;

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidePanel";

const sidePanelTabSchema = Schema.Literals(SIDE_PANEL_TABS);
const anyTabSchema = Schema.Union([sidePanelTabSchema, Schema.Struct({ agent: Schema.String })]);

/**
 * The open fixed tabs in the strip's order, and the chosen tab, which is
 * none only while no tab is open. The agent tabs are the plan's rather than
 * the panel's to keep, so only the chosen one may name an agent.
 */
const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tabs: Schema.Array(sidePanelTabSchema),
  tab: Schema.optional(anyTabSchema),
  width: Schema.Number,
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

/**
 * The state the hook holds: the kept one, and the subagent tabs open, by
 * the call that started each, in the order opened. They are this view's
 * rather than the preference's, so they are kept nowhere, and a subagent's
 * tab chosen is written as no tab, which the next launch reads as the first.
 */
interface HeldState extends Omit<SidePanelState, "tab"> {
  readonly tab?: SidePanelTab | undefined;
  readonly subagents: readonly string[];
}

/** What was kept before the panel's tabs could close: every tab open, and the one chosen. */
const earlierSidePanelSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: anyTabSchema,
  width: Schema.Number,
});

const storedSidePanel = Schema.fromJsonString(sidePanelStateSchema);
const decodeStored = Schema.decodeUnknownOption(storedSidePanel);
const decodeEarlier = Schema.decodeUnknownOption(Schema.fromJsonString(earlierSidePanelSchema));
const encodeStored = Schema.encodeSync(storedSidePanel);

/** A first launch: closed, every tab open and the board chosen, at the default width. */
const FIRST_LAUNCH: SidePanelState = {
  open: false,
  tabs: SIDE_PANEL_TABS,
  tab: SIDE_PANEL_TAB.BOARD,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

/** What the panel and its toggle draw, and their presses. */
export interface SidePanelControl {
  open: boolean;
  /** Whether the open panel fills the work column in the document's place. */
  fullScreen: boolean;
  /** The open fixed tabs, in the strip's order; the plan's agent tabs follow them. */
  tabs: readonly FixedSidePanelTab[];
  /** The open subagent tabs, by the call that started each, in the order opened; they follow the agent tabs, and only those the open plan's work holds are drawn. */
  subagents: readonly string[];
  /** The chosen tab, which is none only while no tab is open. */
  tab: SidePanelTab | undefined;
  /** The panel's width in CSS pixels, never under {@link SIDE_PANEL_WIDTH}'s least. */
  width: number;
  /** Shows or hides the panel; hiding it leaves full screen too. */
  onToggle: () => void;
  onToggleFullScreen: () => void;
  /** Shows the panel on the tab, opening it at the strip's end where it was closed. */
  onChoose: (tab: SidePanelTab) => void;
  /** Opens the tab at the strip's end where it was closed, leaving the chosen one chosen. */
  onAdd: (tab: FixedSidePanelTab) => void;
  /** Closes the tab; closing the chosen one chooses its neighbour, the one after it where there is one. */
  onClose: (tab: ClosableSidePanelTab) => void;
  /** Moves the open fixed tab to the place in the strip's order, leaving the chosen one chosen; the agent tabs keep their place after the fixed ones. */
  onMove: (tab: FixedSidePanelTab, to: number) => void;
  /** Asks for a width; it is held to the least width before it is kept. */
  onResize: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width));
}

/** Whether a tab of the kind may be opened beside the tabs open now. */
export function tabAddable(tab: FixedSidePanelTab, tabs: readonly FixedSidePanelTab[]): boolean {
  const kind: SidePanelTabKind = SIDE_PANEL_TAB_KIND[tab];
  return !kind.singleInstance || !tabs.includes(tab);
}

/**
 * The state with the tab open at the strip's end where it was not, and
 * chosen if asked or if nothing was. An agent's tab always stands, so it
 * is only ever chosen; a subagent's opens at the end of its own run.
 */
function withTab(held: HeldState, tab: SidePanelTab, choose: boolean): HeldState {
  const tabs = isFixedTab(tab) && !held.tabs.includes(tab) ? [...held.tabs, tab] : held.tabs;
  const subagents =
    isSubagentTab(tab) && !held.subagents.includes(tab.subagent)
      ? [...held.subagents, tab.subagent]
      : held.subagents;
  const chosen = choose || held.tab === undefined ? tab : held.tab;
  return tabs === held.tabs && subagents === held.subagents && chosen === held.tab
    ? held
    : { ...held, tabs, subagents, tab: chosen };
}

/** The tabs the plan draws beside the fixed ones: its agents, and the open subagent tabs its work holds, in the strip's order. */
interface DrawnTabs {
  agents: readonly string[] | undefined;
  subagents: readonly string[];
}

/** The open subagent tabs the plan's work holds, in the order opened. */
function drawnSubagents(held: HeldState, drawn: DrawnTabs): readonly string[] {
  return held.subagents.filter((each) => drawn.subagents.includes(each));
}

/**
 * The state with the fixed tab closed, its neighbour chosen in its place
 * if it was the chosen one: the fixed tab after it, or where no fixed tab
 * is left, the plan's first agent, or the first subagent tab it draws.
 */
function withoutFixedTab(held: HeldState, tab: FixedSidePanelTab, drawn: DrawnTabs): HeldState {
  const at = held.tabs.indexOf(tab);
  if (at < 0) return held;
  const tabs = held.tabs.filter((each) => each !== tab);
  if (held.tab !== tab) return { ...held, tabs };
  const agent = drawn.agents?.[0];
  const subagent = drawnSubagents(held, drawn)[0];
  const next: SidePanelTab | undefined =
    tabs[Math.min(at, tabs.length - 1)] ??
    (agent !== undefined ? { agent } : subagent !== undefined ? { subagent } : undefined);
  return { ...held, tabs, tab: next };
}

/**
 * The state with the subagent's tab closed, its neighbour chosen in its
 * place if it was the chosen one: among the subagent tabs the plan draws,
 * the one after it, or the tab before it where none is left, the plan's
 * last agent or the last fixed tab. A tab another plan's work holds is not
 * a neighbour, since it is not in the strip.
 */
function withoutSubagentTab(
  held: HeldState,
  tab: SubagentSidePanelTab,
  drawn: DrawnTabs,
): HeldState {
  const shown = drawnSubagents(held, drawn);
  const at = shown.indexOf(tab.subagent);
  if (!held.subagents.includes(tab.subagent)) return held;
  const subagents = held.subagents.filter((each) => each !== tab.subagent);
  if (held.tab === undefined || !sameTab(held.tab, tab)) return { ...held, subagents };
  const beside = shown.filter((each) => each !== tab.subagent);
  const neighbour = beside[Math.min(Math.max(at, 0), beside.length - 1)];
  const last = drawn.agents?.at(-1);
  const next: SidePanelTab | undefined =
    neighbour !== undefined
      ? { subagent: neighbour }
      : last !== undefined
        ? { agent: last }
        : held.tabs.at(-1);
  return { ...held, subagents, tab: next };
}

/** The state with the tab closed, its neighbour chosen in its place if it was the chosen one. */
function withoutTab(held: HeldState, tab: ClosableSidePanelTab, drawn: DrawnTabs): HeldState {
  return isFixedTab(tab) ? withoutFixedTab(held, tab, drawn) : withoutSubagentTab(held, tab, drawn);
}

/** The state with the open tab taken out and put back at `to` in the strip's order. */
function withTabAt(held: HeldState, tab: FixedSidePanelTab, to: number): HeldState {
  const at = held.tabs.indexOf(tab);
  if (at < 0 || to === at) return held;
  const tabs = held.tabs.filter((each) => each !== tab);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, tab);
  return { ...held, tabs };
}

/**
 * A kept state made whole: each tab open once, the chosen one among them
 * (the first where it is not) or an agent's, the width no narrower than
 * its least, and no subagent tab open.
 */
function settled(state: SidePanelState): HeldState {
  const tabs = [...new Set(state.tabs)];
  const tab =
    state.tab !== undefined && (isAgentTab(state.tab) || tabs.includes(state.tab))
      ? state.tab
      : tabs[0];
  return { ...state, tabs, tab, width: clampWidth(state.width), subagents: [] };
}

/** What is kept of the state: the preference without the subagent tabs, and without a subagent's tab chosen. */
function stored(state: HeldState): SidePanelState {
  const kept = { open: state.open, tabs: state.tabs, width: state.width };
  return state.tab !== undefined && !isSubagentTab(state.tab) ? { ...kept, tab: state.tab } : kept;
}

/** What storage holds under the key, or nothing where it refuses the read. */
function storedText(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The kept preference, an earlier version's with every tab open, or the
 * first launch's where none was kept or it no longer reads.
 */
function readStored(): HeldState {
  const text = storedText();
  const stored = Option.getOrElse(decodeStored(text), () =>
    Option.match(decodeEarlier(text), {
      onNone: () => FIRST_LAUNCH,
      onSome: (earlier): SidePanelState => ({ ...earlier, tabs: SIDE_PANEL_TABS }),
    }),
  );
  return settled(stored);
}

/**
 * The tab the panel shows for the one kept: an agent tab whose agent the
 * open plan has none of, or a subagent tab whose call the open plan's work
 * does not hold, reads as the first open fixed tab, or as none where every
 * fixed tab is closed. With the plan's agents not yet read, the kept
 * agent tab stands, so a tab kept across a launch is not swapped for
 * another and back while the list is on its way; a subagent's tab is kept
 * across no launch, and a plan whose work is unread or has no turn holds
 * no subagent, so nothing is waited for on its account.
 */
export function shownTab(
  kept: SidePanelTab | undefined,
  tabs: readonly FixedSidePanelTab[],
  agents: readonly string[] | undefined,
  subagents: readonly string[] = [],
): SidePanelTab | undefined {
  if (kept === undefined || isFixedTab(kept)) return kept;
  if (isAgentTab(kept)) {
    return agents === undefined || agents.includes(kept.agent) ? kept : tabs[0];
  }
  return subagents.includes(kept.subagent) ? kept : tabs[0];
}

/**
 * The side panel's state: the kept preference, kept again on every change,
 * or where a fixture run stages one, that staged state and the presses on
 * it, which are kept nowhere. `agents` are the open plan's agent tabs, by
 * agent id, or nothing while they have not been read, and `subagents` the
 * subagents its work holds, by the call that started each, none where the
 * work has none or is unread; the tab shown is held to them.
 */
export function useSidePanel(
  staged: SidePanelState | undefined,
  agents?: readonly string[] | undefined,
  subagents: readonly string[] = [],
): SidePanelControl {
  // Note that the fixture run's panel is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [moved, setMoved] = useState<HeldState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const state = staged === undefined ? kept : (moved ?? { ...staged, subagents: [] });
  const update = useCallback(
    (change: (held: HeldState) => HeldState) => {
      if (staged === undefined) setKept(change);
      else setMoved((held) => change(held ?? { ...staged, subagents: [] }));
    },
    [staged],
  );

  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (staged !== undefined) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
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
    (tab: SidePanelTab) => update((held) => ({ ...withTab(held, tab, true), open: true })),
    [update],
  );
  const onAdd = useCallback(
    (tab: FixedSidePanelTab) => update((held) => withTab(held, tab, false)),
    [update],
  );
  const onClose = useCallback(
    (tab: ClosableSidePanelTab) => update((held) => withoutTab(held, tab, { agents, subagents })),
    [update, agents, subagents],
  );
  const onMove = useCallback(
    (tab: FixedSidePanelTab, to: number) => update((held) => withTabAt(held, tab, to)),
    [update],
  );
  const onResize = useCallback(
    (width: number) => update((held) => ({ ...held, width: clampWidth(width) })),
    [update],
  );
  return {
    open: state.open,
    tabs: state.tabs,
    subagents: state.subagents,
    tab: shownTab(state.tab, state.tabs, agents, subagents),
    width: state.width,
    fullScreen: state.open && fullScreen,
    onToggle,
    onToggleFullScreen,
    onChoose,
    onAdd,
    onClose,
    onMove,
    onResize,
  };
}
