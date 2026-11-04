import type { AgentPullRequestAnswerView } from "@repo/features/agent-view";
import type { AgentPullRequest, AgentPullRequestAnswer } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { useHostRead } from "../use-host-read.js";

/**
 * use-agent-pull-request.ts -- what one agent published, as its tab draws it: the pull request the task list carries for it, and its branch as the host holds it while the tab shows.
 *
 * The service writes what an agent published on its row as it happens, the
 * agent's own `open_pull_request` among it, GitHub's webhook, and the
 * minute's sweep of a token's pull requests, and the task list carries it
 * (`useListedPullRequests`), so the tab draws a pull request the agent
 * opened mid-run without a read of its own. What the row leaves out is the
 * branch the agent pushed and its repository, which the dock's copies and
 * the branch's chip name: the host holds them while the tab shows
 * (`LIVE_READ.PULL_REQUEST_PUBLISHED`), asked again as a window comes
 * forward, as the agent's status moves, its end among it, and as the list
 * first names the pull request it opened or its line moves. A read the
 * service could not give leaves what was drawn standing; another agent's
 * tab starts from nothing of this one's.
 *
 * The task list carries every agent's pull request beside its agents, so
 * the side panel's "+", the task's summary, and ⌘K offer an agent's
 * Changes tab exactly while it has a pull request, its tab open or not.
 */

/** What the tab draws of what the agent published. */
export interface AgentPublished {
  /** The branch and repository the host holds, with the pull request the task list carries, else the one the host read; nothing before either. */
  readonly published: AgentPullRequestAnswer | undefined;
}

/** What the agent published, from what the host holds and the pull request the list carries: the list's pull request first, since it moves without a read. */
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
  /** Whether the tab is on screen, while which the host holds what the agent published. */
  shown: boolean;
  /** The pull request the task list carries for the agent (`useListedPullRequests`). */
  known?: AgentPullRequest | undefined;
}): AgentPublished {
  const { agentId, shown, known } = input;
  const held = useHostRead(LIVE_READ.PULL_REQUEST_PUBLISHED, shown ? { agentId } : undefined).rows;
  return useMemo(() => ({ published: publishedOf(held, known) }), [held, known]);
}

/** No agent has a pull request, one map so a render that has none hands down the same one. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** Whose agents' pull requests: a plan's, or one agent's on no task, by its id. */
export type PullRequestHolder = { readonly taskId: string } | { readonly agentId: string };

/**
 * Which of a plan's agents have a pull request, or whether the one agent on
 * no task given has, as the side panel's "+", the task's summary, and ⌘K
 * offer its Changes tab by: what the task list carries of each (`listed`),
 * as the service last read it on GitHub, archived agents among them, so
 * choosing a task, or an item of it, reads nothing. A read of what an agent
 * published, its tab's (`useAgentPullRequest`) among them, is written on the
 * agent's row too, which the list then carries. Note that the
 * map is built again only as the list's pull requests move, since the
 * document keeps their identity while none does, so nothing drawn from it is
 * drawn again.
 */
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

/** The pull request the task list holds of one agent, as its row keeps it. */
const listedPullRequestAtom = Atom.family((agentId: string) =>
  Atom.map(
    APP_SLICE.TASKS,
    (tasks) => tasks?.agentPullRequests?.find((each) => each.agentId === agentId)?.pullRequest,
  ),
);

/**
 * The pull request one agent opened, as the service last synced it onto the
 * agent's row and the task list carries it, a hover card's whole source of
 * it, so hanging one asks the service nothing; none where it opened none,
 * and before the list first answers live. The document keeps a row's
 * identity while it does not move, so its reader is drawn again only as it
 * does.
 */
export function useListedPullRequest(agentId: string): AgentPullRequest | undefined {
  return useAppSlice(listedPullRequestAtom(agentId));
}
