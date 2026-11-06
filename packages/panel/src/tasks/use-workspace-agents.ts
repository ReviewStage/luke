import { AGENT_BOUNDS, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import { summaryOfTaskless, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery, selectTasks } from "../use-app-state.js";

/**
 * use-workspace-agents.ts -- a workspace's newest agents as the task list the host holds carries them: what an automation's Agent picker and an `@` list offer before a word is typed.
 *
 * The task list carries every agent of the account's workspaces the
 * account may see, on a task or on none, the archived among them, under the
 * gate the service lists a workspace's agents by. So a workspace's newest,
 * or its newest on one repository, are drawn from it rather than asked of
 * the service: the unarchived ones, the newest started first, at most as
 * many as the service answers (`AGENT_BOUNDS.MAX_WORKSPACE_AGENTS`), a
 * repository matched as GitHub matches one, its case aside. They move as
 * the list does. Words typed are still asked of the service, which finds
 * an agent past the newest.
 */

/** A workspace's newest agents as a surface draws them: carried, failed, or not yet carried. */
export type WorkspaceAgents =
  | { readonly agents: readonly AgentSummary[] }
  | { readonly failed: true }
  | undefined;

const AGENTS_FAILED = { failed: true } as const;

/** Newest started first, and by id among those started at one instant, as the service lists them. */
function newestFirst(a: ListedAgent, b: ListedAgent): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Where the list stands on `workspaceId`'s newest agents, on `repository`
 * where one is named. Note that the list carries the agents on a task only
 * once it answered live, so until then they are not yet carried, unless it
 * failed first.
 */
function newestOf(
  tasks: TasksView | undefined,
  workspaceId: string,
  repository: string | null,
): WorkspaceAgents {
  const onTasks = tasks?.taskAgents;
  if (onTasks === undefined) {
    return tasks?.listStatus === TASKS_READ.FAILED ? AGENTS_FAILED : undefined;
  }
  const repositoryNamed = repository?.toLowerCase();
  const agents = [...onTasks, ...(tasks?.tasklessAgents ?? []).map(summaryOfTaskless)]
    .filter(
      (agent) =>
        agent.workspaceId === workspaceId &&
        agent.archivedAt === undefined &&
        (repositoryNamed === undefined || agent.repository?.toLowerCase() === repositoryNamed),
    )
    .toSorted(newestFirst)
    .slice(0, AGENT_BOUNDS.MAX_WORKSPACE_AGENTS);
  return { agents };
}

/** `workspaceId`'s newest agents, on `repository` where one is named, as the task list carries them; none while no workspace is named. */
export function useWorkspaceAgents(
  workspaceId: string | undefined,
  repository: string | null,
): WorkspaceAgents {
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  return useMemo(
    () => (workspaceId === undefined ? undefined : newestOf(tasks, workspaceId, repository)),
    [tasks, workspaceId, repository],
  );
}
