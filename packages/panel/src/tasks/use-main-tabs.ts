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
} from "@repo/ui/tab-strip-model";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";

export const MAIN_TAB = {
  OVERVIEW: "overview",
} as const;

type OverviewTab = typeof MAIN_TAB.OVERVIEW;

export function isOverviewTab(tab: StripTab | undefined): tab is OverviewTab {
  return tab === MAIN_TAB.OVERVIEW;
}

const RETIRED_MAIN_TAB = {
  DESCRIPTION: "plan",
  INBOX: "inbox",
  CALL: "call",
  CHAT: "chat",
} as const;

const RETIRED_MAIN_TABS: ReadonlySet<unknown> = new Set(Object.values(RETIRED_MAIN_TAB));

export type MainTab = OverviewTab | AgentStripTab | DraftStripTab;

const STORAGE_KEY = "app.mainTabs";

const SIDE_PANEL_KEY = "app.sidePanel";

const CLOSED_AGENTS_KEPT = 500;

const RECENT_KEPT = 20;

const TASKS_KEPT = 500;

const VIEWED_KEPT = 50;

const keptTabSchema = Schema.Union([
  Schema.Struct({ agent: Schema.String }),
  Schema.Literal(MAIN_TAB.OVERVIEW),
]);

const keptViewedSchema = Schema.Struct({ tab: keptTabSchema, at: Schema.Number });

const readTabSchema = Schema.Union([
  keptTabSchema,
  Schema.Literals(Object.values(RETIRED_MAIN_TAB)),
]);

const taskChoicesSchema = Schema.Struct({
  recent: Schema.optional(Schema.Array(keptTabSchema)),
  order: Schema.optional(Schema.Array(keptTabSchema)),
  viewedAt: Schema.optional(Schema.Array(keptViewedSchema)),
});

const readChoicesSchema = Schema.Struct({
  ...taskChoicesSchema.fields,
  recent: Schema.optional(Schema.Array(readTabSchema)),
  order: Schema.optional(Schema.Array(readTabSchema)),
});

const mainTabsSchema = Schema.Struct({
  closedAgents: Schema.Array(Schema.String),
  dozing: Schema.optional(Schema.Array(Schema.String)),
  tasks: Schema.Record(Schema.String, taskChoicesSchema),
});

type MainTabsState = typeof mainTabsSchema.Type;

interface TaskChoices {
  readonly recent?: readonly MainTab[] | undefined;
  readonly order?: readonly MainTab[] | undefined;
  readonly viewedAt?: readonly ViewedAt<MainTab>[] | undefined;
}

interface HeldState {
  readonly closedAgents: readonly string[];
  readonly dozing: readonly string[];
  readonly tasks: Readonly<Record<string, TaskChoices>>;
}

const sidePanelTabSchema = Schema.Union([Schema.String, Schema.Struct({ agent: Schema.String })]);

const sidePanelTaskTabsSchema = Schema.optional(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      recent: Schema.optional(Schema.Array(sidePanelTabSchema)),
      order: Schema.optional(Schema.Array(sidePanelTabSchema)),
    }),
  ),
);

const sidePanelAgentsSchema = Schema.Struct({
  closedAgents: Schema.optional(Schema.Array(Schema.String)),
  tasks: sidePanelTaskTabsSchema,
  plans: sidePanelTaskTabsSchema,
});

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

const NOTHING_KEPT: HeldState = { closedAgents: [], dozing: [], tasks: {} };

const NO_CHOICES: TaskChoices = {};

const NO_TABS: readonly MainTab[] = [];

const NO_STAMPS: readonly ViewedAt<MainTab>[] = [];

export interface MainTabsControl {
  tabs: readonly MainTab[];
  tab: MainTab | undefined;
  returnTab: MainTab | undefined;
  openAgents: readonly string[] | undefined;
  newTabAsked: boolean;
  onChoose: (tab: MainTab) => void;
  onShow: (taskId: string, tab: MainTab) => void;
  onClose: (tab: MainTab) => void;
  onMove: (tab: MainTab, to: number) => void;
  onNewTab: () => void;
  onNewTabAnswered: () => void;
  viewedAt: readonly ViewedAt<MainTab>[];
  onViewedAt: (
    taskId: string,
    viewed: readonly MainTab[],
    standing: readonly MainTab[],
    at: number,
  ) => void;
  onDoze: (tab: AgentStripTab) => void;
  onWake: (agents: readonly string[]) => void;
}

export interface NamedAgents {
  ids: readonly string[];
  total: number;
}

interface DrawnTabs {
  taskId: string | undefined;
  agents: readonly string[] | undefined;
  named: NamedAgents | undefined;
  draft: string | undefined;
  detailsFirst: boolean;
}

function choicesOn(held: HeldState, taskId: string | undefined): TaskChoices {
  return taskId === undefined ? NO_CHOICES : (held.tasks[taskId] ?? NO_CHOICES);
}

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

function openAgentsOf(held: HeldState, agents: readonly string[] | undefined) {
  return agents?.filter((agent) => !held.closedAgents.includes(agent));
}

function movableOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  const choices = choicesOn(held, drawn.taskId);
  const agents = (openAgentsOf(held, drawn.agents) ?? []).map((agent) => ({ agent }));
  const draft = drawn.draft === undefined ? [] : [{ draft: drawn.draft }];
  const order = choices.order ?? NO_TABS;
  return inTaskOrder([...agents, ...draft], order, (tab) => tab);
}

