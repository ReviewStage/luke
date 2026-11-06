import type { AgentStatus } from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { type Actor, type OriginAgent, originActor } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery, memoizedSelect } from "../use-app-state.js";
import { agentActorState, providerOf } from "./agent-model.js";

interface ListedAgent {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly status: AgentStatus;
  readonly automationName?: string | undefined;
}

function originAgentOf(
  agent: ListedAgent,
  taskId: string | null | undefined,
  taskNames: ReadonlyMap<string, string>,
): OriginAgent {
  const taskName = taskId === null || taskId === undefined ? undefined : taskNames.get(taskId);
  return {
    name: agentName(agent),
    provider: providerOf(agent.model),
    state: agentActorState(agent.status),
    ...(taskId === null || taskId === undefined ? undefined : { taskId }),
    ...(taskName === undefined ? undefined : { taskName }),
    ...(agent.automationName === undefined ? undefined : { automationName: agent.automationName }),
  };
}

const selectOriginAgents = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, OriginAgent> => {
    const agents = new Map<string, OriginAgent>();
    const names = new Map(planning.tasks.map((task) => [task.id, task.name]));
    for (const task of planning.tasks) {
      for (const line of task.agents?.agents ?? []) {
        agents.set(line.id, originAgentOf(line, task.id, names));
      }
    }
    for (const agent of planning.taskAgents ?? []) {
      agents.set(agent.id, originAgentOf(agent, agent.planId, names));
    }
    for (const agent of planning.tasklessAgents ?? []) {
      agents.set(agent.id, originAgentOf(agent, undefined, names));
    }
    return agents;
  },
);

const NO_AGENTS: ReadonlyMap<string, OriginAgent> = new Map();

const NO_AGENT = "";

function useOriginAgent(agentId: string): OriginAgent | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => selectOriginAgents(state).get(agentId),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

type OriginTask = Pick<TaskSummary, "origin">;

export function useTaskOrigin(): (task: OriginTask) => Actor | undefined {
  const agents = useQuery({ ...appStateQuery, select: selectOriginAgents }).data ?? NO_AGENTS;
  return useCallback(
    (task: OriginTask) => {
      const agentId = task.origin?.agentId;
      return originActor(task.origin, agentId === undefined ? undefined : agents.get(agentId));
    },
    [agents],
  );
}

interface TaskMadeBy {
  readonly actor: Actor;
  readonly fromTask?: string | undefined;
}

export function useTaskMaker(task: OriginTask): TaskMadeBy | undefined {
  const agent = useOriginAgent(task.origin?.agentId ?? NO_AGENT);
  const actor = originActor(task.origin, agent);
  if (actor === undefined) return undefined;
  return agent?.taskName === undefined ? { actor } : { actor, fromTask: agent.taskName };
}
