import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AgentStripTab,
  type DraftStripTab,
  inPlanOrder,
  isAgentTab,
  isDraftTab,
  movedOrder,
  replacementOf,
  sameTab,
  viewedLast,
} from "./tab-strip-model";

/**
 * use-main-tabs.ts -- the plan's column's tabs: the plan's own, then each of its coding agents and its draft agent, which is chosen, and the order they stand in, kept per plan across launches.
 *
 * The column draws the open plan's document under the plan's tab, and each
 * coding agent started on the plan under a tab of its own, as an editor
 * draws its files, so an agent's transcript and composer take the room the
 * plan is read in rather than a corner of it. The plan's tab always stands
 * first: it never closes, never moves, and no tab is dropped before it, so
 * the plan is where a column with every agent closed comes back to. The
 * agents' tabs follow it, one per agent in the order started, and a draft
 * agent's, opened from the column's "+", after them while the open plan
 * holds the draft.
 *
 * An agent's tab closes as an editor's does, which closes the view and
 * leaves the agent running, and the "+" opens it again; the agents whose
 * tabs were closed are kept, so a closed tab stays closed across a launch,
 * and an agent started since opens its tab. A draft's tab is kept nowhere,
 * and closing it lets the draft go, which is its owner's to do. Closing the
 * chosen tab chooses the one viewed before it on that plan that still
 * stands, and only where none does its neighbour (`replacementOf`), so a
 * column whose last agent closes is back on the plan.
 *
 * The tab chosen is each plan's own: the latest it viewed that still
 * stands, the plan's where none does. So opening a plan from the sidebar
 * shows it as the developer left it, the plan or the agent they were
 * reading, and an agent a notification, a pin, or a Start names is shown by
 * viewing it on its plan. With the plan's agents not yet read, an agent's
 * tab viewed last stands, so a plan opened on an agent is not swapped for
 * the document and back while the list is on its way.
 *
 * The agents' tabs are dragged or moved from the keyboard among
 * themselves and the draft's, and the plan keeps the order from then on: a
 * tab closed and opened again stands where it stood, and one never moved
 * stands after those that were.
 *
 * These facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage, read once at
 * mount. The agents' tabs once stood in the side panel, whose record kept
 * them; a window with no record of its own reads theirs from there once,
 * the plan's tab viewed after them, so each plan opens on its document as
 * it did before. A fixture run neither reads nor writes them: its plans
 * have no agents, and a capture must not depend on how the last run left
 * the column. ⌘T's ask for the column's "+" is a moment's, kept nowhere.
 */

/** The column's own tab, which names the plan: its one word, beside the agents' and the draft's objects. */
export const MAIN_TAB = {
  PLAN: "plan",
} as const;

/** The plan's own tab. */
type PlanStripTab = (typeof MAIN_TAB)[keyof typeof MAIN_TAB];

/** A tab of the plan's column: the plan's own, one agent's, or the draft agent's. */
export type MainTab = PlanStripTab | AgentStripTab | DraftStripTab;

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.mainTabs";

/** Where the side panel keeps its own, which held the agents' tabs before this column did. */
const SIDE_PANEL_KEY = "luke.sidePanel";

/**
 * How many agents whose tabs were closed are kept, the latest closed. Note
 * that the agents are every plan's, so the list is held to a bound rather
 * than growing with every agent ever closed; one past it opens again.
 */
const CLOSED_AGENTS_KEPT = 500;

/**
 * How many tabs a plan keeps as viewed, the latest viewed. Note that a tab
 * closed leaves the list as it closes, so the bound only lets go of tabs
 * long unviewed, which a close then passes over for its neighbour.
 */
const RECENT_KEPT = 20;

/**
 * How many plans' own choices are kept, the latest chosen. Note that a plan
 * deleted leaves its entry behind, so the record is held to a bound rather
 * than growing with every plan ever opened.
 */
const PLANS_KEPT = 500;

/** A tab as it is kept across a launch: the plan's, or an agent's; a draft's is kept nowhere. */
const keptTabSchema = Schema.Union([
  Schema.Literal(MAIN_TAB.PLAN),
  Schema.Struct({ agent: Schema.String }),
]);

/** One plan's choices: the tabs viewed on it, the latest last, and its order since a tab was first moved on it. */
const planChoicesSchema = Schema.Struct({
  recent: Schema.optional(Schema.Array(keptTabSchema)),
  order: Schema.optional(Schema.Array(keptTabSchema)),
});

