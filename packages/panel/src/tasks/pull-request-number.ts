import type { AgentPullRequest } from "@repo/features/agent-wire";
import { createContext, useContext } from "react";
import type { AgentsControl } from "./use-agents.js";

const PullRequestNumberContext = createContext<number | undefined>(undefined);

export const PullRequestNumberProvider = PullRequestNumberContext.Provider;

export function usePullRequestNumber(): number | undefined {
  return useContext(PullRequestNumberContext);
}

export function pullRequestAsked(
  agentId: string,
  number: number | undefined,
): { readonly agentId: string; readonly number?: number } {
  return number === undefined ? { agentId } : { agentId, number };
}

export type ByPullRequestTab<V> = ReadonlyMap<string, ReadonlyMap<number | undefined, V>>;

export function ofPullRequestTab<V>(
  kept: ByPullRequestTab<V>,
  tab: { readonly changes: string; readonly number?: number | undefined },
): V | undefined {
  return kept.get(tab.changes)?.get(tab.number);
}

export function withPullRequestTab<V>(
  kept: ByPullRequestTab<V>,
  tab: { readonly changes: string; readonly number?: number | undefined },
  value: V | undefined,
): ByPullRequestTab<V> {
  const ofAgent = new Map(kept.get(tab.changes));
  if (value === undefined) ofAgent.delete(tab.number);
  else ofAgent.set(tab.number, value);
  const next = new Map(kept);
  if (ofAgent.size === 0) next.delete(tab.changes);
  else next.set(tab.changes, ofAgent);
  return next;
}

export function pullRequestOfTab(
  control: Pick<AgentsControl, "pullRequests" | "numberedPullRequests">,
  tab: { readonly changes: string; readonly number?: number | undefined },
): AgentPullRequest | undefined {
  return tab.number === undefined
    ? control.pullRequests.get(tab.changes)
    : ofPullRequestTab(control.numberedPullRequests, tab);
}
