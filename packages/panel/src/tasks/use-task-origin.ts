import { useAtomValue } from "@effect/atom-react/Hooks";
import type { AgentStatus } from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import { sameShape } from "@repo/features/turn-rows";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { type Actor, type OriginAgent, originActor } from "@repo/ui/actor-model";
import * as Atom from "effect/reactivity/Atom";
import { useCallback } from "react";
import { appStateDerivedAtom } from "../use-app-state.js";
import { agentActorState, providerOf } from "./agent-model.js";

/**
 * use-task-origin.ts -- who made a task for its member, where they did not make it by hand: the app on their call, a coding agent, or the automation whose run started it.
 *
 * A task names the agent that made it by id alone (`TaskSummary.origin`),
 * and the window already holds every agent it lists, each task's own and
 * those with no task, so the agent's name, harness, and standing are read
 * here rather than sent on every task. They are built once per delivery
 * that moved the task list, in an atom every row shares, and each row reads
 * its own agent through an atom of that agent's alone, so a delivery that
 * moved another redraws none of its rows. An agent the window does not
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

/** The task list's slice, which tells its readers only when it is a new object. */
const planningAtom: Atom.Atom<AppStateSnapshot["tasks"] | undefined> = Atom.withEquality(
  appStateDerivedAtom((state) => state?.tasks),
  (held, next) => held === next,
);

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
const originAgentsAtom: Atom.Atom<ReadonlyMap<string, OriginAgent>> = Atom.map(
  planningAtom,
  (planning) => {
    const agents = new Map<string, OriginAgent>();
    const names = new Map(planning?.tasks.map((task) => [task.id, task.name]));
    for (const task of planning?.tasks ?? []) {
      for (const line of task.agents?.agents ?? []) {
        agents.set(line.id, originAgentOf(line, task.id, names));
      }
    }
    for (const agent of planning?.taskAgents ?? []) {
      agents.set(agent.id, originAgentOf(agent, agent.planId, names));
    }
    for (const agent of planning?.tasklessAgents ?? []) {
      agents.set(agent.id, originAgentOf(agent, undefined, names));
    }
    return agents;
  },
);

/** The key a row with no agent behind it reads, which no agent's id is. */
const NO_AGENT = "";

/** How deep two of an agent's readings are read alike (`sameShape`): each field, every one a plain value. */
const AGENT_DEPTH = 1;

/**
 * One agent as the window holds it, by id, none where it holds none. Note
 * that it tells its readers only where the agent reads otherwise, because
 * every delivery that moves the task list builds every agent anew, and an
 * atom tells its readers of any value that is not the one it held.
 */
const originAgentAtom = Atom.family((agentId: string) =>
  Atom.withEquality(
    Atom.map(originAgentsAtom, (agents) => agents.get(agentId)),
    (held, next) => sameShape(held, next, AGENT_DEPTH),
  ),
);

/** What names who made a task: its origin, the one field read. */
type OriginTask = Pick<TaskSummary, "origin">;

/**
 * Who made a task for its member, as `originActor` names them from the
 * agents the window holds; none for a task its member made by hand.
 */
export function useTaskOrigin(): (task: OriginTask) => Actor | undefined {
  const agents = useAtomValue(originAgentsAtom);
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
  const agent = useAtomValue(originAgentAtom(task.origin?.agentId ?? NO_AGENT));
  const actor = originActor(task.origin, agent);
  if (actor === undefined) return undefined;
  return agent?.taskName === undefined ? { actor } : { actor, fromTask: agent.taskName };
}
