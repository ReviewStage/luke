import {
  type AgentStripTab,
  type DraftStripTab,
  inTaskOrder,
  isAgentTab,
  isDraftTab,
  movedOrder,
  replacementOf,
  sameTab,
  viewedLast,
} from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * use-main-tabs.ts -- the plan's column's tabs: the plan's own, then each of its coding agents and its draft agent, which is chosen, and the order they stand in, kept per plan across launches.
 *
 * The column draws the open plan's document under the plan's tab, and each
 * coding agent started on the plan under a tab of its own, as an editor
 * draws its files, so an agent's transcript and composer take the room the
 * plan is read in rather than a corner of it. The plan's tab stands first
 * while open: it never moves, and no tab is dropped before it. It closes as
 * any tab does while another stands beside it, and stays closed on that plan
 * until it is chosen again, from the "+", a link, or the sidebar; a column
 * is never left with no tab, so the plan's stands again whenever nothing
 * else does, and a column whose every other tab closes is back on the plan.
 * The agents' tabs follow it, one per agent in the order started, and a
 * draft agent's, opened from the column's "+", after them while the open
 * plan holds the draft.
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
 * viewing it on its plan. An agent's tab stands only once the plan's agents
 * are read and hold it, so the column never shows an agent its strip draws
 * no tab for: a plan opened on an agent shows its document while the list
 * is on its way, and stays on it where the read fails.
 *
 * The plan's Inbox tab, everything its agents need of the developer,
 * answered in place (`inbox-pane.tsx`), stands only once it has something
 * to show: it is closed on a plan until an item the developer has not seen
 * waits there (`onInboxRead`), and then opens as a tab the "+" opens does,
 * after every tab standing, chosen. An item has not been seen where it did
 * not wait at the plan's last read: one just posted, or one answered and
 * posted again, but not one its agent changed while it waited. It is a tab
 * like an agent's in every other way: it closes, and then stays closed on
 * that plan until such an item waits, and it is dragged among the others.
 * The "+" opens it again at any time, after every tab, and chooses it where
 * it stands open, moving it nowhere; an item arriving while it stands open
 * only counts on it. Each plan keeps whether its Inbox is open and the
 * items that waited at its last read, so a closed Inbox stays closed across
 * a launch. A plan with no agent has no Inbox, since only an agent posts,
 * unless main's read of what waits across the account says an item waits
 * on it, which an agent started on another Mac posts before this window
 * has read the plan's agents again.
 *
 * The tabs after the plan's are dragged or moved from the keyboard among
 * themselves, and the plan keeps the order from then on: an agent's tab
 * closed and opened again stands where it stood, and one never moved
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

/**
 * The column's own tabs, each one word beside the agents' and the draft's
 * objects: the plan's, and its Inbox, which stands while open on a plan
 * with an agent, since only an agent posts.
 */
export const MAIN_TAB = {
  PLAN: "plan",
  INBOX: "inbox",
} as const;

/** The plan's own tab, or its Inbox. */
type OwnMainTab = (typeof MAIN_TAB)[keyof typeof MAIN_TAB];

/** A tab of the plan's column: the plan's own, its Inbox, one agent's, or the draft agent's. */
export type MainTab = OwnMainTab | AgentStripTab | DraftStripTab;

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
const TASKS_KEPT = 500;

/** A tab as it is kept across a launch: the plan's, or an agent's; a draft's is kept nowhere. */
const keptTabSchema = Schema.Union([
  Schema.Literals(Object.values(MAIN_TAB)),
  Schema.Struct({ agent: Schema.String }),
]);

/**
 * One plan's choices: the tabs viewed on it, the latest last, its order
 * since a tab was first moved on it, whether its Inbox is open, the items
 * that waited in its inbox at its last read, by id, and whether its own tab
 * was closed.
 */
const taskChoicesSchema = Schema.Struct({
  recent: Schema.optional(Schema.Array(keptTabSchema)),
  order: Schema.optional(Schema.Array(keptTabSchema)),
  inboxOpen: Schema.optional(Schema.Boolean),
  inboxSeen: Schema.optional(Schema.Array(Schema.String)),
  planClosed: Schema.optional(Schema.Boolean),
});

