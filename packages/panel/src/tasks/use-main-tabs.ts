import {
  type AgentStripTab,
  type DraftStripTab,
  inTaskOrder,
  isAgentTab,
  isDraftTab,
  movedOrder,
  replacementOf,
  type StripTab,
  sameTab,
  stampedViewed,
  type ViewedAt,
  viewedLast,
  withoutViewedAt,
} from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * use-main-tabs.ts -- the task's column's tabs: its Overview, each of its agents, and its draft agent, which is chosen, and the order they stand in, kept per task across launches.
 *
 * The task frames the column, as a workspace frames an editor's: its
 * Overview leads the strip, holding the task's plan document, its head, its
 * agents, and its body, and each agent started on the task stands under a
 * tab of its own after it, as an editor draws its files, so an agent's
 * transcript, its calls, and its composer take the room the task is worked
 * in. What supports them, the task's Inbox and the plan's comments among it,
 * stands in the side panel (`use-side-panel.ts`). Overview always stands
 * and never closes nor moves; the agents' tabs stand one per agent in the
 * order started, and a draft agent's, opened from the column's "+", after
 * them while the open task holds the draft. A task none of whose tabs viewed
 * still stands shows its Overview, and never opens a draft by itself: a
 * draft stands only once the "+" asks for one, and one left holding nothing
 * closes (`use-tasks-tab.ts`).
 *
 * An agent's tab closes as an editor's does, which closes the view and
 * leaves the agent running, and the "+" opens it again; the agents whose
 * tabs were closed are kept, so a closed tab stays closed across a launch,
 * and an agent started since opens its tab. A draft's tab is kept nowhere,
 * and closing it lets the draft go, which is its owner's to do. Closing the
 * chosen tab chooses the one viewed before it on that task that still
 * stands, and only where none does its neighbour (`replacementOf`), so a
 * column whose last tab closes is back on a draft.
 *
 * The tab chosen is each task's own: the latest it viewed that still
 * stands, the strip's last where none does. So opening a task from the
 * sidebar shows it as the developer left it, and an
 * agent a notification, a pin, or a Start names is shown by viewing it on
 * its task. An agent's tab stands only once the task's agents are read and
 * hold it, so the column never shows an agent its strip draws no tab for: a
 * task opened on an agent waits on the list in the agent's shape, and shows
 * its Overview where the read fails. Before the list answers, the task's row
 * in the sidebar may already settle which tab it will be (`NamedAgents`):
 * the agent last viewed, where the row names it, or the task's one agent,
 * where none viewed stands. The column then shows it
 * at once, its transcript read beside the list, and only where the row
 * cannot settle it does the column wait.
 *
 * The agents' tabs are dragged or moved from the keyboard among themselves,
 * always after Overview, and the task keeps the order from then on: an
 * agent's tab closed and opened again stands where it stood, and one never
 * moved stands after those that were.
 *
 * These facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage, read once at
 * mount. The plan's own tab, the Inbox, the task's Call, and its Chat once
 * stood here (`RETIRED_MAIN_TAB`), the plan's under the word `plan`, which
 * is why Overview, holding the plan now, is kept under a word of its own; what
 * a launch kept of them reads and is let go, so every other choice it holds
 * still stands. The agents' tabs once stood in
 * the side panel, whose record kept them; a window with no record of its own
 * reads theirs from there once. A fixture run neither reads nor writes
 * them: its tasks have no agents, and a capture must not depend on how the
 * last run left the column. ⌘T's ask for the column's "+" is a moment's,
 * kept nowhere.
 *
 * Each task also keeps when each of its tabs was last viewed, and the
 * agents whose tabs closed because nobody looked at them for a day
 * (`use-idle-tabs.ts`), which the agent waking opens again; a tab the
 * developer closes or opens is no longer one of those.
 */

/**
 * The column's own tabs, named by a word: the task's Overview, holding its
 * plan document, which leads the strip on every task. Note that it is not
 * spelled `plan`, the word a retired tab was kept under below.
 */
