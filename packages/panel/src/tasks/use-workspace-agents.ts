import { AGENT_BOUNDS, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import { summaryOfTaskless, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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
 * an agent past the newest. One agent is also found by its id
 * (`useListedAgent`), among every agent the list carries, so a pick saved
 * before the newest moved past it is still named.
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

/**
 * The agent `agentId` names as the task list carries it, on a task or on
 * none, archived or not; none where the list holds no such agent, which
 * may yet be one on a task the list has not carried live, so a caller
 * that must know reads it of the service then.
 */
export function listedAgentIn(
  tasks: Pick<TasksView, "taskAgents" | "tasklessAgents"> | undefined,
  agentId: string,
): ListedAgent | undefined {
  const onTask = tasks?.taskAgents?.find((agent) => agent.id === agentId);
  if (onTask !== undefined) return onTask;
  const taskless = tasks?.tasklessAgents?.find((agent) => agent.id === agentId);
  return taskless === undefined ? undefined : summaryOfTaskless(taskless);
}

/** The agent `agentId` names as the task list carries it, past the newest and archived alike; none while none is named, or where the list holds no such agent. */
export function useListedAgent(agentId: string | null): AgentSummary | undefined {
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  return useMemo(
    () => (agentId === null ? undefined : listedAgentIn(tasks, agentId)),
    [tasks, agentId],
  );
}

/**
 * Whether the agent `agentId` names has its sandbox open, as the task list
 * carries it live (`AgentSummary.sandboxOpen`), so a pane waiting on the
 * sandbox connects as it opens rather than asking again on a clock; none
 * while none is named, where the list holds no such agent, or from a
 * service that does not carry it.
 */
export function useSandboxOpen(agentId: string | null): boolean | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      agentId === null ? undefined : listedAgentIn(state.tasks, agentId)?.sandboxOpen,
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}
