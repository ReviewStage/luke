import type { ListedAgent } from "@repo/features/agent-wire";
import { agentsOfTask, pullRequestsOfTask } from "@repo/features/task-agents-model";
import type { TaskPullRequestLine } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery } from "../use-app-state.js";

/**
 * use-task-work.ts -- every agent a task holds and every pull request they opened, as every reader of a task's agents and pull requests reads them.
 *
 * A task's row counts its agents (`TaskAgentsSummary`); the agents and pull
 * requests themselves are what the window holds beside the list while it is
 * followed live: every agent on a task (`taskAgents`) and every pull request
 * of each (`taskPullRequests`), read in the order a task names them
 * (`task-agents-model.ts`). Before the list is followed live the window
 * holds no task's agents, and every task reads none.
 */

/** A task's agents and pull requests, every one the window holds. */
interface TaskWork {
  readonly agents: readonly ListedAgent[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

/** Every agent of one task, the archived left out, and every pull request they opened, as the document holds them. */
function taskWorkOf(planning: AppStateSnapshot["tasks"], taskId: string): TaskWork {
  return {
    agents: agentsOfTask(planning.taskAgents, taskId),
    pullRequests: pullRequestsOfTask(planning.taskPullRequests, taskId),
  };
}

/** No agents and no pull requests, before the first document arrives. */
const NO_WORK: TaskWork = { agents: [], pullRequests: [] };

/** Every agent a task holds, those at work first, and every pull request they opened. */
export function useTaskWork(taskId: string): TaskWork {
  const select = useCallback(
    (state: AppStateSnapshot) => taskWorkOf(state.tasks, taskId),
    [taskId],
  );
  return useQuery({ ...appStateQuery, select }).data ?? NO_WORK;
}

/** Every task's pull requests as the document holds them. */
function selectTaskPullRequests(
  state: AppStateSnapshot,
): AppStateSnapshot["tasks"]["taskPullRequests"] {
  return state.tasks.taskPullRequests;
}

/** No pull requests, before the first document arrives. */
const NO_PULL_REQUESTS: readonly TaskPullRequestLine[] = [];

/** Every pull request a task's agents opened, those still open first. */
export function useTaskPullRequests(taskId: string): readonly TaskPullRequestLine[] {
  const select = useCallback(
    (state: AppStateSnapshot) => pullRequestsOfTask(state.tasks.taskPullRequests, taskId),
    [taskId],
  );
  return useQuery({ ...appStateQuery, select }).data ?? NO_PULL_REQUESTS;
}

/** One agent on a task as the list followed live holds it, as the task's agents name it; none where it holds no such agent, or holds it archived. */
export function useTaskAgent(agentId: string): ListedAgent | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      state.tasks.taskAgents?.find(
        (agent) => agent.id === agentId && agent.archivedAt === undefined,
      ),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/** Every pull request of every task, by task, for a list that reads many tasks' (`pullRequestsOfTask`); none before the list is followed live. */
export function useListedTaskPullRequests(): AppStateSnapshot["tasks"]["taskPullRequests"] {
  return useQuery({ ...appStateQuery, select: selectTaskPullRequests }).data;
}