export const MAIN_TAB = {
  OVERVIEW: "overview",
} as const;

/** The task's Overview tab. */
export type OverviewTab = typeof MAIN_TAB.OVERVIEW;

/** Whether a tab is the task's Overview. */
export function isOverviewTab(tab: StripTab | undefined): tab is OverviewTab {
  return tab === MAIN_TAB.OVERVIEW;
}

/**
 * The column's own tabs an earlier version had and this one does not, which
 * what it kept may still name: the plan's own, whose document Overview
 * holds now, and the Inbox, which stands in the side panel, the task's Call, whose calls every agent's tab takes
 * now, and the task's Chat, gone with Chat. Note that a
 * kind is retired here rather than deleted, because a kept state naming one
 * would otherwise not read at all and lose every other choice it holds.
 */
const RETIRED_MAIN_TAB = {
  PLAN: "plan",
  INBOX: "inbox",
  CALL: "call",
  CHAT: "chat",
} as const;

const RETIRED_MAIN_TABS: ReadonlySet<unknown> = new Set(Object.values(RETIRED_MAIN_TAB));

/** A tab of the task's column: its Overview, one agent's, or the draft agent's. */
export type MainTab = OverviewTab | AgentStripTab | DraftStripTab;

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.mainTabs";

/** Where the side panel keeps its own, which held the agents' tabs before this column did. */
const SIDE_PANEL_KEY = "luke.sidePanel";

/**
 * How many agents whose tabs were closed are kept, the latest closed. Note
 * that the agents are every task's, so the list is held to a bound rather
 * than growing with every agent ever closed; one past it opens again.
 */
const CLOSED_AGENTS_KEPT = 500;

/**
 * How many tabs a task keeps as viewed, the latest viewed. Note that a tab
 * closed leaves the list as it closes, so the bound only lets go of tabs
 * long unviewed, which a close then passes over for its neighbour.
 */
const RECENT_KEPT = 20;

/**
 * How many tasks' own choices are kept, the latest chosen. Note that a task
 * deleted leaves its entry behind, so the record is held to a bound rather
 * than growing with every task ever opened.
 */
const TASKS_KEPT = 500;

/**
 * How many tabs a task keeps the time it last viewed, the latest viewed.
 * Note that a tab past it counts as viewed when next stamped, which only
 * keeps it open longer.
 */
const VIEWED_KEPT = 50;

/** A tab as it is kept across a launch: Overview or an agent's; a draft's is kept nowhere. */
const keptTabSchema = Schema.Union([
  Schema.Struct({ agent: Schema.String }),
  Schema.Literal(MAIN_TAB.OVERVIEW),
]);

/** When a kept tab was last viewed, in epoch milliseconds. */
const keptViewedSchema = Schema.Struct({ tab: keptTabSchema, at: Schema.Number });

/** A tab as it is read: one of today's, or one retired, which reads and is then let go (`currentTasks`). */
const readTabSchema = Schema.Union([
  keptTabSchema,
  Schema.Literals(Object.values(RETIRED_MAIN_TAB)),
]);

/**
 * One task's choices: the tabs viewed on it, the latest last, and its order
 * since a tab was first moved on it. Note that what an earlier version kept
 * of the plan's tab, the Inbox, the Call, and whether the Chat was open
 * beside these is left unread.
 */
const taskChoicesSchema = Schema.Struct({
  recent: Schema.optional(Schema.Array(keptTabSchema)),
  order: Schema.optional(Schema.Array(keptTabSchema)),
  viewedAt: Schema.optional(Schema.Array(keptViewedSchema)),
});

/** One task's choices as they are read, a retired tab among those viewed and moved. */
const readChoicesSchema = Schema.Struct({
  ...taskChoicesSchema.fields,
  recent: Schema.optional(Schema.Array(readTabSchema)),
  order: Schema.optional(Schema.Array(readTabSchema)),
});

