import {
  AGENT_STATUS,
  type AgentStatus,
  type ListedAgent,
  PULL_REQUEST_STATE,
} from "./agent-wire.js";
import type { TaskAgentsSummary, TaskPullRequestLine, TaskPullRequests } from "./task-wire.js";

/**
 * task-agents-model.ts -- a task's coding agents and their pull requests as every reader of them reads them, from the list the window follows live, and the one status its row wears.
 *
 * A task's row counts its agents (`TaskAgentsSummary`); the agents and pull
 * requests themselves are read from what the window holds beside the list
 * (`tasks-view.ts`'s `taskAgents` and `taskPullRequests`), every one of
 * them, in the order a task names them: its agents those at work first,
 * then the rest, newest started first within each, and its pull requests
 * those still open first, then merged, then closed.
 *
 * A row wears at most one status, as a devtool's sidebar does: the one
 * thing that matters most about its agents. An agent that failed comes
 * first; then one at work; then the pull request that matters most, an
 * open or draft one before a merged one, and a merged one before a closed
 * one. A task whose agents finished with nothing published wears none.
 * An agent's failure stops being the task's once another agent is started
 * on it after the failure, as a newer CI run decides a commit's check.
 *
 * Note that a thread waiting on the reader is no status here, because a
 * task's row says how many wait in a count of its own, standing before this
 * status: the sidebar's task row and the Tasks page's row and card alike
 * (`@repo/panel`'s `WaitingCount`).
 */

/** Where a task's agents stand, most pressing first. */
export const TASK_AGENTS_STATUS = {
  FAILED: "failed",
  WORKING: "working",
  PULL_REQUEST: "pull-request",
  NONE: "none",
} as const;

export type TaskAgentsStatus =
  | { readonly kind: typeof TASK_AGENTS_STATUS.FAILED }
  | { readonly kind: typeof TASK_AGENTS_STATUS.WORKING }
  | {
      readonly kind: typeof TASK_AGENTS_STATUS.PULL_REQUEST;
      readonly pullRequest: TaskPullRequestLine;
    }
  | { readonly kind: typeof TASK_AGENTS_STATUS.NONE };

const NO_STATUS: TaskAgentsStatus = { kind: TASK_AGENTS_STATUS.NONE };

/** The pull request states in the order a task's status picks among them: still to be acted on, then merged, then closed. */
const PULL_REQUEST_ORDER = [
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.MERGED]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.CLOSED]),
] as const;

/** The pull request a task's status names: the first of the earliest state in `PULL_REQUEST_ORDER`. */
function markedPullRequest(
  pullRequests: readonly TaskPullRequestLine[],
): TaskPullRequestLine | undefined {
  for (const states of PULL_REQUEST_ORDER) {
    const found = pullRequests.find((each) => states.has(each.state));
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * How many of a task's unarchived `agents` failed with no agent started on
 * the task since `latestStart`, each failing when its last turn settled, or
 * as it started where it ran none. Note that `latestStart` counts the
 * archived agents too, because archiving the agent that took over from a
 * failure must not bring the failure back. The held and live reads both
 * count `TaskAgentsSummary.failed` here, so the two agree.
 */
export function standingFailures(
  agents: readonly {
    readonly createdAt: number;
    readonly status: AgentStatus;
    /** When its last turn settled; none where it ran none. */
    readonly at: number | undefined;
  }[],
  latestStart: number,
): number {
  return agents.filter(
    ({ createdAt, status, at }) =>
      status === AGENT_STATUS.FAILED && (at ?? createdAt) >= latestStart,
  ).length;
}

/** The statuses under which an agent is at work. */
const WORKING: ReadonlySet<ListedAgent["status"]> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** What ordering a task's agents reads of each. */
type OrderedAgent = Pick<ListedAgent, "id" | "planId" | "status" | "createdAt" | "archivedAt">;

/** Those at work first, then the rest, newest started first within each, and by id among those started at one instant. */
function workingFirst(a: OrderedAgent, b: OrderedAgent): number {
  const working = Number(WORKING.has(b.status)) - Number(WORKING.has(a.status));
  if (working !== 0) return working;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A task's agents among those the window holds, the archived left out, those at work first, then the rest, newest started first within each. */
export function agentsOfTask<Agent extends OrderedAgent>(
  agents: readonly Agent[] | undefined,
  taskId: string,
): readonly Agent[] {
  return (agents ?? [])
    .filter((agent) => agent.planId === taskId && agent.archivedAt === undefined)
    .toSorted(workingFirst);
}

/** When an agent last moved, as a row naming it says: when its run began while it works, when its newest turn ended once it has; none where neither is known. */
export function agentMovedAt(
  agent: Pick<ListedAgent, "status" | "runStartedAt" | "settledAt">,
): number | undefined {
  return WORKING.has(agent.status) ? agent.runStartedAt : agent.settledAt;
}

/** A task's pull requests among those the window holds, every one, in the order the task names them; none where it opened none. */
export function pullRequestsOfTask(
  listed: readonly TaskPullRequests[] | undefined,
  taskId: string,
): readonly TaskPullRequestLine[] {
  return listed?.find((each) => each.taskId === taskId)?.pullRequests ?? [];
}

/** The one status a task's row wears for what its agents are doing and what they published, its pull requests every one it opened (`pullRequestsOfTask`). */
export function taskAgentsStatus(
  agents: TaskAgentsSummary | undefined,
  pullRequests: readonly TaskPullRequestLine[],
): TaskAgentsStatus {
  if (agents === undefined) return NO_STATUS;
  if ((agents.failed ?? 0) > 0) return { kind: TASK_AGENTS_STATUS.FAILED };
  if (agents.working > 0) return { kind: TASK_AGENTS_STATUS.WORKING };
  const pullRequest = markedPullRequest(pullRequests);
  return pullRequest === undefined
    ? NO_STATUS
    : { kind: TASK_AGENTS_STATUS.PULL_REQUEST, pullRequest };
}
