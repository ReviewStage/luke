import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../use-app-state.js";
import type { AgentsControl } from "./use-agents.js";

const selectListedPullRequests = (state: AppStateSnapshot) => state.tasks.agentPullRequests;

function listsAgent(agents: AgentsControl, agentId: string): boolean {
  const among = (list: readonly AgentSummary[] | undefined) =>
    list?.some((each) => each.id === agentId) === true;
  return among(agents.agents) || among(agents.archived);
}

function listedPullRequestOf(
  listed: readonly ListedPullRequest[] | undefined,
  agentId: string,
): AgentPullRequest | undefined {
  return listed?.find((each) => each.agentId === agentId)?.pullRequest;
}

export function useAgentsElsewhere(
  agents: AgentsControl,
  named: readonly string[],
): (agentId: string) => AgentsControl {
  const listed = useQuery({ ...appStateQuery, select: selectListedPullRequests }).data;
  const [rows, setRows] = useState<ReadonlyMap<string, AgentSummary>>(() => new Map());
  const asked = useRef(new Set<string>());
  const unread = named.filter(
    (agentId) => !listsAgent(agents, agentId) && !asked.current.has(agentId),
  );
  const { readAgent } = agents;
  useEffect(() => {
    for (const agentId of unread) {
      if (asked.current.has(agentId)) continue;
      asked.current.add(agentId);
      readAgent(agentId).then(
        (row) =>
          row === undefined ? undefined : setRows((was) => new Map([...was, [agentId, row]])),
        () => undefined,
      );
    }
  });
  return useMemo(() => {
    const byAgent = new Map<string, AgentsControl>();
    return (agentId) => {
      if (listsAgent(agents, agentId)) return agents;
      const known = byAgent.get(agentId);
      if (known !== undefined) return known;
      const row = rows.get(agentId);
      const pullRequest = listedPullRequestOf(listed, agentId);
      const control: AgentsControl = {
        ...agents,
        agents: row === undefined ? agents.agents : [...(agents.agents ?? []), row],
        pullRequests:
          pullRequest === undefined
            ? agents.pullRequests
            : new Map([...agents.pullRequests, [agentId, pullRequest]]),
      };
      byAgent.set(agentId, control);
      return control;
    };
  }, [agents, rows, listed]);
}