/** The agents whose tabs were closed, every task's, those of them closed for being idle, and each task's choices, by task id. */
const mainTabsSchema = Schema.Struct({
  closedAgents: Schema.Array(Schema.String),
  dozing: Schema.optional(Schema.Array(Schema.String)),
  tasks: Schema.Record(Schema.String, taskChoicesSchema),
});

type MainTabsState = typeof mainTabsSchema.Type;

/** One task's choices as the hook holds them, the draft's tab among them until a launch. */
interface TaskChoices {
  readonly recent?: readonly MainTab[] | undefined;
  readonly order?: readonly MainTab[] | undefined;
  /** When each tab was last viewed, the latest last. */
  readonly viewedAt?: readonly ViewedAt<MainTab>[] | undefined;
}

/** The state the hook holds: the kept one, with a draft's tab possibly among a task's choices. */
interface HeldState {
  readonly closedAgents: readonly string[];
  /** The agents among `closedAgents` whose tabs closed for being idle, which open again as the agent wakes. */
  readonly dozing: readonly string[];
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
  dozing: Schema.optional(Schema.Array(Schema.String)),
  tasks: Schema.optional(Schema.Record(Schema.String, readChoicesSchema)),
  plans: Schema.optional(Schema.Record(Schema.String, readChoicesSchema)),
});

const storedMainTabs = Schema.fromJsonString(mainTabsSchema);
const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(keptMainTabsSchema));
const decodeSidePanel = Schema.decodeUnknownOption(Schema.fromJsonString(sidePanelAgentsSchema));
const encodeStored = Schema.encodeSync(storedMainTabs);

/** A window that has kept nothing, and a fixture run's column. */
const NOTHING_KEPT: HeldState = { closedAgents: [], dozing: [], tasks: {} };

/** A task the developer has chosen nothing on. */
const NO_CHOICES: TaskChoices = {};

/** A task no tab was moved on, or viewed. */
const NO_TABS: readonly MainTab[] = [];

/** A task none of whose tabs was stamped viewed. */
const NO_STAMPS: readonly ViewedAt<MainTab>[] = [];

/** What the column draws and hands back. */
export interface MainTabsControl {
  /** The column's tabs in the strip's order: Overview, then the open agents' and the draft's, in the task's order. */
  tabs: readonly MainTab[];
  /** The tab shown; none while the agents are read and the tab the task will show waits on them. */
  tab: MainTab | undefined;
  /** The task's agents whose tabs are open, in the order started; nothing while the agents are unread. */
  openAgents: readonly string[] | undefined;
  /** Whether ⌘T asked for the column's "+" menu and the "+" has not yet opened it. */
  newTabAsked: boolean;
  /** Shows the tab, opening an agent's where it was closed. */
  onChoose: (tab: MainTab) => void;
  /** Shows the tab on the task given, as `onChoose` does on the open task: what a pin, a notification, or the call card asks, the task opened beside it. */
  onShow: (taskId: string, tab: MainTab) => void;
  /** Closes the tab, and only the view: an agent goes on as it was; Overview never closes. */
  onClose: (tab: MainTab) => void;
  /** Moves a tab to the place `to` among the tabs after Overview, leaving the chosen one chosen; Overview stays where it leads. */
  onMove: (tab: MainTab, to: number) => void;
  /** Asks the column's "+" to open its menu, as ⌘T does. */
  onNewTab: () => void;
  /** Says the "+" opened its menu on the ask. */
  onNewTabAnswered: () => void;
  /** When each of the open task's tabs was last viewed (`use-idle-tabs.ts`). */
  viewedAt: readonly ViewedAt<MainTab>[];
  /** Stamps the tabs viewed at `at` on the task given, and each of `standing` not stamped yet. */
  onViewedAt: (
    taskId: string,
    viewed: readonly MainTab[],
    standing: readonly MainTab[],
    at: number,
  ) => void;
  /** Closes the agent's tab as `onClose` does, for being idle, so the agent waking opens it again. */
  onDoze: (tab: AgentStripTab) => void;
  /** Opens again the tabs of the agents given that closed for being idle, as each wakes. */
  onWake: (agents: readonly string[]) => void;
}

