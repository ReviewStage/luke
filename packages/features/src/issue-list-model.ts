import {
  ISSUE_PRIORITY_RANK,
  ISSUE_STATUS_ORDER,
  type Issue,
  type IssueStatus,
} from "./issue-wire.js";

/**
 * issue-list-model.ts -- a workspace's issues as a window draws them: grouped by where each stands, the most pressing first, each named by its workspace's prefix and its number.
 *
 * The list falls into its statuses in the wire's own order, the work under
 * way first, and leaves out a status no issue stands in. Inside a status an
 * urgent issue stands above a high one, and an unweighed one at the foot;
 * issues of one priority stand the most recently changed first. An issue's
 * identifier is its workspace's prefix and its number, as `ACME-42`: the
 * prefix is read off the workspace's name rather than kept, so it follows a
 * rename.
 */

/** The prefix an identifier falls back on where the workspace's name holds no letter or digit. */
const FALLBACK_PREFIX = "ISSUE";

/** The most characters a prefix spells. */
const MAX_PREFIX_CHARS = 4;

/** One status's issues, as the list draws them under its heading. */
export interface IssueGroup {
  readonly status: IssueStatus;
  readonly issues: readonly Issue[];
}

/** The most pressing first, and of one priority the most recently changed first. */
function byPressing(a: Issue, b: Issue): number {
  const rank = ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority];
  return rank === 0 ? b.updatedAt - a.updatedAt : rank;
}

/** The issues grouped by status in the list's order, each group sorted, and no group empty. */
export function issueGroups(issues: readonly Issue[]): readonly IssueGroup[] {
  return ISSUE_STATUS_ORDER.flatMap((status) => {
    const standing = issues.filter((issue) => issue.status === status).toSorted(byPressing);
    return standing.length === 0 ? [] : [{ status, issues: standing }];
  });
}

/**
 * The prefix a workspace's issues are named by: the initials of a name of
 * several words, or the head of a name of one, upper-cased, so "Acme" is
 * ACME and "Luke Labs" is LL.
 */
function workspacePrefix(workspaceName: string): string {
  const words = workspaceName
    .replaceAll(/['’]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return FALLBACK_PREFIX;
  const prefix =
    words.length === 1
      ? Array.from(words[0] ?? "").slice(0, MAX_PREFIX_CHARS)
      : words.slice(0, MAX_PREFIX_CHARS).map((word) => Array.from(word)[0] ?? "");
  return prefix.join("").toLocaleUpperCase();
}

/** An issue's identifier in its workspace, as `ACME-42`. */
export function issueIdentifier(workspaceName: string, number: number): string {
  return `${workspacePrefix(workspaceName)}-${number}`;
}
