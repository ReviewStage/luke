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
 * per agent, drawn after them, and come and go with the plan. An agent's
 * tab closes as any other does, which closes the view and leaves the agent
 * running, and the "+" opens it again; the agents whose tabs were closed
 * are kept, so a closed tab stays closed across a launch, and an agent
 * started since opens its tab. A kept tab naming an agent the open plan
 * has none of reads as the first open fixed tab, so leaving a plan or
 * opening another never shows a tab with nothing behind it, while the kept
 * value stands until the next choice: the plan whose agent it names shows
 * it again. A subagent's tab, opened from its call in the Work tab, from
 * the "+", or from a delegation's row in an agent's tab, follows the
 * agents: it is held to the open plan's work, or to the plan's open agent
 * tabs where one of them delegated, the same way, it closes, and it is
 * kept nowhere, so a launch opens none. A draft
 * agent's tab, opened from the "+", stands after the agents while the open
 * plan holds the draft, and is kept nowhere either; closing it lets the
 * draft go, which is its owner's to do.
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

/** A worker one of the plan's agents delegated to, as its tab carries it: the agent, and the task it handed over, which the tab names itself by. */
interface SubagentDelegation {
  readonly agent: string;
  readonly task: string;
}

/** One subagent's tab, named by the call that started it: on the open plan's work, or, with the delegation, on one of its agents' turns. */
export interface SubagentSidePanelTab {
  readonly subagent: string;
  /** Absent for the planning worker, whose session the plan's work holds. */
  readonly delegation?: SubagentDelegation;
}

/** The tab of an agent not yet started, named by the key its first message will start it under. */
export interface DraftSidePanelTab {
  readonly draft: string;
}

/** A tab of the panel: one of the fixed kinds, one agent's, one subagent's, or a draft agent's. */
export type SidePanelTab =
  | FixedSidePanelTab
  | AgentSidePanelTab
  | SubagentSidePanelTab
  | DraftSidePanelTab;

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

/** Whether a tab is a draft agent's. */
export function isDraftTab(tab: SidePanelTab): tab is DraftSidePanelTab {
  return !isFixedTab(tab) && "draft" in tab;
}

/** Whether two tabs are the same tab. A delegated worker's call names it within its agent, as the service names its conversation, so its tab is the pair. */
export function sameTab(a: SidePanelTab, b: SidePanelTab): boolean {
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  if (isSubagentTab(a)) {
    return (
      isSubagentTab(b) && a.subagent === b.subagent && a.delegation?.agent === b.delegation?.agent
    );
  }
  if (isDraftTab(a)) return isDraftTab(b) && a.draft === b.draft;
  return a === b;
}

