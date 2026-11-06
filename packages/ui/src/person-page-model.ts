import { AGENT_STATUS } from "@repo/features/agent-wire";
import type { TaskAgentLine, TaskSummary } from "@repo/features/task-wire";
import { createdByOnly, TASK_ORDER, taskTime } from "./task-list-model.js";

export const PERSON_TASKS_SHOWN = 5;

export interface PersonAgent {
  readonly task: TaskSummary;
  readonly agent: TaskAgentLine;
}

export interface PersonPage {
  readonly working: readonly PersonAgent[];
  readonly assigned: readonly TaskSummary[];
  readonly created: readonly TaskSummary[];
  readonly agents: readonly PersonAgent[];
}

const AT_WORK: ReadonlySet<TaskAgentLine["status"]> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

function agentTime({ task, agent }: PersonAgent): number {
  return agent.at ?? taskTime(task, TASK_ORDER.UPDATED);
}

export function personPage(userId: string, tasks: readonly TaskSummary[]): PersonPage {
  const theirs = tasks.flatMap((task) =>
    (task.agents?.agents ?? [])
      .filter((agent) => agent.startedBy?.userId === userId)
      .map((agent) => ({ task, agent })),
  );
  const newest = (a: PersonAgent, b: PersonAgent) => agentTime(b) - agentTime(a);
  const latest = (a: TaskSummary, b: TaskSummary) =>
    taskTime(b, TASK_ORDER.UPDATED) - taskTime(a, TASK_ORDER.UPDATED);
  const assignedToThem = (task: TaskSummary) => task.assignee?.userId === userId;
  return {
    working: theirs.filter(({ agent }) => AT_WORK.has(agent.status)).toSorted(newest),
    assigned: tasks.filter(assignedToThem).toSorted(latest),
    created: createdByOnly(tasks, userId)
      .filter((task) => !assignedToThem(task))
      .toSorted(latest),
    agents: theirs.filter(({ agent }) => !AT_WORK.has(agent.status)).toSorted(newest),
  };
}

export function personRef(
  userId: string,
  tasks: readonly TaskSummary[],
): { readonly userId: string; readonly name: string } | undefined {
  for (const task of tasks) {
    if (task.createdBy?.userId === userId) return task.createdBy;
    if (task.assignee?.userId === userId) return task.assignee;
    const agent = task.agents?.agents.find((each) => each.startedBy?.userId === userId);
    if (agent?.startedBy !== undefined) return agent.startedBy;
  }
  return undefined;
}

export function agentStarter(task: TaskSummary, agentId: string): string | undefined {
  return task.agents?.agents.find((agent) => agent.id === agentId)?.startedBy?.userId;
}

export function personPageEmpty(page: PersonPage): boolean {
  return (
    page.working.length === 0 &&
    page.assigned.length === 0 &&
    page.created.length === 0 &&
    page.agents.length === 0
  );
}
