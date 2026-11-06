import { AGENT_BOUNDS, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import { summaryOfTaskless, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery, selectTasks } from "../use-app-state.js";

export type WorkspaceAgents =
  | { readonly agents: readonly AgentSummary[] }
  | { readonly failed: true }
  | undefined;

const AGENTS_FAILED = { failed: true } as const;

function newestFirst(a: ListedAgent, b: ListedAgent): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

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