/** The agents whose tabs were closed, every plan's, and each plan's choices, by plan id. */
const mainTabsSchema = Schema.Struct({
  closedAgents: Schema.Array(Schema.String),
  tasks: Schema.Record(Schema.String, taskChoicesSchema),
});

type MainTabsState = typeof mainTabsSchema.Type;

/** One plan's choices as the hook holds them, the draft's tab among them until a launch. */
interface TaskChoices {
  readonly recent?: readonly MainTab[] | undefined;
  readonly order?: readonly MainTab[] | undefined;
  readonly inboxOpen?: boolean | undefined;
  readonly inboxSeen?: readonly string[] | undefined;
  readonly planClosed?: boolean | undefined;
}

/** The state the hook holds: the kept one, with a draft's tab possibly among a plan's choices. */
interface HeldState {
  readonly closedAgents: readonly string[];
  readonly tasks: Readonly<Record<string, TaskChoices>>;
}

/** A side panel tab as an earlier version kept it: a fixed kind's word, or an agent's. */
const sidePanelTabSchema = Schema.Union([Schema.String, Schema.Struct({ agent: Schema.String })]);

/** Each task's agents' tabs as an earlier version's side panel record kept them. */
const sidePanelTaskTabsSchema = Schema.optional(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      recent: Schema.optional(Schema.Array(sidePanelTabSchema)),
      order: Schema.optional(Schema.Array(sidePanelTabSchema)),
    }),
  ),
);

/** What of the side panel's record an earlier version kept of the agents' tabs, under `plans` before tasks had their name. */
const sidePanelAgentsSchema = Schema.Struct({
  closedAgents: Schema.optional(Schema.Array(Schema.String)),
  tasks: sidePanelTaskTabsSchema,
  plans: sidePanelTaskTabsSchema,
});

/** The kept preference as it is read: one written before tasks had their name keeps them under `plans`. */
const keptMainTabsSchema = Schema.Struct({
  closedAgents: Schema.Array(Schema.String),
  tasks: Schema.optional(mainTabsSchema.fields.tasks),
  plans: Schema.optional(mainTabsSchema.fields.tasks),
});

const storedMainTabs = Schema.fromJsonString(mainTabsSchema);
const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(keptMainTabsSchema));
const decodeSidePanel = Schema.decodeUnknownOption(Schema.fromJsonString(sidePanelAgentsSchema));
const encodeStored = Schema.encodeSync(storedMainTabs);

/** A window that has kept nothing, and a fixture run's column. */
const NOTHING_KEPT: HeldState = { closedAgents: [], tasks: {} };

/** A plan the developer has chosen nothing on. */
const NO_CHOICES: TaskChoices = {};

/** A plan no tab was moved on, or viewed. */
const NO_TABS: readonly MainTab[] = [];

/** An inbox read with nothing waiting, or never read. */
const NO_ITEMS: readonly string[] = [];

/** What the column draws and hands back. */
export interface MainTabsControl {
  /** The column's tabs in the strip's order: the plan's first where open, then the open agents', the draft's, and the Inbox where open, in the plan's order. */
  tabs: readonly MainTab[];
  /** The tab shown. */
  tab: MainTab;
  /** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
  openAgents: readonly string[] | undefined;
  /** Whether ⌘T asked for the column's "+" menu and the "+" has not yet opened it. */
  newTabAsked: boolean;
  /** Shows the tab, opening an agent's where it was closed. */
  onChoose: (tab: MainTab) => void;
  /** Shows the tab on the plan given, as `onChoose` does on the open plan: what a pin, a notification, or the call card asks, the plan opened beside it. */
  onShow: (taskId: string, tab: MainTab) => void;
  /** Closes the tab, and only the view: an agent goes on as it was, and the Inbox keeps its items. The plan's tab closes only while another stands. */
  onClose: (tab: MainTab) => void;
  /** Hears what a read of the plan's inbox found waiting, by id, opening and choosing its Inbox where an item did not wait at the last read. */
  onInboxRead: (taskId: string, waiting: readonly string[]) => void;
  /** Moves a tab other than the plan's to the place `to` among them, after the plan's, leaving the chosen one chosen. */
  onMove: (tab: MainTab, to: number) => void;
  /** Asks the column's "+" to open its menu, as ⌘T does. */
  onNewTab: () => void;
  /** Says the "+" opened its menu on the ask. */
  onNewTabAnswered: () => void;
}

