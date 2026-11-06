import { PULL_REQUEST_STATE } from "./agent-wire.js";
import type { TaskAgentsSummary, TaskPullRequestLine } from "./task-wire.js";

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

const PULL_REQUEST_ORDER = [
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.MERGED]),
  new Set<TaskPullRequestLine["state"]>([PULL_REQUEST_STATE.CLOSED]),
] as const;

function markedPullRequest(
  pullRequests: readonly TaskPullRequestLine[],
): TaskPullRequestLine | undefined {
  for (const states of PULL_REQUEST_ORDER) {
    const found = pullRequests.find((each) => states.has(each.state));
    if (found !== undefined) return found;
  }
  return undefined;
}

export function taskAgentsStatus(agents: TaskAgentsSummary | undefined): TaskAgentsStatus {
  if (agents === undefined) return NO_STATUS;
  if ((agents.failed ?? 0) > 0) return { kind: TASK_AGENTS_STATUS.FAILED };
  if (agents.working > 0) return { kind: TASK_AGENTS_STATUS.WORKING };
  const pullRequest = markedPullRequest(agents.pullRequests);
  return pullRequest === undefined
    ? NO_STATUS
    : { kind: TASK_AGENTS_STATUS.PULL_REQUEST, pullRequest };
}
