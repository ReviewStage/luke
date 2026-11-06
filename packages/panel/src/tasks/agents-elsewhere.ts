import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../use-app-state.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * agents-elsewhere.ts -- the agents a side panel's Pull request and Terminal tabs name, read where the agent stands rather than through the place the panel stands beside.
 *
 * A panel stands beside one place, a task, an agent's page, or the Inbox,
 * and is handed that place's agents (`AgentsControl`). A Pull request or
 * Terminal tab reads through acts keyed by its agent, which answer
 * anywhere, but it draws the agent's row, whether it ended and its task,
 * and the pull request it published from that control. A tab of an agent
 * the place does not list reads its row once by the agent's id
 * (`readAgent`), and its pull request from the window's own list of every
 * agent's (`agentPullRequests`), so it draws as it would beside its own
 * place. An agent the place lists is drawn through the place's control
 * unchanged.
 */

/** Every agent's pull request the window's task list carries, a task's or one on none. */
const selectListedPullRequests = (state: AppStateSnapshot) => state.tasks.agentPullRequests;

/** Whether the place's control lists the agent, archived or not. */
function listsAgent(agents: AgentsControl, agentId: string): boolean {
  const among = (list: readonly AgentSummary[] | undefined) =>
    list?.some((each) => each.id === agentId) === true;
  return among(agents.agents) || among(agents.archived);
}

/** The pull request the window's list holds of the agent's; none where it opened none. */
function listedPullRequestOf(
  listed: readonly ListedPullRequest[] | undefined,
  agentId: string,
): AgentPullRequest | undefined {
  return listed?.find((each) => each.agentId === agentId)?.pullRequest;
}

/**
 * The control each of the tabs' agents is drawn through: the place's own
 * for an agent it lists, else the place's with the agent's row, once read,
 * and its listed pull request beside its own. `named` is the agents the
 * drawn tabs name.
 */
export function useAgentsElsewhere(
  agents: AgentsControl,
  named: readonly string[],
): (agentId: string) => AgentsControl {
  const listed = useQuery({ ...appStateQuery, select: selectListedPullRequests }).data;
  const [rows, setRows] = useState<ReadonlyMap<string, AgentSummary>>(() => new Map());
  // The agents asked for once, so a read that found none is not asked again on every draw.
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
        // Note that the row stands among the agents archived or not, as an agent's own page lists its agent.
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