/** What the open plan holds for the tabs: its id, its agents, or nothing while unread, its draft's key, and whether an inbox item waits on it. */
interface DrawnTabs {
  taskId: string | undefined;
  agents: readonly string[] | undefined;
  draft: string | undefined;
  waiting: boolean;
  /** Whether the plan holds an agent, an archived one included, whose Inbox items still stand. */
  holds: boolean;
}

/** The plan's choices. */
function choicesOn(held: HeldState, taskId: string | undefined): TaskChoices {
  return taskId === undefined ? NO_CHOICES : (held.tasks[taskId] ?? NO_CHOICES);
}

/**
 * The state with the plan's choices changed, that plan's kept latest and the
 * oldest plan's let go past the bound. With no plan open there is nothing to
 * keep a choice on, and a change that answers the choices it was handed
 * changes nothing.
 */
function withChoices(
  held: HeldState,
  taskId: string | undefined,
  change: (was: TaskChoices) => TaskChoices,
): HeldState {
  if (taskId === undefined) return held;
  const was = choicesOn(held, taskId);
  const choice = change(was);
  if (choice === was) return held;
  const kept = Object.entries(held.tasks).filter(([task]) => task !== taskId);
  return {
    ...held,
    tasks: Object.fromEntries([...kept, [taskId, choice] as const].slice(-TASKS_KEPT)),
  };
}

/** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
function openAgentsOf(held: HeldState, agents: readonly string[] | undefined) {
  return agents?.filter((agent) => !held.closedAgents.includes(agent));
}

/**
 * The strip in its order: the plan's tab unless it was closed, then the
 * open agents', the draft's, and the Inbox where open on a plan with an
 * agent, an archived one included, in the plan's order. Note that the
 * plan's tab stands whenever nothing else does, closed or not, so the
 * column always has a tab to show.
 */
function stripOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  const choices = choicesOn(held, drawn.taskId);
  const agents = (openAgentsOf(held, drawn.agents) ?? []).map((agent) => ({ agent }));
  const draft = drawn.draft === undefined ? [] : [{ draft: drawn.draft }];
  const inbox = choices.inboxOpen === true && (drawn.holds || drawn.waiting);
  const order = choices.order ?? NO_TABS;
  const others = inTaskOrder(
    [...agents, ...draft, ...(inbox ? [MAIN_TAB.INBOX] : [])],
    order,
    (tab) => tab,
  );
  return choices.planClosed === true && others.length > 0 ? others : [MAIN_TAB.PLAN, ...others];
}

/** Whether the tab stands in the plan's strip now. */
function stands(held: HeldState, drawn: DrawnTabs, tab: MainTab): boolean {
  return stripOf(held, drawn).some((each) => sameTab(each, tab));
}

/** The tab shown on the plan: the latest it viewed that still stands, else the strip's first. */
function shownIn(held: HeldState, drawn: DrawnTabs): MainTab {
  const recent = choicesOn(held, drawn.taskId).recent ?? NO_TABS;
  return (
    recent.findLast((tab) => stands(held, drawn, tab)) ?? stripOf(held, drawn)[0] ?? MAIN_TAB.PLAN
  );
}

/** The state with the tabs viewed on the plan, in the order given, as its latest. */
function withViewed(
  held: HeldState,
  taskId: string | undefined,
  viewed: readonly MainTab[],
): HeldState {
  return withChoices(held, taskId, (was) => {
    const recent = viewedLast(was.recent ?? NO_TABS, viewed, RECENT_KEPT);
    return recent === undefined ? was : { ...was, recent };
  });
}

/**
 * The plan's order with its Inbox after every tab: the tabs the order held
 * but the Inbox, then those the strip draws that it did not, as they stand,
 * so every other tab stays where it stood. Note that on a plan whose agents
 * are unread the Inbox is only let out of the order, because no strip is
 * known to stand after, and a tab the order does not hold stands after
 * those it does.
 */
