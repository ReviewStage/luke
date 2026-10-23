import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import { createdByOnly, TASK_ORDER, taskTime } from "./task-list-model.js";

/**
 * person-page-model.ts -- a person's page in the listed workspace: what of theirs the window already holds, grouped as the page lists it.
 *
 * The page is built from the plan list alone, which every member of the
 * workspace reads whole, so it shows a teammate nothing the sidebar's
 * Assigned to and Created by filters and an agent's card do not already
 * show: the tasks assigned to them, then the rest of the tasks they
 * created, a task both being listed once, as theirs to do, and the agents
 * they started, those at work apart from the rest.
 * An agent is theirs by its line's `startedBy`, and a row of the list names
 * at most a few of a task's agents (`PLAN_AGENTS_BOUNDS`), those at work
 * first, so an older agent a busy task no longer names is left out rather
 * than read for. Their agents' open Inbox items are matched to them the same
 * way (`agentStarter`). Nothing here is read of another workspace, nor of
 * anyone's personal one, since the list is the listed workspace's.
 */

/** The most tasks the page lists before the rest are left to the sidebar's filter. */
export const PERSON_TASKS_SHOWN = 5;

/** One of a person's agents, with the task it works on. */
export interface PersonAgent {
  readonly task: TaskSummary;
  readonly agent: TaskAgentLine;
}

/** What a person's page lists: their agents at work, their tasks, and their other agents, each newest first. */
export interface PersonPage {
  readonly working: readonly PersonAgent[];
  /** Every task assigned to them, newest first; the page draws the first `PERSON_TASKS_SHOWN`. */
  readonly assigned: readonly TaskSummary[];
  /** Every task they created that is not assigned to them, newest first; the page draws the first `PERSON_TASKS_SHOWN`. */
  readonly created: readonly TaskSummary[];
  readonly agents: readonly PersonAgent[];
}

/** The statuses of an agent that may still write: starting, or running. */
const AT_WORK: ReadonlySet<TaskAgentLine["status"]> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** When an agent last moved, for ordering: its line's time, else its task's. */
function agentTime({ task, agent }: PersonAgent): number {
  return agent.at ?? taskTime(task, TASK_ORDER.UPDATED);
}

/** The person's page from the listed workspace's tasks, the archived left out by the list itself. */
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
    // A task they created and are assigned to is listed once, as assigned.
    created: createdByOnly(tasks, userId)
      .filter((task) => !assignedToThem(task))
      .toSorted(latest),
    agents: theirs.filter(({ agent }) => !AT_WORK.has(agent.status)).toSorted(newest),
  };
}

/**
 * How the list names a person, by the first task they created, are assigned
 * to, or agent they started that it holds: the name their account holds now, which stands for
 * someone the members read no longer lists; none where the list names them
 * nowhere.
 */
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

/** Who started an agent a task's row names, by account id; none where the row names no such agent or no starter. */
export function agentStarter(task: TaskSummary, agentId: string): string | undefined {
  return task.agents?.agents.find((agent) => agent.id === agentId)?.startedBy?.userId;
}

/** Whether the page has nothing of the person's to list. */
export function personPageEmpty(page: PersonPage): boolean {
  return (
    page.working.length === 0 &&
    page.assigned.length === 0 &&
    page.created.length === 0 &&
    page.agents.length === 0
  );
}
