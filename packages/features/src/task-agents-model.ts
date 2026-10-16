import { PULL_REQUEST_STATE } from "./coding-agent-wire.js";
import type { TaskAgentsSummary, TaskPullRequestLine } from "./task-wire.js";

/**
 * task-agents-model.ts -- what a plan's coding agents say on its sidebar row and its hover card: the row's one mark, and the card's lines.
 *
 * A row wears at most one mark, as a devtool's sidebar does: a spinner
 * while any agent works on the plan, else the pull request that matters
 * most, an open or draft one first and else a merged one, and else none.
 * A closed pull request marks nothing, since nothing is left to do with it.
 * The card names a few of the agents and pull requests the list carried and
 * counts the rest, so it is read from the list alone and never fetched.
 */

/** The one mark a plan's row wears at its end. */
export const TASK_ROW_MARK = {
  WORKING: "working",
  PULL_REQUEST: "pull-request",
  NONE: "none",
} as const;

export type TaskRowMark =
  | { readonly kind: typeof TASK_ROW_MARK.WORKING }
  | { readonly kind: typeof TASK_ROW_MARK.PULL_REQUEST; readonly pullRequest: TaskPullRequestLine }
  | { readonly kind: typeof TASK_ROW_MARK.NONE };

const NO_MARK: TaskRowMark = { kind: TASK_ROW_MARK.NONE };

/** The pull request states a row is marked for while one is still to be acted on. */
const STANDING_STATES: ReadonlySet<TaskPullRequestLine["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** The mark a plan's row wears for what its agents are doing and what they published. */
export function taskRowMark(agents: TaskAgentsSummary | undefined): TaskRowMark {
  if (agents === undefined) return NO_MARK;
  if (agents.working > 0) return { kind: TASK_ROW_MARK.WORKING };
  const pullRequest =
    agents.pullRequests.find((each) => STANDING_STATES.has(each.state)) ??
    agents.pullRequests.find((each) => each.state === PULL_REQUEST_STATE.MERGED);
  return pullRequest === undefined ? NO_MARK : { kind: TASK_ROW_MARK.PULL_REQUEST, pullRequest };
}

/** What a card says after the rows it draws: how many more stand than it names, or nothing. */
export function moreText(total: number, shown: number): string | undefined {
  const more = total - shown;
  return more > 0 ? `${more} more` : undefined;
}