function inboxLast(held: HeldState, drawn: DrawnTabs, was: readonly MainTab[]): readonly MainTab[] {
  const others = was.filter((tab) => tab !== MAIN_TAB.INBOX);
  if (drawn.agents === undefined) return others;
  const unplaced = stripOf(held, drawn).filter(
    (tab) =>
      tab !== MAIN_TAB.PLAN && tab !== MAIN_TAB.INBOX && !was.some((other) => sameTab(other, tab)),
  );
  return [...others, ...unplaced, MAIN_TAB.INBOX];
}

/**
 * The state with the agent's tab, the plan's Inbox, or the plan's own tab
 * open, where it was closed. The Inbox opens after every tab of the plan's
 * strip, wherever it stood before it closed, and the plan's own first.
 */
function withOpened(held: HeldState, drawn: DrawnTabs, tab: MainTab): HeldState {
  if (tab === MAIN_TAB.PLAN)
    return withChoices(held, drawn.taskId, (was) =>
      was.planClosed === true ? { ...was, planClosed: undefined } : was,
    );
  if (tab === MAIN_TAB.INBOX)
    return withChoices(held, drawn.taskId, (was) =>
      was.inboxOpen === true
        ? was
        : { ...was, inboxOpen: true, order: inboxLast(held, drawn, was.order ?? NO_TABS) },
    );
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
  return withViewed(withOpened(held, drawn, tab), drawn.taskId, viewed);
}

/** What a plan other than the open one holds for the tabs, which is unread. */
function unreadTask(taskId: string): DrawnTabs {
  return { taskId, agents: undefined, draft: undefined, waiting: false, holds: false };
}

/**
 * The state with the tab shown on the plan given: on the open plan as
 * `withChosen` shows it, and on another as the tab it will open on.
 */
function withShown(held: HeldState, on: string, tab: MainTab, drawn: DrawnTabs): HeldState {
  if (on === drawn.taskId) return withChosen(held, tab, drawn);
  return withViewed(withOpened(held, unreadTask(on), tab), on, [tab]);
}

/**
 * The state with `waiting`, the items waiting in the plan's inbox by id,
 * seen, and its Inbox opened and chosen where one did not wait at its last
 * read; an Inbox already open only sees them. Note that an item answered
 * leaves what is kept as it settles, so posted again it is new, and that a
 * plan that has read nothing has seen no item, so its first opens its Inbox.
 */
function withInboxRead(
  held: HeldState,
  on: string,
  waiting: readonly string[],
  drawn: DrawnTabs,
): HeldState {
  const was = choicesOn(held, on);
  const seen = was.inboxSeen ?? NO_ITEMS;
  const fresh = waiting.some((item) => !seen.includes(item));
  if (!fresh && waiting.length === seen.length) return held;
  const read = withChoices(held, on, (choices) => ({ ...choices, inboxSeen: waiting }));
  return fresh && was.inboxOpen !== true ? withShown(read, on, MAIN_TAB.INBOX, drawn) : read;
}

/**
 * The state with the tab closed, gone from those viewed on the plan, and
 * the tab viewed before it, or its neighbour, viewed in its place where it
 * was the one shown. Closing an agent's tab closes nothing of the agent's
 * own, closing a draft's leaves the draft its owner's to let go, and
 * closing the Inbox keeps what it has seen, so only a newer item opens it.
 * The plan's own tab closes only while another stands, and a close that
 * leaves no other tab standing opens the plan's again, so it stays open
 * once another tab opens beside it.
 */
function withoutTab(held: HeldState, tab: MainTab, drawn: DrawnTabs): HeldState {
  const before = stripOf(held, drawn);
  if (tab === MAIN_TAB.PLAN && !before.some((each) => each !== MAIN_TAB.PLAN)) return held;
  const closed = isAgentTab(tab)
    ? { ...held, closedAgents: [...held.closedAgents, tab.agent].slice(-CLOSED_AGENTS_KEPT) }
    : held;
  const forgotten = withChoices(closed, drawn.taskId, (was) => ({
    ...was,
    recent: (was.recent ?? NO_TABS).filter((each) => !sameTab(each, tab)),
    ...(tab === MAIN_TAB.INBOX ? { inboxOpen: false } : undefined),
    ...(tab === MAIN_TAB.PLAN ? { planClosed: true } : undefined),
  }));
  // Note that the draft's tab stands until its owner lets the draft go, so it is left out here.
  const standing = stripOf(forgotten, drawn).filter((each) => !sameTab(each, tab));
  const settled = standing.some((each) => each !== MAIN_TAB.PLAN)
    ? forgotten
    : withOpened(forgotten, drawn, MAIN_TAB.PLAN);
  if (!sameTab(shownIn(held, drawn), tab)) return settled;
  const recent = choicesOn(settled, drawn.taskId).recent ?? NO_TABS;
  const replacement = replacementOf(standing, recent, before, tab) ?? MAIN_TAB.PLAN;
  return withViewed(settled, drawn.taskId, [replacement]);
}