/** A tab's key for a list that draws one element per tab: a fixed tab's word, or the agent's, call's, or draft's own id, which no fixed word spells. */
export function tabKey(tab: SidePanelTab): string {
  if (isAgentTab(tab)) return tab.agent;
  if (isDraftTab(tab)) return tab.draft;
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

/**
 * How many agents whose tabs were closed are kept, the latest closed. Note
 * that the agents are every plan's, so the list is held to a bound rather
 * than growing with every agent ever closed; one past it opens again.
 */
const CLOSED_AGENTS_KEPT = 500;

const sidePanelTabSchema = Schema.Literals(SIDE_PANEL_TABS);
const anyTabSchema = Schema.Union([sidePanelTabSchema, Schema.Struct({ agent: Schema.String })]);

/**
 * The open fixed tabs in the strip's order, the chosen tab, which is none
 * only while no tab is open, and the agents whose tabs were closed. The
 * agent tabs are the plan's rather than the panel's to keep, so only the
 * chosen one may name an agent, and the agents kept are those not drawn.
 */
const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tabs: Schema.Array(sidePanelTabSchema),
  tab: Schema.optional(anyTabSchema),
  width: Schema.Number,
  closedAgents: Schema.optional(Schema.Array(Schema.String)),
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

/**
 * The state the hook holds: the kept one, and the subagent tabs open, by
 * the call that started each, in the order opened. They are this view's
 * rather than the preference's, so they are kept nowhere, and a subagent's
 * tab chosen is written as no tab, which the next launch reads as the first.
 */
interface HeldState extends Omit<SidePanelState, "tab" | "closedAgents"> {
  readonly tab?: SidePanelTab | undefined;
  readonly subagents: readonly SubagentSidePanelTab[];
  readonly closedAgents: readonly string[];
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
  /** The open subagent tabs in the order opened; they follow the agent tabs, and only those the open plan's work or open agent tabs hold are drawn. */
  subagents: readonly SubagentSidePanelTab[];
  /** The agents whose tabs were closed, which the strip draws none for until one is opened again. */
  closedAgents: readonly string[];
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
  /** Closes the tab, and only the view: an agent's goes on as it was. Closing the chosen one chooses its neighbour, the one after it where there is one. */
  onClose: (tab: SidePanelTab) => void;
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
 * chosen if asked or if nothing was. An agent's tab opens again in its
 * place among the agents, which stand in the order started; a subagent's
 * opens at the end of its own run, and one already open is chosen as it
 * stands, whichever path named its call.
 */
function withTab(held: HeldState, tab: SidePanelTab, choose: boolean): HeldState {
  const tabs = isFixedTab(tab) && !held.tabs.includes(tab) ? [...held.tabs, tab] : held.tabs;
  const open = isSubagentTab(tab) ? held.subagents.find((each) => sameTab(each, tab)) : undefined;
  const subagents =
    isSubagentTab(tab) && open === undefined ? [...held.subagents, tab] : held.subagents;
  const closedAgents =
    isAgentTab(tab) && held.closedAgents.includes(tab.agent)
      ? held.closedAgents.filter((each) => each !== tab.agent)
      : held.closedAgents;
  const chosen = choose || held.tab === undefined ? (open ?? tab) : held.tab;
  return tabs === held.tabs &&
    subagents === held.subagents &&
    closedAgents === held.closedAgents &&
    chosen === held.tab
    ? held
    : { ...held, tabs, subagents, closedAgents, tab: chosen };
}

/** What the plan holds for the tabs beside the fixed ones: its agents, or nothing while unread, the planning workers its work holds, by the call that started each, and its draft. */
export interface DrawnTabs {
  agents: readonly string[] | undefined;
  subagents: readonly string[];
  draft: string | undefined;
}

/**
 * Whether the plan draws the subagent's tab: the planning worker's while
 * the plan's work holds its call, and a delegated worker's while the
 * agent that delegated has its tab open, or until the agents are read, as
 * an agent's own tab stands. `agents` are the open agent tabs.
 */
export function drawsSubagent(
  tab: SubagentSidePanelTab,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): boolean {
  if (tab.delegation === undefined) return drawn.subagents.includes(tab.subagent);
  return drawn.agents === undefined || drawn.agents.includes(tab.delegation.agent);
}

/** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
function drawnAgents(
  agents: readonly string[] | undefined,
  closedAgents: readonly string[],
): readonly string[] | undefined {
  return agents?.filter((each) => !closedAgents.includes(each));
}

/** The open subagent tabs the plan draws, in the order opened. */
function drawnSubagents(held: HeldState, drawn: DrawnTabs): readonly SubagentSidePanelTab[] {
  const agents = drawnAgents(drawn.agents, held.closedAgents);
  return held.subagents.filter((each) =>
    drawsSubagent(each, { agents, subagents: drawn.subagents }),
  );
}

/**
 * The tab chosen in place of the closed one: the next of its own run (the
 * fixed tabs, the open agents, the draft, the subagent tabs the plan
 * draws), or the one before it in the run, or where it was the run's last,
 * the tab before it in the strip, or the one after. A tab another plan's
 * work holds is not a neighbour, since it is not in the strip.
 */
function neighbourOf(
  held: HeldState,
  tab: SidePanelTab,
  drawn: DrawnTabs,
): SidePanelTab | undefined {
  const agents = drawnAgents(drawn.agents, held.closedAgents) ?? [];
  const runs: readonly (readonly SidePanelTab[])[] = [
    held.tabs,
    agents.map((agent) => ({ agent })),
    drawn.draft === undefined ? [] : [{ draft: drawn.draft }],
    drawnSubagents(held, drawn),
  ];
  const run = runs.find((each) => each.some((other) => sameTab(other, tab))) ?? [];
  const strip = runs.flat();
  const at = run.findIndex((other) => sameTab(other, tab));
  const place = strip.findIndex((other) => sameTab(other, tab));
  return run[at + 1] ?? run[at - 1] ?? strip[place - 1] ?? strip[place + 1];
}

/**
 * The state with the tab closed, its neighbour chosen in its place if it
 * was the chosen one. Closing an agent's tab closes nothing of the agent's
 * own, and closing a draft's leaves the draft its owner's to let go.
 */
function withoutTab(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const closed: HeldState | undefined = isFixedTab(tab)
    ? held.tabs.includes(tab)
      ? { ...held, tabs: held.tabs.filter((each) => each !== tab) }
      : undefined
    : isAgentTab(tab)
      ? held.closedAgents.includes(tab.agent)
        ? undefined
        : { ...held, closedAgents: [...held.closedAgents, tab.agent].slice(-CLOSED_AGENTS_KEPT) }
      : isSubagentTab(tab)
        ? held.subagents.some((each) => sameTab(each, tab))
          ? { ...held, subagents: held.subagents.filter((each) => !sameTab(each, tab)) }
          : undefined
        : held;
  if (closed === undefined) return held;
  const chosen = held.tab !== undefined && sameTab(held.tab, tab);
  return chosen ? { ...closed, tab: neighbourOf(held, tab, drawn) } : closed;
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
  return {
    ...state,
    tabs,
    tab,
    width: clampWidth(state.width),
    subagents: [],
    closedAgents: state.closedAgents ?? [],
  };
}

/** What is kept of the state: the preference without the subagent tabs, and without a subagent's or a draft's tab chosen. */
function stored(state: HeldState): SidePanelState {
  const kept = {
    open: state.open,
    tabs: state.tabs,
    width: state.width,
    closedAgents: state.closedAgents,
  };
  const tab = state.tab;
  return tab !== undefined && (isFixedTab(tab) || isAgentTab(tab)) ? { ...kept, tab } : kept;
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
 * open plan has none of, or a subagent tab the plan does not draw
 * (`drawsSubagent`), reads as the first open fixed tab, or as none where
 * every fixed tab is closed. With the plan's agents not yet read, the kept
 * agent tab stands, and a delegated worker's with it, so a tab kept across
 * a launch is not swapped for another and back while the list is on its
 * way; a planning worker's tab is kept across no launch, and a plan whose
 * work is unread or has no turn holds no subagent, so nothing is waited
 * for on its account. A draft's tab shows while the open plan holds that
 * draft.
 */
export function shownTab(
  kept: SidePanelTab | undefined,
  tabs: readonly FixedSidePanelTab[],
  agents: readonly string[] | undefined,
  subagents: readonly string[] = [],
  draft: string | undefined = undefined,
): SidePanelTab | undefined {
  if (kept === undefined || isFixedTab(kept)) return kept;
  if (isAgentTab(kept)) {
    return agents === undefined || agents.includes(kept.agent) ? kept : tabs[0];
  }
  if (isDraftTab(kept)) return kept.draft === draft ? kept : tabs[0];
  return drawsSubagent(kept, { agents, subagents }) ? kept : tabs[0];
}

/** A staged state as the hook holds it: no subagent tab open, and the agents it closed. */
function heldOf(staged: SidePanelState): HeldState {
  return { ...staged, subagents: [], closedAgents: staged.closedAgents ?? [] };
}

/**
 * The side panel's state: the kept preference, kept again on every change,
 * or where a fixture run stages one, that staged state and the presses on
 * it, which are kept nowhere. `agents` are the open plan's agent tabs, by
 * agent id, or nothing while they have not been read, and `subagents` the
 * planning workers its work holds, by the call that started each, none
 * where the work has none or is unread, and `draft` its draft agent's key,
 * if it holds one; the tab shown is held to them, a delegated worker's to
 * the open agent tabs.
 */
export function useSidePanel(
  staged: SidePanelState | undefined,
  agents?: readonly string[] | undefined,
  subagents: readonly string[] = [],
  draft: string | undefined = undefined,
): SidePanelControl {
  // Note that the fixture run's panel is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [moved, setMoved] = useState<HeldState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const state = staged === undefined ? kept : (moved ?? heldOf(staged));
  const update = useCallback(
    (change: (held: HeldState) => HeldState) => {
      if (staged === undefined) setKept(change);
      else setMoved((held) => change(held ?? heldOf(staged)));
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
    (tab: SidePanelTab) => update((held) => withoutTab(held, tab, { agents, subagents, draft })),
    [update, agents, subagents, draft],
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
    closedAgents: state.closedAgents,
    tab: shownTab(state.tab, state.tabs, drawnAgents(agents, state.closedAgents), subagents, draft),
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
