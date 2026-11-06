import { AGENT_STATUS, PULL_REQUEST_STATE } from "./agent-wire.js";
import type { TaskAgentLine, TaskAgentsSummary, TaskPullRequestLine } from "./task-wire.js";

/**
 * task-agents-model.ts -- how a task's coding agents stand, in the one status its row wears.
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
  agents: readonly { readonly createdAt: number; readonly line: TaskAgentLine }[],
  latestStart: number,
): number {
  return agents.filter(
    ({ createdAt, line }) =>
      line.status === AGENT_STATUS.FAILED && (line.at ?? createdAt) >= latestStart,
  ).length;
}

/** The one status a task's row wears for what its agents are doing and what they published. */
export function taskAgentsStatus(agents: TaskAgentsSummary | undefined): TaskAgentsStatus {
  if (agents === undefined) return NO_STATUS;
  if ((agents.failed ?? 0) > 0) return { kind: TASK_AGENTS_STATUS.FAILED };
  if (agents.working > 0) return { kind: TASK_AGENTS_STATUS.WORKING };
  const pullRequest = markedPullRequest(agents.pullRequests);
  return pullRequest === undefined
    ? NO_STATUS
    : { kind: TASK_AGENTS_STATUS.PULL_REQUEST, pullRequest };
}