/** The state with the tab moved to `to` among the tabs after the plan's, kept as the plan's order (`movedOrder`). */
function withTabAt(held: HeldState, tab: MainTab, to: number, drawn: DrawnTabs): HeldState {
  const movable = stripOf(held, drawn).filter((each) => each !== MAIN_TAB.PLAN);
  const was = choicesOn(held, drawn.taskId).order ?? NO_TABS;
  const order = movedOrder(was, movable, tab, to);
  return order === undefined
    ? held
    : withChoices(held, drawn.taskId, (choices) => ({ ...choices, order }));
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
    tasks: Object.fromEntries(
      Object.entries(held.tasks).map(
        ([task, { recent, order, inboxOpen, inboxSeen, planClosed }]) => [
          task,
          { recent: kept(recent), order: kept(order), inboxOpen, inboxSeen, planClosed },
        ],
      ),
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
  const tasks = Object.entries(record.tasks ?? record.plans ?? {}).flatMap(
    ([task, { recent, order }]) => {
      const viewed = agentsIn(recent);
      const moved = agentsIn(order);
      if (viewed.length === 0 && moved.length === 0) return [];
      const choices: TaskChoices = {
        recent: [...viewed, MAIN_TAB.PLAN],
        ...(moved.length === 0 ? undefined : { order: moved }),
      };
      return [[task, choices] as const];
    },
  );
  return { closedAgents: record.closedAgents ?? [], tasks: Object.fromEntries(tasks) };
}

/** The kept preference, or what the side panel's record kept of the agents' tabs where none is, or nothing. */
function readStored(): HeldState {
  const kept = Option.map(
    decodeKept(storedText(STORAGE_KEY)),
    ({ closedAgents, tasks, plans }): HeldState => ({ closedAgents, tasks: tasks ?? plans ?? {} }),
  );
  return Option.getOrElse(kept, () =>
    Option.match(decodeSidePanel(storedText(SIDE_PANEL_KEY)), {
      onNone: () => NOTHING_KEPT,
      onSome: fromSidePanel,
    }),
  );
}

/**
 * The column's tabs over the open plan: `planId`, none while no plan is
 * open, `agents` its agents by id in the order started, or nothing while
 * unread, `draft` its draft agent's key, if it holds one, `waiting`
 * whether an inbox item waits on it, and `held` every agent it holds, an
 * archived one among them, which its Inbox stands on too, the standing
 * ones where unsaid. A fixture run's column keeps nothing,
 * and starts from nothing.
 */
export function useMainTabs(
  fixture: boolean,
  taskId: string | undefined,
  agents: readonly string[] | undefined,
  draft: string | undefined,
  waiting: boolean,
  held: readonly string[] | undefined = agents,
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
  const holds = (held?.length ?? 0) > 0;
  const drawn = useMemo(
    () => ({ taskId, agents, draft, waiting, holds }),
    [taskId, agents, draft, waiting, holds],
  );
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
    (on: string, tab: MainTab) => update((held) => withShown(held, on, tab, drawn)),
    [update, drawn],
  );
  const onClose = useCallback(
    (tab: MainTab) => update((held) => withoutTab(held, tab, drawn)),
    [update, drawn],
  );
  const onInboxRead = useCallback(
    (on: string, waiting: readonly string[]) =>
      update((held) => withInboxRead(held, on, waiting, drawn)),
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
    onInboxRead,
    onMove,
    onNewTab,
    onNewTabAnswered,
  };
}