/**
 * The agents the open task's row in the sidebar names before its list is
 * read: at most a few (`TASK_AGENTS_BOUNDS`), those at work first and then
 * the rest, newest started first within each, and none archived.
 */
export interface NamedAgents {
  /** The agents named, by id, in the row's order. */
  ids: readonly string[];
  /** How many agents the task has in all. */
  total: number;
}

/** What the open task holds for the tabs: its id, its agents, or nothing while unread, what its row names of them meanwhile, and its draft's key. */
interface DrawnTabs {
  taskId: string | undefined;
  agents: readonly string[] | undefined;
  named: NamedAgents | undefined;
  draft: string | undefined;
}

/** The task's choices. */
function choicesOn(held: HeldState, taskId: string | undefined): TaskChoices {
  return taskId === undefined ? NO_CHOICES : (held.tasks[taskId] ?? NO_CHOICES);
}

/**
 * The state with the task's choices changed, that task's kept latest and the
 * oldest task's let go past the bound. With no task open there is nothing to
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

/** The task's agents whose tabs are open, in the order started; nothing while the agents are unread. */
function openAgentsOf(held: HeldState, agents: readonly string[] | undefined) {
  return agents?.filter((agent) => !held.closedAgents.includes(agent));
}

/** The tabs that move in their order: the open agents' and the draft's, in the task's order. */
function movableOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  const choices = choicesOn(held, drawn.taskId);
  const agents = (openAgentsOf(held, drawn.agents) ?? []).map((agent) => ({ agent }));
  const draft = drawn.draft === undefined ? [] : [{ draft: drawn.draft }];
  const order = choices.order ?? NO_TABS;
  return inTaskOrder([...agents, ...draft], order, (tab) => tab);
}

/** The strip in its order: Overview, then the tabs that move (`movableOf`). */
function stripOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  return [MAIN_TAB.OVERVIEW, ...movableOf(held, drawn)];
}

/** Whether the tab stands in the task's strip now. */
function stands(held: HeldState, drawn: DrawnTabs, tab: MainTab): boolean {
  return stripOf(held, drawn).some((each) => sameTab(each, tab));
}

/**
 * The tab shown on the task: the latest it viewed that still stands, else
 * its Overview; none with no task open. Note that a fallback is not counted viewed until it is
 * chosen, and an agent viewed waits on the agents' read, so a task opened on
 * an agent it viewed never shows another first.
 */
function shownIn(held: HeldState, drawn: DrawnTabs): MainTab | undefined {
  if (drawn.taskId === undefined) return undefined;
  if (drawn.agents === undefined) return shownBeforeList(held, drawn);
  const recent = choicesOn(held, drawn.taskId).recent ?? NO_TABS;
  return recent.findLast((tab) => stands(held, drawn, tab)) ?? MAIN_TAB.OVERVIEW;
}

/**
 * Whether the row names every one of the task's agents, so an agent it does
 * not name is none of the task's.
 */
function namesAll(named: NamedAgents): boolean {
  return named.ids.length === named.total;
}

/**
 * The tab the task will show once its agents are read, where its row
 * already settles it, else none, which waits on the read. The latest tab
 * viewed that the row shows standing is it, Overview among them, which
 * always stands; one the row cannot place, an agent it does not name among
 * more than it names, leaves the choice to the read. A task none of whose
 * tabs viewed stands shows its Overview at once.
 */