function stripOf(held: HeldState, drawn: DrawnTabs): readonly MainTab[] {
  return [MAIN_TAB.OVERVIEW, ...movableOf(held, drawn)];
}

function stands(held: HeldState, drawn: DrawnTabs, tab: MainTab): boolean {
  return stripOf(held, drawn).some((each) => sameTab(each, tab));
}

function shownIn(held: HeldState, drawn: DrawnTabs): MainTab | undefined {
  if (drawn.taskId === undefined) return undefined;
  if (drawn.agents === undefined) return shownBeforeList(held, drawn);
  const recent = choicesOn(held, drawn.taskId).recent ?? NO_TABS;
  return (
    recent.findLast((tab) => stands(held, drawn, tab)) ??
    (drawn.detailsFirst ? MAIN_TAB.OVERVIEW : movableOf(held, drawn).at(-1))
  );
}

function returnedTo(held: HeldState, drawn: DrawnTabs): MainTab | undefined {
  const recent = choicesOn(held, drawn.taskId).recent ?? NO_TABS;
  return (
    recent.findLast((tab) => !isOverviewTab(tab) && stands(held, drawn, tab)) ??
    movableOf(held, drawn).at(-1)
  );
}

function namesAll(named: NamedAgents): boolean {
  return named.ids.length === named.total;
}

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
    if (!all) return undefined;
  }
  return drawn.detailsFirst ? MAIN_TAB.OVERVIEW : undefined;
}

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

function withDetailsLeft(held: HeldState, taskId: string): HeldState {
  return withChoices(held, taskId, (was) =>
    was.recent?.some(isOverviewTab) === true
      ? { ...was, recent: was.recent.filter((tab) => !isOverviewTab(tab)) }
      : was,
  );
}

function withEveryDetailsLeft(held: HeldState): HeldState {
  return Object.keys(held.tasks).reduce(withDetailsLeft, held);
}

function withOpened(held: HeldState, tab: MainTab): HeldState {
  if (!isAgentTab(tab) || !held.closedAgents.includes(tab.agent)) return held;
  return {
    ...held,
    closedAgents: held.closedAgents.filter((agent) => agent !== tab.agent),
    dozing: held.dozing.filter((agent) => agent !== tab.agent),
  };
}

function withWoken(held: HeldState, agents: readonly string[]): HeldState {
  const woken = held.dozing.filter((agent) => agents.includes(agent));
  if (woken.length === 0) return held;
  return {
    ...held,
    closedAgents: held.closedAgents.filter((agent) => !woken.includes(agent)),
    dozing: held.dozing.filter((agent) => !woken.includes(agent)),
  };
}

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

function withChosen(held: HeldState, tab: MainTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = shown === undefined || sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(withOpened(held, tab), drawn.taskId, viewed);
}

function withShown(held: HeldState, on: string, tab: MainTab, drawn: DrawnTabs): HeldState {
  if (on === drawn.taskId) return withChosen(held, tab, drawn);
  return withViewed(withOpened(held, tab), on, [tab]);
}

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
  const standing = stripOf(forgotten, drawn).filter((each) => !sameTab(each, tab));
  const recent = choicesOn(forgotten, drawn.taskId).recent ?? NO_TABS;
  const replacement = replacementOf(standing, recent, before, tab);
  return replacement === undefined ? forgotten : withViewed(forgotten, drawn.taskId, [replacement]);
}

function withTabAt(held: HeldState, tab: MainTab, to: number, drawn: DrawnTabs): HeldState {
  if (isOverviewTab(tab)) return held;
  const movable = movableOf(held, drawn);
  const was = choicesOn(held, drawn.taskId).order ?? NO_TABS;
  const order = movedOrder(was, movable, tab, to);
  return order === undefined
    ? held
    : withChoices(held, drawn.taskId, (choices) => ({ ...choices, order }));
}

function keptTab(tab: MainTab): tab is Exclude<MainTab, DraftStripTab> {
  return !isDraftTab(tab);
}

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

function storedText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

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

function current<T>(
  tab: T,
): tab is Exclude<T, (typeof RETIRED_MAIN_TAB)[keyof typeof RETIRED_MAIN_TAB]> {
  return !RETIRED_MAIN_TABS.has(tab);
}

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

function readStored(): HeldState {
  const kept = Option.map(
    decodeKept(storedText(STORAGE_KEY)),
    ({ closedAgents, dozing, tasks, plans }): HeldState =>
      withEveryDetailsLeft({
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

export function useMainTabs(
  fixture: { readonly tab: MainTab | undefined } | undefined,
  taskId: string | undefined,
  agents: readonly string[] | undefined,
  named: NamedAgents | undefined,
  draft: string | undefined,
  detailsFirst = false,
): MainTabsControl {
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
  const drawn = useMemo(
    () => ({ taskId, agents, named, draft, detailsFirst }),
    [taskId, agents, named, draft, detailsFirst],
  );
  const [standing, setStanding] = useState(taskId);
  if (standing !== taskId) {
    setStanding(taskId);
    if (standing !== undefined && !detailsFirst) {
      update((held) => withDetailsLeft(held, standing));
    }
  }
  useEffect(() => {
    if (staging) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
    } catch {}
  }, [staging, kept]);

  const tabs = useMemo(() => stripOf(state, drawn), [state, drawn]);
  const openAgents = useMemo(() => openAgentsOf(state, agents), [state, agents]);
  const onChoose = useCallback(
    (tab: MainTab) => update((held) => withChosen(held, tab, drawn)),
    [update, drawn],
  );
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
    returnTab: returnedTo(state, drawn),
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
