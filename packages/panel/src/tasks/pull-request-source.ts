import type { AgentPullRequestWriteAnswerView } from "@repo/features/agent-view";
import { AGENT_STATUS, type AgentPullRequest } from "@repo/features/agent-wire";
import type { PullRequestChaptersAnswerView } from "@repo/features/pull-request-chapters-view";
import type { PullRequestActionRequest } from "@repo/features/pull-request-write-wire";
import { ACT_KIND } from "@repo/host/acts";
import { createContext, useContext, useMemo } from "react";
import { sendAct } from "../act.js";
import { agentStillWriting } from "./agent-model.js";
import { pullRequestAsked, pullRequestOfTab } from "./pull-request-number.js";
import type { WritePlace } from "./pull-request-writes.js";
import type { AgentsControl } from "./use-agents.js";

export interface PullRequestSource {
  readonly ended: boolean;
  readonly place: WritePlace;
  readonly published: AgentPullRequest | undefined;
  readonly number: number | undefined;
  readonly generateChapters: () => Promise<PullRequestChaptersAnswerView>;
  readonly write: (request: PullRequestActionRequest) => Promise<AgentPullRequestWriteAnswerView>;
}

const PullRequestSourceContext = createContext<PullRequestSource | undefined>(undefined);

export const PullRequestSourceProvider = PullRequestSourceContext.Provider;

export function usePullRequestSource(): PullRequestSource | undefined {
  return useContext(PullRequestSourceContext);
}

export function agentPullRequestWrite(
  agentId: string,
  number: number | undefined,
): PullRequestSource["write"] {
  return (request) =>
    sendAct(ACT_KIND.AGENTS_PULL_REQUEST_ACTION, { ...pullRequestAsked(agentId, number), request });
}

export function useAgentPullRequestSource(
  control: AgentsControl,
  agentId: string,
  number: number | undefined,
): PullRequestSource {
  const write = useMemo(() => agentPullRequestWrite(agentId, number), [agentId, number]);
  const agent =
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId);
  const ended = !agentStillWriting(agent?.status ?? AGENT_STATUS.RUNNING);
  const taskId = agent?.planId ?? null;
  const { workspaceId } = control;
  const published = pullRequestOfTab(control, { changes: agentId, number });
  const { generateChapters } = control;
  const doors = useMemo(
    () => ({
      generateChapters: () => generateChapters(agentId, number),
      write,
    }),
    [write, agentId, number, generateChapters],
  );
  const place = useMemo(() => ({ taskId, workspaceId }), [taskId, workspaceId]);
  return useMemo(
    () => ({ ...doors, ended, place, published, number }),
    [doors, ended, place, published, number],
  );
}
