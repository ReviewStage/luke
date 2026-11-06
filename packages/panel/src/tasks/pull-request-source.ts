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

/**
 * pull-request-source.ts -- where a Pull request tab reads and writes the pull request it shows: one door in front of the reads the tab asks itself and every change it and its parts make.
 *
 * The tab and its parts, its header, Conversation, Checks, Chapters, and
 * Files changed, ask through a `PullRequestSource` for the pull request as
 * last read, its changed files, and its chapters' Generate, and make every
 * change through it, a review's among them. What the host holds for the tab
 * apart from these, its parts, the pickers' options, and the viewed marks,
 * each part draws through `useHostRead`, under the agent and the number the
 * source names. A tab is an agent's for now (`agentPullRequestSource`), so each read
 * names the agent, and the pull request's number where the tab names one
 * (`pull-request-number.ts`). The tab hands its source down
 * (`PullRequestSourceProvider`), so a change made anywhere under it goes to
 * the same pull request its reads came from.
 */

/** Every read and change a Pull request tab makes of the pull request it shows. */
export interface PullRequestSource {
  /** Whether what the pull request shows has settled, its agent no longer writing, which its reads are asked again on (`useChangesReads`). */
  readonly ended: boolean;
  /** Where a repository out of reach is mended, and the task its files' texts are read through. */
  readonly place: WritePlace;
  /** The pull request as last read, which names the tab before its overview lands; none before it is read. */
  readonly published: AgentPullRequest | undefined;
  /** The pull request's number where the tab names one; none for the agent's own, which its reads, held by the host, stand under (`OWN_PULL_REQUEST`). */
  readonly number: number | undefined;
  /** Its chapters generated for its head now, answering once they land. */
  readonly generateChapters: () => Promise<PullRequestChaptersAnswerView>;
  /** One change to it, a viewed mark and a review among them. */
  readonly write: (request: PullRequestActionRequest) => Promise<AgentPullRequestWriteAnswerView>;
}

const PullRequestSourceContext = createContext<PullRequestSource | undefined>(undefined);

/** Hands everything under a Pull request tab the source it reads and writes through. */
export const PullRequestSourceProvider = PullRequestSourceContext.Provider;

/** The source of the Pull request tab the caller stands in; none outside one. */
export function usePullRequestSource(): PullRequestSource | undefined {
  return useContext(PullRequestSourceContext);
}

/** One change to the agent's pull request, or to the one of its repository by the number given, sent through the port; the change's mutation is its caller's (`pull-request-writes.tsx`). */
export function agentPullRequestWrite(
  agentId: string,
  number: number | undefined,
): PullRequestSource["write"] {
  return (request) =>
    sendAct(ACT_KIND.AGENTS_PULL_REQUEST_ACTION, { ...pullRequestAsked(agentId, number), request });
}

/**
 * The source of an agent's Pull request tab: the pull request from the
 * branch the agent stands on, or the one of its repository the tab names by
 * its number. The agent is found among the archived too, since an archived
 * agent's pull request keeps its tab.
 */
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
  // Note that the doors are kept while what they name stands, because every part under the tab that hears the source draws anew on a new one.
  const doors = useMemo(
    () => ({
      generateChapters: () => generateChapters(agentId, number),
      write,
    }),
    [write, agentId, number, generateChapters],
  );
  // Note that a repository out of reach is mended in the agent's own workspace, by its task or, on none, its page's.
  const place = useMemo(() => ({ taskId, workspaceId }), [taskId, workspaceId]);
  return useMemo(
    () => ({ ...doors, ended, place, published, number }),
    [doors, ended, place, published, number],
  );
}