/** The agents whose tabs were closed, every plan's, and each plan's choices, by plan id. */
const mainTabsSchema = Schema.Struct({
  closedAgents: Schema.Array(Schema.String),
  plans: Schema.Record(Schema.String, planChoicesSchema),
});

type MainTabsState = typeof mainTabsSchema.Type;

/** One plan's choices as the hook holds them, the draft's tab among them until a launch. */
interface PlanChoices {
  readonly recent?: readonly MainTab[] | undefined;
  readonly order?: readonly MainTab[] | undefined;
}

/** The state the hook holds: the kept one, with a draft's tab possibly among a plan's choices. */
interface HeldState {
  readonly closedAgents: readonly string[];
  readonly plans: Readonly<Record<string, PlanChoices>>;
}

/** A side panel tab as an earlier version kept it: a fixed kind's word, or an agent's. */
const sidePanelTabSchema = Schema.Union([Schema.String, Schema.Struct({ agent: Schema.String })]);

/** What of the side panel's record an earlier version kept of the agents' tabs. */
const sidePanelAgentsSchema = Schema.Struct({
  closedAgents: Schema.optional(Schema.Array(Schema.String)),
  plans: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        recent: Schema.optional(Schema.Array(sidePanelTabSchema)),
        order: Schema.optional(Schema.Array(sidePanelTabSchema)),
      }),
    ),
  ),
});

const storedMainTabs = Schema.fromJsonString(mainTabsSchema);
const decodeStored = Schema.decodeUnknownOption(storedMainTabs);
const decodeSidePanel = Schema.decodeUnknownOption(Schema.fromJsonString(sidePanelAgentsSchema));
const encodeStored = Schema.encodeSync(storedMainTabs);

/** A window that has kept nothing, and a fixture run's column. */
const NOTHING_KEPT: HeldState = { closedAgents: [], plans: {} };

/** A plan the developer has chosen nothing on. */
const NO_CHOICES: PlanChoices = {};

/** A plan no tab was moved on, or viewed. */
const NO_TABS: readonly MainTab[] = [];

/** What the column draws and hands back. */
export interface MainTabsControl {
  /** The column's tabs in the strip's order: the plan's first, then the open agents' and the draft's. */
  tabs: readonly MainTab[];
  /** The tab shown. */
  tab: MainTab;
  /** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
  openAgents: readonly string[] | undefined;
  /** Whether ⌘T asked for the column's "+" menu and the "+" has not yet opened it. */
  newTabAsked: boolean;
  /** Shows the tab, opening an agent's where it was closed. */
  onChoose: (tab: MainTab) => void;
  /** Shows the agent's tab on the plan given, as `onChoose` does on the open plan: what a pin or a notification asks, the plan opened beside it. */
  onShow: (planId: string, tab: AgentStripTab) => void;
  /** Closes the tab, and only the view: an agent goes on as it was. The plan's tab never closes. */
  onClose: (tab: MainTab) => void;
  /** Moves an agent's or the draft's tab to the place `to` among them, after the plan's, leaving the chosen one chosen. */
  onMove: (tab: MainTab, to: number) => void;
  /** Asks the column's "+" to open its menu, as ⌘T does. */
  onNewTab: () => void;
  /** Says the "+" opened its menu on the ask. */
  onNewTabAnswered: () => void;
}

/** What the open plan holds for the tabs: its id, its agents, or nothing while unread, and its draft's key. */
interface DrawnTabs {
  planId: string | undefined;
  agents: readonly string[] | undefined;
  draft: string | undefined;
}

/** The plan's choices. */
function choicesOn(held: HeldState, planId: string | undefined): PlanChoices {
  return planId === undefined ? NO_CHOICES : (held.plans[planId] ?? NO_CHOICES);
}

/**
 * The state with the plan's choices changed, that plan's kept latest and the
 * oldest plan's let go past the bound. With no plan open there is nothing to
 * keep a choice on, and a change that answers the choices it was handed
 * changes nothing.
 */
function withChoices(
  held: HeldState,
  planId: string | undefined,
  change: (was: PlanChoices) => PlanChoices,
): HeldState {
  if (planId === undefined) return held;
  const was = choicesOn(held, planId);
  const choice = change(was);
  if (choice === was) return held;
  const kept = Object.entries(held.plans).filter(([plan]) => plan !== planId);
  return {
    ...held,
    plans: Object.fromEntries([...kept, [planId, choice] as const].slice(-PLANS_KEPT)),
  };
}

/** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
function openAgentsOf(held: HeldState, agents: readonly string[] | undefined) {
  return agents?.filter((agent) => !held.closedAgents.includes(agent));
}

/** The strip in its order: the plan's tab, then the open agents' and the draft's in the plan's order. */
function stripOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  const agents = (openAgentsOf(held, drawn.agents) ?? []).map((agent) => ({ agent }));
  const draft = drawn.draft === undefined ? [] : [{ draft: drawn.draft }];
  const order = choicesOn(held, drawn.planId).order ?? NO_TABS;
  return [MAIN_TAB.PLAN, ...inPlanOrder([...agents, ...draft], order, (tab) => tab)];
}

/** Whether the tab stands on the plan now, an agent's whose tab is not closed doing so while the agents are unread. */
function stands(held: HeldState, drawn: DrawnTabs, tab: MainTab): boolean {
  if (isAgentTab(tab) && drawn.agents === undefined) return !held.closedAgents.includes(tab.agent);
  return stripOf(held, drawn).some((each) => sameTab(each, tab));
}

/** The tab shown on the plan: the latest it viewed that still stands, else the plan's. */
function shownIn(held: HeldState, drawn: DrawnTabs): MainTab {
  const recent = choicesOn(held, drawn.planId).recent ?? NO_TABS;
  return recent.findLast((tab) => stands(held, drawn, tab)) ?? MAIN_TAB.PLAN;
}

/** The state with the tabs viewed on the plan, in the order given, as its latest. */
function withViewed(
  held: HeldState,
  planId: string | undefined,
  viewed: readonly MainTab[],
): HeldState {
  return withChoices(held, planId, (was) => {
    const recent = viewedLast(was.recent ?? NO_TABS, viewed, RECENT_KEPT);
    return recent === undefined ? was : { ...was, recent };
  });
}

/** The state with the agent's tab open, where it was closed. */
function withOpened(held: HeldState, tab: MainTab): HeldState {
  if (!isAgentTab(tab) || !held.closedAgents.includes(tab.agent)) return held;
  return { ...held, closedAgents: held.closedAgents.filter((agent) => agent !== tab.agent) };
}

/**
 * The state with the tab shown on the open plan, viewed after the one shown
 * until then. Note that the one shown is viewed too, because the tab a close
 * returns to is the one last looked at, which need never have been chosen:
 * the plan's, or the tab a plan opened on.
 */
function withChosen(held: HeldState, tab: MainTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(withOpened(held, tab), drawn.planId, viewed);
}

/**
 * The state with the tab closed, gone from those viewed on the plan, and
 * the tab viewed before it, or its neighbour, viewed in its place where it
 * was the one shown. Closing an agent's tab closes nothing of the agent's
 * own, and closing a draft's leaves the draft its owner's to let go.
 */
function withoutTab(held: HeldState, tab: MainTab, drawn: DrawnTabs): HeldState {
  if (tab === MAIN_TAB.PLAN) return held;
  const closed = isAgentTab(tab)
    ? { ...held, closedAgents: [...held.closedAgents, tab.agent].slice(-CLOSED_AGENTS_KEPT) }
    : held;
  const forgotten = withChoices(closed, drawn.planId, (was) => ({
    ...was,
    recent: (was.recent ?? NO_TABS).filter((each) => !sameTab(each, tab)),
  }));
  if (!sameTab(shownIn(held, drawn), tab)) return forgotten;
  const standing = stripOf(forgotten, drawn).filter((each) => !sameTab(each, tab));
  const recent = choicesOn(forgotten, drawn.planId).recent ?? NO_TABS;
  const replacement = replacementOf(standing, recent, stripOf(held, drawn), tab) ?? MAIN_TAB.PLAN;
  return withViewed(forgotten, drawn.planId, [replacement]);
}

/** The state with the tab moved to `to` among the tabs after the plan's, kept as the plan's order (`movedOrder`). */
function withTabAt(held: HeldState, tab: MainTab, to: number, drawn: DrawnTabs): HeldState {
  const movable = stripOf(held, drawn).filter((each) => each !== MAIN_TAB.PLAN);
  const was = choicesOn(held, drawn.planId).order ?? NO_TABS;
  const order = movedOrder(was, movable, tab, to);
  return order === undefined
    ? held
    : withChoices(held, drawn.planId, (choices) => ({ ...choices, order }));
}

/** Whether a tab is kept across a launch: the plan's or an agent's, the kinds that stand again after it. */
function keptTab(tab: MainTab): tab is Exclude<MainTab, DraftStripTab> {
  return !isDraftTab(tab);
}

