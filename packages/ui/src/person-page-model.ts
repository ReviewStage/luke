import { AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import { agentMovedAt } from "@repo/features/task-agents-model";
import type { TaskSummary } from "@repo/features/task-wire";
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
 * Their agents are read from the agents the list follows live, every agent
 * of every listed task, as a task's own agents are (`use-agents.ts`), so
 * each is the whole summary a task's row draws, where it runs among it; one
 * is theirs by its `startedBy`, an archived one left out, as a task leaves
 * it out of its agents. Until the list follows live it carries none, and
 * the page lists none. Their agents' open Inbox items are matched to them
 * by the same agents (`agentStarter`), every agent of the task. Nothing here
 * is read of another workspace, nor of anyone's personal one, since the list
 * is the listed workspace's.
 */

/** The most tasks the page lists before the rest are left to the sidebar's filter. */
export const PERSON_TASKS_SHOWN = 5;

/** One of a person's agents, with the task it works on and when it last moved. */
export interface PersonAgent {
  readonly task: TaskSummary;
  readonly agent: ListedAgent;
  /**
   * Epoch milliseconds it last moved: when its run began while it works,
   * and when its newest turn ended once it has (`agentMovedAt`); else when
   * its newest run began, else when it was started.
   */
  readonly at: number;
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
const AT_WORK: ReadonlySet<ListedAgent["status"]> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** The person's agents on the listed tasks, the archived left out, each with its task and when it last moved. */
function agentsOf(
  userId: string,
  tasks: readonly TaskSummary[],
  agents: readonly ListedAgent[],
): PersonAgent[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return agents.flatMap((agent) => {
    const task = agent.planId === null ? undefined : byId.get(agent.planId);
    if (task === undefined || agent.archivedAt !== undefined) return [];
    if (agent.startedBy?.userId !== userId) return [];
    return [{ task, agent, at: agentMovedAt(agent) ?? agent.runStartedAt ?? agent.createdAt }];
  });
}

/**
 * The person's page from the listed workspace's tasks, the archived left out
 * by the list itself, and the agents it follows live, none while it does not.
 */
export function personPage(
  userId: string,
  tasks: readonly TaskSummary[],
  agents: readonly ListedAgent[] | undefined,
): PersonPage {
  const theirs = agentsOf(userId, tasks, agents ?? []);
  const newest = (a: PersonAgent, b: PersonAgent) => b.at - a.at;
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
 * How the list names a person, by the first task they created or are
 * assigned to, else the first agent they started on a listed task that the
 * list followed live holds: the name their account holds now, which stands
 * for someone the members read no longer lists; none where the list names
 * them nowhere.
 */
export function personRef(
  userId: string,
  tasks: readonly TaskSummary[],
  agents: readonly ListedAgent[] | undefined,
): { readonly userId: string; readonly name: string } | undefined {
  for (const task of tasks) {
    if (task.createdBy?.userId === userId) return task.createdBy;
    if (task.assignee?.userId === userId) return task.assignee;
  }
  const listed = new Set(tasks.map((task) => task.id));
  return agents?.find(
    (agent) =>
      agent.planId !== null && listed.has(agent.planId) && agent.startedBy?.userId === userId,
  )?.startedBy;
}

/** Who started an agent on a task, by account id, among the agents the list followed live holds, the archived among them; none where it holds no such agent or no starter. */
export function agentStarter(
  agents: readonly ListedAgent[] | undefined,
  agentId: string,
): string | undefined {
  return agents?.find((agent) => agent.id === agentId)?.startedBy?.userId;
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
