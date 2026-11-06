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

const NO_PEOPLE: ReadonlyMap<string, string> = new Map();

const cataloguedAgents = new WeakMap<
  ReadonlyMap<string, string>,
  { readonly models: readonly CatalogModel[]; readonly agents: ReadonlyMap<string, string> }
>();

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

function activePagesOf(state: AppStateSnapshot | undefined): readonly PageLine[] | undefined {
  const taskId = state?.tasks.activeTaskId;
  return taskId === undefined ? undefined : state?.[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows;
}

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

const NO_HELD_NAMES = heldNamesOf(undefined, undefined, undefined);

const selectHeldNames = memoizedSelect(
  (state) => [state.tasks, state.inbox, activePagesOf(state)],
  heldNamesOf,
);

const selectHeldStatuses = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, TaskStatus> =>
    new Map(
      planning.tasks.flatMap((task) =>
        task.status === undefined ? [] : [[task.id, task.status] as const],
      ),
    ),
);

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

const NO_KEY_TARGETS: ReadonlyMap<string, string> = new Map();

function sameTargets(
  held: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  if (held.size !== next.size) return false;
  for (const [key, target] of held) if (next.get(key) !== target) return false;
  return true;
}

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

let heldKeyTargets: ReadonlyMap<string, string> = NO_KEY_TARGETS;

const selectKeyTargets = memoizedSelect(
  (state) => [state.tasks],
  (planning) => {
    const next = keyTargetsOf(planning);
    if (!sameTargets(heldKeyTargets, next)) heldKeyTargets = next;
    return heldKeyTargets;
  },
);

export function useWordTargets(): ReadonlyMap<string, string> {
  return useQuery({ ...appStateQuery, select: selectKeyTargets }).data ?? NO_KEY_TARGETS;
}

export function useTaskStatus(taskId: string | undefined): TaskStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined ? undefined : selectHeldStatuses(state).get(taskId),
    [taskId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

export function useAgentStatus(agentId: string): AgentStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => selectHeldAgentStatuses(state).get(agentId),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

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
