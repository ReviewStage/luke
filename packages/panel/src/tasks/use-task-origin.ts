import type { AgentStatus } from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { type Actor, type OriginAgent, originActor } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery, memoizedSelect } from "../use-app-state.js";
import { agentActorState, providerOf } from "./agent-model.js";

/**
 * use-task-origin.ts -- who made a task for its member, where they did not make it by hand: the app on their call, a coding agent, or the automation whose run started it.
 *
 * A task names the agent that made it by id alone (`TaskSummary.origin`),
 * and the window already holds every agent it lists, each task's own and
 * those with no task, so the agent's name, harness, and standing are read
 * here rather than sent on every task. They are built once per delivery
 * that moved the task list, in a memoized select every row shares, and each
 * row reads its own agent through a select of that agent's alone, so a
 * delivery that moved another redraws none of its rows. An agent the window does not
 * hold, archived or gone, is drawn as a coding agent on the mark of no
 * known harness.
 */

/** An agent as the list carries it, wherever it stands in it. */
interface ListedAgent {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly status: AgentStatus;
  readonly automationName?: string | undefined;
}

/** An agent as a task it made draws it. */
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

/** Every agent the window holds, by id: each task's row's, every task's live, and those with no task, the fullest last. */
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

/** No agents, before the first document arrives. */
const NO_AGENTS: ReadonlyMap<string, OriginAgent> = new Map();

/** The key a row with no agent behind it reads, which no agent's id is. */
const NO_AGENT = "";

/**
 * One agent as the window holds it, by id, none where it holds none. Note
 * that its reader is told only where the agent reads otherwise, although
 * every delivery that moves the task list builds every agent anew, because
 * Query's structural sharing hands back the object it held while each field
 * is the same plain value.
 */
function useOriginAgent(agentId: string): OriginAgent | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => selectOriginAgents(state).get(agentId),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/** What names who made a task: its origin, the one field read. */
type OriginTask = Pick<TaskSummary, "origin">;

/**
 * Who made a task for its member, as `originActor` names them from the
 * agents the window holds; none for a task its member made by hand.
 */
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

/** Who made a task for its member, and the name of the task the agent that made it works on, which the task is said to come from. */
interface TaskMadeBy {
  readonly actor: Actor;
  readonly fromTask?: string | undefined;
}

/** Who made the task, as `useTaskOrigin` names them, and the task it came from; none for one made by hand. */
export function useTaskMaker(task: OriginTask): TaskMadeBy | undefined {
  const agent = useOriginAgent(task.origin?.agentId ?? NO_AGENT);
  const actor = originActor(task.origin, agent);
  if (actor === undefined) return undefined;
  return agent?.taskName === undefined ? { actor } : { actor, fromTask: agent.taskName };
}
