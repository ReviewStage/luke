import type { AgentStatus } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { agentName, modelLabel } from "@repo/features/model-label";
import type { CatalogModel } from "@repo/features/models-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import type { KnownNames } from "@repo/features/place-chip-model";
import type { TaskStatus } from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory } from "../member-directory.js";
import { appStateQuery, memoizedSelect } from "../use-app-state.js";
import { useMentionedPlace } from "./mentioned-place.js";

/**
 * use-known-names.ts -- the names the window already holds for places in the app, by id, for a chip to call an app link by.
 *
 * Read from main's document, which every window holds: every task's title,
 * the agents each task's row names, as their tabs name them
 * (`agentName`, so an untitled agent goes by its model), and the models they run on, the agents with no task the list
 * carries, theirs, and the automations that started them, the active task's
 * pages as the window holds them (`LIVE_READ.PAGES`), each task's key, the
 * Inbox items waiting, and the agents an automation started with no task;
 * from the directories standing around
 * the caller, the members and the automation asked for, and the catalog an
 * untitled agent's model is named by, as its tab and row name it
 * (`mentioned-place.ts`). Nothing is fetched,
 * so a name the window does not hold is not here; the task list is followed
 * from the account signing in (`compose-tasks.ts`), which brings each task's
 * name as the service gives it.
 *
 * The document's names are built once per delivery in a memoized select
 * every chip shares (`memoizedSelect`), rather than once per chip, so a
 * transcript of a hundred chips builds them once; and not at all for a
 * delivery that moved neither the tasks, the Inbox, nor the active task's
 * pages.
 */

/** No people: what a caller outside a member directory names. */
const NO_PEOPLE: ReadonlyMap<string, string> = new Map();

/** The agents each held set of names last named by a catalog, and that catalog, so every chip of one delivery shares one map. */
const cataloguedAgents = new WeakMap<
  ReadonlyMap<string, string>,
  { readonly models: readonly CatalogModel[]; readonly agents: ReadonlyMap<string, string> }
>();

/**
 * The agents' names with each untitled agent's, the one its model's id
 * spells, named by the catalog instead, as its tab and its row in a list
 * name it; the names as held where no catalog is read.
 */
function agentsNamedBy(
  agents: ReadonlyMap<string, string>,
  agentModels: ReadonlyMap<string, string>,
  models: readonly CatalogModel[] | undefined,
): ReadonlyMap<string, string> {
  if (models === undefined) return agents;
  const held = cataloguedAgents.get(agents);
  if (held?.models === models) return held.agents;
  const named = new Map(agents);
  for (const [agentId, name] of agents) {
    const model = agentModels.get(agentId);
    if (model !== undefined && name === modelLabel(model))
      named.set(agentId, modelLabel(model, models));
  }
  cataloguedAgents.set(agents, { models, agents: named });
  return named;
}

/** The active task's pages as the window holds them; none with no task open, or before they are read. */
function activePagesOf(state: AppStateSnapshot | undefined): readonly PageLine[] | undefined {
  const taskId = state?.tasks.activeTaskId;
  return taskId === undefined ? undefined : state?.[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows;
}

/** The names the document holds, no people among them, from the tasks, the Inbox, and the active task's pages. */
function heldNamesOf(
  planning: AppStateSnapshot["tasks"] | undefined,
  inbox: AppStateSnapshot["inbox"] | undefined,
  activePages: readonly PageLine[] | undefined,
): KnownNames {
  const tasks = new Map(planning?.tasks.map((task) => [task.id, task.name]));
  const agents = new Map<string, string>();
  const agentModels = new Map<string, string>();
  for (const task of planning?.tasks ?? []) {
    for (const agent of task.agents?.agents ?? []) {
      agents.set(agent.id, agentName(agent));
      agentModels.set(agent.id, agent.model);
    }
  }
  const automations = new Map<string, string>();
  for (const agent of planning?.tasklessAgents ?? []) {
    agents.set(agent.id, agentName(agent));
    agentModels.set(agent.id, agent.model);
    if (agent.automationId !== null && agent.automationName !== undefined) {
      automations.set(agent.automationId, agent.automationName);
    }
  }
  // Note that an item's brief names its agent as its row does now, so a title there stands over the list's.
  for (const item of inbox?.taskless ?? []) {
    if (item.agentTitle === null && agents.has(item.agentId)) continue;
    agents.set(
      item.agentId,
      agentName({
        title: item.agentTitle,
        model: item.agentModel,
        automationName: item.automationName ?? undefined,
      }),
    );
  }
  const pages = new Map(activePages?.map((page) => [page.id, page.title]));
  const inboxItems = new Map(
    [...(inbox?.waiting ?? []).flatMap((task) => task.items), ...(inbox?.taskless ?? [])].map(
      (item) => [item.id, item.title],
    ),
  );
  return {
    tasks,
    agents,
    agentModels,
    pages,
    pagesTaskId: planning?.activeTaskId,
    inboxItems,
    people: NO_PEOPLE,
    automations,
  };
}

/** The names of a window before the first document arrives. */
const NO_HELD_NAMES = heldNamesOf(undefined, undefined, undefined);

/** The names the document holds, the one value every reader of this window shares, made again only for a delivery that moved the tasks, the Inbox, or the active task's pages. */
const selectHeldNames = memoizedSelect(
  (state) => [state.tasks, state.inbox, activePagesOf(state)],
  heldNamesOf,
);

/** Each listed task's status, by its id, built once per delivery that moved the slices the names are read from, as the names are. */
const selectHeldStatuses = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, TaskStatus> =>
    new Map(
      planning.tasks.flatMap((task) =>
        task.status === undefined ? [] : [[task.id, task.status] as const],
      ),
    ),
);