function shownBeforeList(held: HeldState, drawn: DrawnTabs): MainTab | undefined {
  const { named } = drawn;
  const all = named !== undefined && namesAll(named);
  const recent = choicesOn(held, drawn.taskId).recent ?? NO_TABS;
  for (const tab of [...recent].reverse()) {
    if (isOverviewTab(tab)) return tab;
    if (isDraftTab(tab)) {
      if (tab.draft === drawn.draft) return tab;
      continue;
    }
    if (held.closedAgents.includes(tab.agent)) continue;
    if (named?.ids.includes(tab.agent) === true) return tab;
    // An agent the row does not name may stand where the row names only some of the agents.
    if (!all) return undefined;
  }
  return MAIN_TAB.OVERVIEW;
}

/** The state with the tabs viewed on the task, in the order given, as its latest. */
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

/** The state with the agent's tab open, where it was closed. */
function withOpened(held: HeldState, tab: MainTab): HeldState {
  if (!isAgentTab(tab) || !held.closedAgents.includes(tab.agent)) return held;
  return {
    ...held,
    closedAgents: held.closedAgents.filter((agent) => agent !== tab.agent),
    dozing: held.dozing.filter((agent) => agent !== tab.agent),
  };
}

/** The state with the tabs of the agents given open again, of those whose tabs closed for being idle. */
function withWoken(held: HeldState, agents: readonly string[]): HeldState {
  const woken = held.dozing.filter((agent) => agents.includes(agent));
  if (woken.length === 0) return held;
  return {
    ...held,
    closedAgents: held.closedAgents.filter((agent) => !woken.includes(agent)),
    dozing: held.dozing.filter((agent) => !woken.includes(agent)),
  };
}

/** The state with the tabs stamped viewed on the task (`stampedViewed`). */
function withViewedAt(
  held: HeldState,
  taskId: string | undefined,
  viewed: readonly MainTab[],
  standing: readonly MainTab[],
  at: number,
): HeldState {
  return withChoices(held, taskId, (was) => {
    const viewedAt = stampedViewed(was.viewedAt ?? NO_STAMPS, viewed, standing, at, VIEWED_KEPT);
    return viewedAt === undefined ? was : { ...was, viewedAt };
  });
}

/**
 * The state with the tab shown on the open task, viewed after the one shown
 * until then. Note that the one shown is viewed too, because the tab a close
 * returns to is the one last looked at, which need never have been chosen:
 * the tab a task opened on.
 */
function withChosen(held: HeldState, tab: MainTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = shown === undefined || sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(withOpened(held, tab), drawn.taskId, viewed);
}

/**
 * The state with the tab shown on the task given: on the open task as
 * `withChosen` shows it, and on another as the tab it will open on.
 */
function withShown(held: HeldState, on: string, tab: MainTab, drawn: DrawnTabs): HeldState {
  if (on === drawn.taskId) return withChosen(held, tab, drawn);
  return withViewed(withOpened(held, tab), on, [tab]);
}

/**
 * The state with the tab closed, gone from those viewed on the task, and
 * the tab viewed before it, or its neighbour, viewed in its place where it
 * was the one shown, Overview where no other stands. Overview never closes. Closing an
 * agent's tab closes nothing of the agent's own, and closing a draft's leaves
 * the draft its owner's to let go. An agent's tab closed `dozing`, for being
 * idle, opens again as the agent wakes; one closed by hand does not.
 */
