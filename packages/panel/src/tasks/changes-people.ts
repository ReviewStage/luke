/**
 * changes-people.ts -- who an agent's own pull request names, as its Changes tab last read them, for every card that hangs beside it.
 *
 * The people are read from the agent's changes in the Query cache, which its
 * Changes tab fills (`useChangesReads`). A card reads its own agent's entry,
 * or a surface the entries of the agents it already knows, through observers
 * that are disabled because they only read what the tab fetched; an agent
 * whose changes no tab has read names nobody.
 */

import type { AgentChangesAnswerView } from "@repo/features/agent-view";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { agentChangesQueryOptions } from "./agent-reads.js";
import type { HeldPeople } from "./use-agents.js";

/** An agent's changes as read, which a failure never is. */
type ChangesRead = Exclude<AgentChangesAnswerView, { readonly failure: unknown }>;

/** Who the changes' pull request names, with the pull request they were read for; none where they name none. */
function heldPeopleOf(answer: ChangesRead): HeldPeople | undefined {
  if (answer.pullRequest === null) return undefined;
  const { url, files: _files, truncated: _truncated, ...people } = answer.pullRequest;
  return { url, people };
}

/** Who one agent's pull request names, as its Changes tab last read them; none before it read them, and for no agent. */
export function useChangesPeople(agentId: string | undefined): HeldPeople | undefined {
  return useQuery({
    ...agentChangesQueryOptions(agentId, undefined),
    enabled: false,
    select: heldPeopleOf,
  }).data;
}

/** Who each of the agents' pull requests names, by agent, of those whose Changes tab read them. */
export function useChangesPeopleOf(agentIds: readonly string[]): ReadonlyMap<string, HeldPeople> {
  const combine = useCallback(
    (results: readonly { readonly data?: HeldPeople | undefined }[]) => {
      const people = new Map<string, HeldPeople>();
      results.forEach((result, at) => {
        const agentId = agentIds[at];
        if (agentId !== undefined && result.data !== undefined) people.set(agentId, result.data);
      });
      return people;
    },
    [agentIds],
  );
  return useQueries({
    queries: agentIds.map((agentId) => ({
      ...agentChangesQueryOptions(agentId, undefined),
      enabled: false,
      select: heldPeopleOf,
    })),
    combine,
  });
}
