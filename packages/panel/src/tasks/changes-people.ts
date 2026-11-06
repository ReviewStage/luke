import type { AgentChangesAnswerView } from "@repo/features/agent-view";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { agentChangesQueryOptions } from "./agent-reads.js";
import type { HeldPeople } from "./use-agents.js";

type ChangesRead = Exclude<AgentChangesAnswerView, { readonly failure: unknown }>;

function heldPeopleOf(answer: ChangesRead): HeldPeople | undefined {
  if (answer.pullRequest === null) return undefined;
  const { url, files: _files, truncated: _truncated, ...people } = answer.pullRequest;
  return { url, people };
}

export function useChangesPeople(agentId: string | undefined): HeldPeople | undefined {
  return useQuery({
    ...agentChangesQueryOptions(agentId, undefined),
    enabled: false,
    select: heldPeopleOf,
  }).data;
}

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