/** What is kept of the state: every plan's choices without a draft's tab, and neither list where a plan has none. */
function stored(held: HeldState): MainTabsState {
  const kept = (tabs: readonly MainTab[] = NO_TABS) => {
    const each = tabs.filter(keptTab);
    return each.length === 0 ? undefined : each;
  };
  return {
    closedAgents: held.closedAgents,
    plans: Object.fromEntries(
      Object.entries(held.plans).map(([plan, { recent, order }]) => [
        plan,
        { recent: kept(recent), order: kept(order) },
      ]),
    ),
  };
}

/** What storage holds under the key, or nothing where it refuses the read. */
function storedText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The agents' tabs as the side panel's record kept them before this column
 * held them: the agents whose tabs were closed, and each plan's agents in
 * the order it moved and viewed them, the plan's tab viewed after them.
 * Note that it is viewed last, because the column showed the plan's
 * document until now, and a plan should open as it did; and that a fixed
 * kind's word is the side panel's and stays there.
 */
function fromSidePanel(record: typeof sidePanelAgentsSchema.Type): HeldState {
  const agentsIn = (tabs: readonly (typeof sidePanelTabSchema.Type)[] = []) =>
    tabs.flatMap((tab) => (isAgentTab(tab) ? [{ agent: tab.agent }] : []));
  const plans = Object.entries(record.plans ?? {}).flatMap(([plan, { recent, order }]) => {
    const viewed = agentsIn(recent);
    const moved = agentsIn(order);
    if (viewed.length === 0 && moved.length === 0) return [];
    const choices: PlanChoices = {
      recent: [...viewed, MAIN_TAB.PLAN],
      ...(moved.length === 0 ? undefined : { order: moved }),
    };
    return [[plan, choices] as const];
  });
  return { closedAgents: record.closedAgents ?? [], plans: Object.fromEntries(plans) };
}

/** The kept preference, or what the side panel's record kept of the agents' tabs where none is, or nothing. */
function readStored(): HeldState {
  return Option.getOrElse(decodeStored(storedText(STORAGE_KEY)), () =>
    Option.match(decodeSidePanel(storedText(SIDE_PANEL_KEY)), {
      onNone: () => NOTHING_KEPT,
      onSome: fromSidePanel,
    }),
  );
}

/**
 * The column's tabs over the open plan: `planId`, none while no plan is
 * open, `agents` its agents by id in the order started, or nothing while
 * unread, and `draft` its draft agent's key, if it holds one. A fixture
 * run's column keeps nothing, and starts from nothing.
 */
export function useMainTabs(
  fixture: boolean,
  planId: string | undefined,
  agents: readonly string[] | undefined,
  draft: string | undefined,
): MainTabsControl {
  // Note that a fixture run's column is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [staged, setStaged] = useState<HeldState>(NOTHING_KEPT);
  const [newTabAsked, setNewTabAsked] = useState(false);
  const state = fixture ? staged : kept;
  const update = useCallback(
    (change: (held: HeldState) => HeldState) => (fixture ? setStaged : setKept)(change),
    [fixture],
  );
  const drawn = useMemo(() => ({ planId, agents, draft }), [planId, agents, draft]);
  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (fixture) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
    } catch {
      // The column keeps working on the state it holds.
    }
  }, [fixture, kept]);

  const tabs = useMemo(() => stripOf(state, drawn), [state, drawn]);
  const openAgents = useMemo(() => openAgentsOf(state, agents), [state, agents]);
  const onChoose = useCallback(
    (tab: MainTab) => update((held) => withChosen(held, tab, drawn)),
    [update, drawn],
  );
  // Note that a tab shown on another plan is not counted viewed after the
  // open plan's, because the plan it is viewed on is the one about to open.
  const onShow = useCallback(
    (on: string, tab: AgentStripTab) =>
      update((held) =>
        on === planId ? withChosen(held, tab, drawn) : withViewed(withOpened(held, tab), on, [tab]),
      ),
    [update, drawn, planId],
  );
  const onClose = useCallback(
    (tab: MainTab) => update((held) => withoutTab(held, tab, drawn)),
    [update, drawn],
  );
  const onMove = useCallback(
    (tab: MainTab, to: number) => update((held) => withTabAt(held, tab, to, drawn)),
    [update, drawn],
  );
  const onNewTab = useCallback(() => setNewTabAsked(true), []);
  const onNewTabAnswered = useCallback(() => setNewTabAsked(false), []);
  return {
    tabs,
    tab: shownIn(state, drawn),
    openAgents,
    newTabAsked,
    onChoose,
    onShow,
    onClose,
    onMove,
    onNewTab,
    onNewTabAnswered,
  };
}
