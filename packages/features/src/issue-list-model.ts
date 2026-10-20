import {
  ISSUE_PRIORITY,
  ISSUE_PRIORITY_RANK,
  ISSUE_STATUS,
  ISSUE_STATUS_ORDER,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from "./issue-wire.js";
import { workspacePrefix } from "./workspace-key.js";

/**
 * issue-list-model.ts -- a workspace's issues as a window draws them: grouped by where each stands, the most pressing first, each named by its workspace's prefix and its number.
 *
 * The list falls into its statuses in the wire's own order, the work under
 * way first, and leaves out a status no issue stands in; or, grouped by
 * priority, into its priorities, the most pressing first, each listing the
 * work under way first. A board stands a
 * column for every status in the order work moves through them, left to
 * right, so it reads as a line from the backlog to what settled. Inside a status an
 * urgent issue stands above a high one, and an unweighed one at the foot;
 * issues of one priority stand the most recently changed first. An issue's
 * identifier is its workspace's prefix and its number, as `ACME-42`: the
 * prefix is read off the workspace's name rather than kept, so it follows a
 * rename.
 *
 * A filter narrows what is drawn before it is grouped: to a set of
 * priorities, to the issues one member filed, and past settled issues gone
 * quiet, a Done or Canceled issue last changed over a week before the
 * moment its caller names, which a filter may leave out while a recent one
 * still stands.
 */

/** The prefix an identifier falls back on where the workspace's name holds no letter or digit. */
const FALLBACK_PREFIX = "ISSUE";

/** How long a settled issue stays in sight after its last change while settled issues gone quiet are left out: a week. */
const SETTLED_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

/** The statuses an issue is settled in: done with, one way or the other. */
const SETTLED: ReadonlySet<IssueStatus> = new Set([ISSUE_STATUS.DONE, ISSUE_STATUS.CANCELED]);

/** The order a board's columns stand in: the order work moves through the statuses, the settled last. */
const BOARD_ORDER: readonly IssueStatus[] = [
  ISSUE_STATUS.BACKLOG,
  ISSUE_STATUS.TODO,
  ISSUE_STATUS.IN_PROGRESS,
  ISSUE_STATUS.DONE,
  ISSUE_STATUS.CANCELED,
];

/** Each status as a group's heading and a picker's row say it. */
export const ISSUE_STATUS_WORDS = {
  [ISSUE_STATUS.BACKLOG]: "Backlog",
  [ISSUE_STATUS.TODO]: "Todo",
  [ISSUE_STATUS.IN_PROGRESS]: "In progress",
  [ISSUE_STATUS.DONE]: "Done",
  [ISSUE_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<IssueStatus, string>;

/** Each priority as a row's mark and a picker's row say it. */
export const ISSUE_PRIORITY_WORDS = {
  [ISSUE_PRIORITY.NONE]: "No priority",
  [ISSUE_PRIORITY.URGENT]: "Urgent",
  [ISSUE_PRIORITY.HIGH]: "High",
  [ISSUE_PRIORITY.MEDIUM]: "Medium",
  [ISSUE_PRIORITY.LOW]: "Low",
} as const satisfies Record<IssuePriority, string>;

/** One status's issues, as the list draws them under its heading. */
export interface IssueGroup {
  readonly status: IssueStatus;
  readonly issues: readonly Issue[];
}

/**
 * What a window leaves out of a workspace's issues: the priorities it
 * shows, every one where none is named; the member whose issues alone it
 * shows, by account id, everyone's where none is; and whether settled
 * issues gone quiet show.
 */
export interface IssueFilter {
  readonly priorities?: readonly IssuePriority[];
  readonly createdBy?: string;
  readonly showCompleted: boolean;
}

/**
 * The filter a workspace's issues first draw under: every priority and
 * everyone's issues, settled issues gone quiet left out, as Linear's board
 * leaves them.
 */
export const DEFAULT_ISSUE_FILTER: IssueFilter = { showCompleted: false };

/** Whether a filter differs from the one a workspace's issues first draw under. */
export function issueFilterChanged(filter: IssueFilter): boolean {
  return filter.priorities !== undefined || filter.createdBy !== undefined || filter.showCompleted;
}

/**
 * The filter Clear filters goes back to: the first filter where that keeps
 * any of the issues, else every issue shown, settled ones gone quiet among
 * them, so the press always draws something.
 */
export function clearedIssueFilter(issues: readonly Issue[], now: number): IssueFilter {
  return filteredIssues(issues, DEFAULT_ISSUE_FILTER, now).length > 0
    ? DEFAULT_ISSUE_FILTER
    : { showCompleted: true };
}

/**
 * The filter with `priority` shown or no longer shown: from every priority
 * it narrows to that one, and narrowed it adds or takes it away; taking the
 * last away, or adding the last, shows every priority again.
 */
export function issueFilterToggledPriority(
  filter: IssueFilter,
  priority: IssuePriority,
): IssueFilter {
  const shown = filter.priorities ?? [];
  const next = shown.includes(priority)
    ? shown.filter((each) => each !== priority)
    : [...shown, priority];
  const every = Object.values(ISSUE_PRIORITY).every((each) => next.includes(each));
  const rest = issueFilterAnyPriority(filter);
  return next.length === 0 || every ? rest : { ...rest, priorities: next };
}

/** The filter showing every priority, the rest of it as it stands. */
export function issueFilterAnyPriority(filter: IssueFilter): IssueFilter {
  const { createdBy, showCompleted } = filter;
  return createdBy === undefined ? { showCompleted } : { createdBy, showCompleted };
}

/** The filter showing one member's issues, by account id, or everyone's for undefined, the rest of it as it stands. */
export function issueFilterCreatedBy(
  filter: IssueFilter,
  createdBy: string | undefined,
): IssueFilter {
  const { priorities, showCompleted } = filter;
  const rest = priorities === undefined ? { showCompleted } : { priorities, showCompleted };
  return createdBy === undefined ? rest : { ...rest, createdBy };
}

/** Whether an issue is settled and last changed over a week before `now`. */
function settledQuiet(issue: Issue, now: number): boolean {
  return SETTLED.has(issue.status) && now - issue.updatedAt > SETTLED_QUIET_MS;
}

/** The issues the filter keeps as of `now`, in the order given. */
export function filteredIssues(
  issues: readonly Issue[],
  filter: IssueFilter,
  now: number,
): readonly Issue[] {
  const { priorities, createdBy, showCompleted } = filter;
  return issues.filter(
    (issue) =>
      (priorities === undefined || priorities.includes(issue.priority)) &&
      (createdBy === undefined || issue.creator?.userId === createdBy) &&
      (showCompleted || !settledQuiet(issue, now)),
  );
}

/** The most pressing first, and of one priority the most recently changed first. */
function byPressing(a: Issue, b: Issue): number {
  const rank = ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority];
  return rank === 0 ? b.updatedAt - a.updatedAt : rank;
}

/** Each status of `order` with its issues, each sorted, an empty status among them. */
function grouped(order: readonly IssueStatus[], issues: readonly Issue[]): readonly IssueGroup[] {
  return order.map((status) => ({
    status,
    issues: issues.filter((issue) => issue.status === status).toSorted(byPressing),
  }));
}

/** Every status's issues in the board's order, each sorted, an empty status among them: a board's columns. */
export function issueColumns(issues: readonly Issue[]): readonly IssueGroup[] {
  return grouped(BOARD_ORDER, issues);
}

/** The issues grouped by status in the list's order, each group sorted, and no group empty. */
export function issueGroups(issues: readonly Issue[]): readonly IssueGroup[] {
  return grouped(ISSUE_STATUS_ORDER, issues).filter((group) => group.issues.length > 0);
}

/** How the list groups its issues: under a heading for each status, as it first opens, or for each priority. */
export const ISSUE_GROUPING = {
  STATUS: "status",
  PRIORITY: "priority",
} as const;

export type IssueGrouping = (typeof ISSUE_GROUPING)[keyof typeof ISSUE_GROUPING];

/** One heading's issues as the list draws them: what the heading stands for, what it says, and its issues in order. */
export interface IssueListGroup {
  readonly key: IssueStatus | IssuePriority;
  readonly words: string;
  readonly issues: readonly Issue[];
}

/** The order the list's priority headings stand in: the most pressing first, an unweighed issue's last. */
const PRIORITY_ORDER: readonly IssuePriority[] = Object.values(ISSUE_PRIORITY).toSorted(
  (a, b) => ISSUE_PRIORITY_RANK[a] - ISSUE_PRIORITY_RANK[b],
);

/** Where a status stands in the list's order. */
function statusRank(status: IssueStatus): number {
  return ISSUE_STATUS_ORDER.indexOf(status);
}

/** The work under way first, as the list orders its statuses, and of one status the most recently changed first. */
function byStanding(a: Issue, b: Issue): number {
  const rank = statusRank(a.status) - statusRank(b.status);
  return rank === 0 ? b.updatedAt - a.updatedAt : rank;
}

/**
 * The list's headings by the grouping chosen, no heading empty: by status,
 * the work under way first and the most pressing first inside each; or by
 * priority, the most pressing first and an unweighed issue's last, and
 * inside each the work under way first, the most recently changed first.
 */
export function issueListGroups(
  issues: readonly Issue[],
  grouping: IssueGrouping,
): readonly IssueListGroup[] {
  if (grouping === ISSUE_GROUPING.STATUS) {
    return issueGroups(issues).map((group) => ({
      key: group.status,
      words: ISSUE_STATUS_WORDS[group.status],
      issues: group.issues,
    }));
  }
  return PRIORITY_ORDER.map((priority) => ({
    key: priority,
    words: ISSUE_PRIORITY_WORDS[priority],
    issues: issues.filter((issue) => issue.priority === priority).toSorted(byStanding),
  })).filter((group) => group.issues.length > 0);
}

/** An issue's identifier in its workspace, as `ACME-42`. */
export function issueIdentifier(workspaceName: string, number: number): string {
  return `${workspacePrefix(workspaceName, FALLBACK_PREFIX)}-${number}`;
}