function withoutTab(held: HeldState, tab: MainTab, drawn: DrawnTabs, dozing = false): HeldState {
  if (isOverviewTab(tab)) return held;
  const before = stripOf(held, drawn);
  const closed = isAgentTab(tab)
    ? {
        ...held,
        closedAgents: [...held.closedAgents, tab.agent].slice(-CLOSED_AGENTS_KEPT),
        dozing: [
          ...held.dozing.filter((agent) => agent !== tab.agent),
          ...(dozing ? [tab.agent] : []),
        ].slice(-CLOSED_AGENTS_KEPT),
      }
    : held;
  const forgotten = withChoices(closed, drawn.taskId, (was) => ({
    ...was,
    recent: (was.recent ?? NO_TABS).filter((each) => !sameTab(each, tab)),
    ...(was.viewedAt === undefined ? undefined : { viewedAt: withoutViewedAt(was.viewedAt, tab) }),
  }));
  const shown = shownIn(held, drawn);
  if (shown === undefined || !sameTab(shown, tab)) return forgotten;
  // Note that the draft's tab stands until its owner lets the draft go, so it is left out here.
  const standing = stripOf(forgotten, drawn).filter((each) => !sameTab(each, tab));
  const recent = choicesOn(forgotten, drawn.taskId).recent ?? NO_TABS;
  const replacement = replacementOf(standing, recent, before, tab);
  return replacement === undefined ? forgotten : withViewed(forgotten, drawn.taskId, [replacement]);
}

/**
 * The state with the tab moved to `to` among the tabs after Overview, kept
 * as the task's order (`movedOrder`); Overview leads where it stands.
 */
function withTabAt(held: HeldState, tab: MainTab, to: number, drawn: DrawnTabs): HeldState {
  if (isOverviewTab(tab)) return held;
  const movable = movableOf(held, drawn);
  const was = choicesOn(held, drawn.taskId).order ?? NO_TABS;
  const order = movedOrder(was, movable, tab, to);
  return order === undefined
    ? held
    : withChoices(held, drawn.taskId, (choices) => ({ ...choices, order }));
}

/** Whether a tab is kept across a launch: Overview or an agent's, the kinds that stand again after it. */
function keptTab(tab: MainTab): tab is Exclude<MainTab, DraftStripTab> {
  return !isDraftTab(tab);
}

