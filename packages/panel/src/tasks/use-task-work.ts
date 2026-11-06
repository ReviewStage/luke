import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery } from "../use-app-state.js";
import { agentStillWriting } from "./agent-model.js";

interface TaskWork {
  readonly agents: readonly TaskAgentLine[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

function workingFirst(a: TaskAgentLine & { createdAt: number }, b: typeof a): number {
  const working = Number(agentStillWriting(b.status)) - Number(agentStillWriting(a.status));
  return working !== 0 ? working : b.createdAt - a.createdAt;
}

interface HeldWork {
  readonly agents: readonly TaskAgentLine[] | undefined;
  readonly pullRequests: readonly TaskPullRequestLine[] | undefined;
}

function heldWorkOf(planning: AppStateSnapshot["tasks"], taskId: string): HeldWork {
  return {
    agents: planning.taskAgents?.filter((agent) => agent.planId === taskId).toSorted(workingFirst),
    pullRequests:
      planning.taskPullRequests === undefined
        ? undefined
        : (planning.taskPullRequests.find((each) => each.taskId === taskId)?.pullRequests ?? []),
  };
}

export function useTaskWork(task: Pick<TaskSummary, "id" | "agents">): TaskWork {
  const taskId = task.id;
  const select = useCallback(
    (state: AppStateSnapshot) => heldWorkOf(state.tasks, taskId),
    [taskId],
  );
  const held = useQuery({ ...appStateQuery, select }).data;
  return {
    agents: held?.agents ?? task.agents?.agents ?? [],
    pullRequests: held?.pullRequests ?? task.agents?.pullRequests ?? [],
  };
}
