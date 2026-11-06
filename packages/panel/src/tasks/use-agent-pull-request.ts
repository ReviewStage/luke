import type { AgentPullRequestAnswerView } from "@repo/features/agent-view";
import type { AgentPullRequest, AgentPullRequestAnswer } from "@repo/features/agent-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { pullRequestPublishedQuery } from "../live-reads.js";
import { appStateQuery } from "../use-app-state.js";

export interface AgentPublished {
  readonly published: AgentPullRequestAnswer | undefined;
}

function publishedOf(
  held: AgentPullRequestAnswerView | undefined,
  known: AgentPullRequest | undefined,
): AgentPullRequestAnswer | undefined {
  const read = held === undefined || "failure" in held ? undefined : held;
  if (read === undefined) {
    return known === undefined ? undefined : { repository: null, branch: null, pullRequest: known };
  }
  return known === undefined ? read : { ...read, pullRequest: known };
}

export function useAgentPullRequest(input: {
  agentId: string;
  shown: boolean;
  known?: AgentPullRequest | undefined;
}): AgentPublished {
  const { agentId, shown, known } = input;
  const held = useQuery(pullRequestPublishedQuery(shown ? { agentId } : undefined)).data;
  return useMemo(() => ({ published: publishedOf(held, known) }), [held, known]);
}

const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

export type PullRequestHolder = { readonly taskId: string } | { readonly agentId: string };

export function useListedPullRequests(
  listed: readonly ListedPullRequest[] | undefined,
  holder: PullRequestHolder | undefined,
): ReadonlyMap<string, AgentPullRequest> {
  const taskId = holder !== undefined && "taskId" in holder ? holder.taskId : undefined;
  const agentId = holder !== undefined && "agentId" in holder ? holder.agentId : undefined;
  return useMemo(() => {
    const own = (listed ?? []).filter((each) =>
      taskId !== undefined ? each.taskId === taskId : each.agentId === agentId,
    );
    if (own.length === 0) return NO_PULL_REQUESTS;
    return new Map(own.map((each) => [each.agentId, each.pullRequest]));
  }, [listed, taskId, agentId]);
}

export function useListedPullRequest(agentId: string): AgentPullRequest | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      state.tasks.agentPullRequests?.find((each) => each.agentId === agentId)?.pullRequest,
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}