/** What is kept of the state: every task's choices without a draft's tab, and neither list where a task has none. */
function stored(held: HeldState): MainTabsState {
  const kept = (tabs: readonly MainTab[] = NO_TABS) => {
    const each = tabs.filter(keptTab);
    return each.length === 0 ? undefined : each;
  };
  const stamped = (stamps: readonly ViewedAt<MainTab>[] = NO_STAMPS) => {
    const each = stamps.flatMap(({ tab, at }) => (keptTab(tab) ? [{ tab, at }] : []));
    return each.length === 0 ? undefined : each;
  };
  return {
    closedAgents: held.closedAgents,
    ...(held.dozing.length === 0 ? undefined : { dozing: held.dozing }),
    tasks: Object.fromEntries(
      Object.entries(held.tasks).map(([task, { recent, order, viewedAt }]) => [
        task,
        { recent: kept(recent), order: kept(order), viewedAt: stamped(viewedAt) },
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
 * held them: the agents whose tabs were closed, and each task's agents in
 * the order it moved and viewed them. Note that a fixed kind's word is the
 * side panel's and stays there.
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
        recent: viewed,
        ...(moved.length === 0 ? undefined : { order: moved }),
      };
      return [[task, choices] as const];
    },
  );
  return { closedAgents: record.closedAgents ?? [], dozing: [], tasks: Object.fromEntries(tasks) };
}

/** Whether a kept tab is of a kind this column still has: any but a retired one. */
function current<T>(
  tab: T,
): tab is Exclude<T, (typeof RETIRED_MAIN_TAB)[keyof typeof RETIRED_MAIN_TAB]> {
  return !RETIRED_MAIN_TABS.has(tab);
}

/** Each task's kept choices without the tabs retired since they were kept. */
function currentTasks(
  tasks: Readonly<Record<string, typeof readChoicesSchema.Type>>,
): HeldState["tasks"] {
  return Object.fromEntries(
    Object.entries(tasks).map(([task, { recent, order, viewedAt }]) => [
      task,
      {
        ...(recent === undefined ? undefined : { recent: recent.filter(current) }),
        ...(order === undefined ? undefined : { order: order.filter(current) }),
        ...(viewedAt === undefined ? undefined : { viewedAt }),
      },
    ]),
  );
}

/** The kept preference, or what the side panel's record kept of the agents' tabs where none is, or nothing. */
function readStored(): HeldState {
  const kept = Option.map(
    decodeKept(storedText(STORAGE_KEY)),
    ({ closedAgents, dozing, tasks, plans }): HeldState => ({
      closedAgents,
      dozing: dozing ?? [],
      tasks: currentTasks(tasks ?? plans ?? {}),
    }),
  );
  return Option.getOrElse(kept, () =>
    Option.match(decodeSidePanel(storedText(SIDE_PANEL_KEY)), {
      onNone: () => NOTHING_KEPT,
      onSome: fromSidePanel,
    }),
  );
}

/**
 * The state a fixture run's column draws from: the one it staged, its task
 * viewed on the tab the run names until a tab is chosen on it.
 */
function stagedOn(
  staged: HeldState,
  taskId: string | undefined,
  tab: MainTab | undefined,
): HeldState {
  if (tab === undefined || taskId === undefined || staged.tasks[taskId] !== undefined) {
    return staged;
  }
  return withViewed(staged, taskId, [tab]);
}

/**
 * The column's tabs over the open task: `taskId`, none while no task is
 * open, `agents` its agents by id in the order started, or nothing while
 * unread, `named` what its row names of them meanwhile, and `draft` its
 * draft agent's key, if it holds one. A fixture run's column keeps nothing,
 * and starts from the tab the run names (`fixture`), its Overview where it
 * names none.
 */
export function useMainTabs(
  fixture: { readonly tab: MainTab | undefined } | undefined,
  taskId: string | undefined,
  agents: readonly string[] | undefined,
  named: NamedAgents | undefined,
  draft: string | undefined,
): MainTabsControl {
  // Note that a fixture run's column is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [staged, setStaged] = useState<HeldState>(NOTHING_KEPT);
  const [newTabAsked, setNewTabAsked] = useState(false);
  const staging = fixture !== undefined;
  const fixtureTab = fixture?.tab;
  const fixtureState = useMemo(
    () => stagedOn(staged, taskId, fixtureTab),
    [staged, taskId, fixtureTab],
  );
  const state = staging ? fixtureState : kept;
  const update = useCallback(
    (change: (held: HeldState) => HeldState) =>
      staging ? setStaged((held) => change(stagedOn(held, taskId, fixtureTab))) : setKept(change),
    [staging, taskId, fixtureTab],
  );
  const drawn = useMemo(() => ({ taskId, agents, named, draft }), [taskId, agents, named, draft]);
  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (staging) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
    } catch {
      // The column keeps working on the state it holds.
    }
  }, [staging, kept]);

  const tabs = useMemo(() => stripOf(state, drawn), [state, drawn]);
  const openAgents = useMemo(() => openAgentsOf(state, agents), [state, agents]);
  const onChoose = useCallback(
    (tab: MainTab) => update((held) => withChosen(held, tab, drawn)),
    [update, drawn],
  );
  // Note that a tab shown on another task is not counted viewed after the
  // open task's, because the task it is viewed on is the one about to open.
  const onShow = useCallback(
    (on: string, tab: MainTab) => update((held) => withShown(held, on, tab, drawn)),
    [update, drawn],
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
  const onViewedAt = useCallback(
    (on: string, viewed: readonly MainTab[], standing: readonly MainTab[], at: number) =>
      update((held) => withViewedAt(held, on, viewed, standing, at)),
    [update],
  );
  const onDoze = useCallback(
    (tab: AgentStripTab) => update((held) => withoutTab(held, tab, drawn, true)),
    [update, drawn],
  );
  const onWake = useCallback(
    (woken: readonly string[]) => update((held) => withWoken(held, woken)),
    [update],
  );
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
    viewedAt: choicesOn(state, taskId).viewedAt ?? NO_STAMPS,
    onViewedAt,
    onDoze,
    onWake,
  };
}