/** Each listed agent's status, a task's row's and those on no task, by its id, built as the task statuses are. */
const selectHeldAgentStatuses = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, AgentStatus> =>
    new Map([
      ...planning.tasks.flatMap((task) =>
        (task.agents?.agents ?? []).map((agent) => [agent.id, agent.status] as const),
      ),
      ...(planning.tasklessAgents ?? []).map((agent) => [agent.id, agent.status] as const),
    ]),
);

/** No keys: what a window listing no numbered task holds, one object for every reader. */
const NO_KEY_TARGETS: ReadonlyMap<string, string> = new Map();

/** Whether two sets of keys name the same tasks by the same links, which a delivery that moved no task's key keeps. */
function sameTargets(
  held: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  if (held.size !== next.size) return false;
  for (const [key, target] of held) if (next.get(key) !== target) return false;
  return true;
}

/**
 * Each listed task's key (`ACME-42`), the link its mention is written with.
 * A key two tasks share, as two workspaces whose names begin alike give
 * theirs, names neither, so words never chip the wrong task.
 */
function keyTargetsOf(planning: AppStateSnapshot["tasks"]): ReadonlyMap<string, string> {
  const workspaces = new Map(planning.workspaces.map((workspace) => [workspace.id, workspace]));
  const targets = new Map<string, string>();
  const shared = new Set<string>();
  for (const task of planning.tasks) {
    const workspace = workspaces.get(task.workspaceId);
    if (workspace === undefined || task.number === undefined) continue;
    const key = taskKey(workspace.name, task.number);
    if (targets.has(key)) shared.add(key);
    const place = { workspace: workspace.slug ?? "", repository: null };
    targets.set(key, encodeMention({ kind: MENTION_KIND.TASK, taskId: task.id }, place));
  }
  for (const key of shared) targets.delete(key);
  return targets.size === 0 ? NO_KEY_TARGETS : targets;
}

/** The keys last handed to the readers, kept while a delivery names the same keys by the same links. */
let heldKeyTargets: ReadonlyMap<string, string> = NO_KEY_TARGETS;

/**
 * The keys, built once per delivery that moved the task list, as the names
 * are. It tells its readers only when a key or its link changed, which a
 * task's other moves never do, so the words drawn with it are read again
 * only then. Note that the last answer is kept here by hand, because a
 * `structuralSharing` function on one reader's `useQuery` becomes the
 * shared app-state query's own (`QueryObserver.setOptions`), which would
 * then compare whole documents with it.
 */
const selectKeyTargets = memoizedSelect(
  (state) => [state.tasks],
  (planning) => {
    const next = keyTargetsOf(planning);
    if (!sameTargets(heldKeyTargets, next)) heldKeyTargets = next;
    return heldKeyTargets;
  },
);

/**
 * The names words written with any among them are drawn with as a chip:
 * each listed task's key, by the link it names its task with
 * (`keyTargetsOf`). The same object until a key or a link changes.
 */
export function useWordTargets(): ReadonlyMap<string, string> {
  return useQuery({ ...appStateQuery, select: selectKeyTargets }).data ?? NO_KEY_TARGETS;
}

/**
 * The status of the task `taskId` names, as the window's task list holds it,
 * which a chip or a row naming the task wears as its mark (`PlanGlyph`);
 * none for a task the window does not list, or none asked for.
 */
export function useTaskStatus(taskId: string | undefined): TaskStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined ? undefined : selectHeldStatuses(state).get(taskId),
    [taskId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/** The status of the agent the window lists by `agentId`; none where it lists no such agent. */
export function useAgentStatus(agentId: string): AgentStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => selectHeldAgentStatuses(state).get(agentId),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * The names the window holds, the automation `automationId` names among them
 * where the directory around the caller lists it. Outside a member directory
 * and with no automation asked for, every caller is handed the one shared
 * value, which stays the same object until the tasks or the Inbox move; with
 * the catalog read, every caller shares the one map of agents' names it named.
 */
export function useKnownNames(automationId?: string): KnownNames {
  const held = useQuery({ ...appStateQuery, select: selectHeldNames }).data ?? NO_HELD_NAMES;
  const { members, former } = useMemberDirectory();
  const agents = agentsNamedBy(held.agents, held.agentModels, useMentionedPlace().models);
  const automation = useAutomation(automationId)?.automation;
  const people = useMemo(
    () =>
      members === undefined && former === undefined
        ? NO_PEOPLE
        : new Map([...(former ?? []), ...(members ?? [])].map((each) => [each.userId, each.name])),
    [members, former],
  );
  // Note that the directory's automation is its name now, so it stands over the name the run that started an agent kept.
  const automations = useMemo(
    () =>
      automation === undefined
        ? held.automations
        : new Map([...held.automations, [automation.id, automation.name]]),
    [held.automations, automation],
  );
  return useMemo(
    () =>
      people === held.people && automations === held.automations && agents === held.agents
        ? held
        : { ...held, agents, people, automations },
    [held, agents, people, automations],
  );
}
