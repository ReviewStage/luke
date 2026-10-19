/**
 * task-issue-wire.ts -- the external issues a task links: which provider holds each, and which keyword its pull requests say of it.
 *
 * A task links any number of issues, up to `TASK_BOUNDS.MAX_ISSUES`
 * (`task-wire.ts`), each one of Linear's or of GitHub's, through one link of
 * the same shape whatever its provider (`@luke/database`'s `task_issue`). A
 * link names its issue by the provider's own id, which survives a team move
 * or a repository rename, and keeps what a chip draws of it and the
 * description an agent's brief reads, copied when the link was made. Its
 * relation says which keyword a coding agent writes of it in a pull
 * request: `closes` lets the provider settle the issue as the pull request
 * merges, and `part_of` links the pull request to it without settling it.
 * The issue's state, assignee, and labels are the provider's, read live and
 * never kept.
 */

/** Who holds an issue a task links. */
export const TASK_ISSUE_PROVIDER = {
  LINEAR: "linear",
  GITHUB: "github",
} as const;

export type TaskIssueProvider = (typeof TASK_ISSUE_PROVIDER)[keyof typeof TASK_ISSUE_PROVIDER];

/** What a task's pull requests do to an issue it links: settle it as they merge, or only link to it. */
export const TASK_ISSUE_RELATION = {
  CLOSES: "closes",
  PART_OF: "part_of",
} as const;

export type TaskIssueRelation = (typeof TASK_ISSUE_RELATION)[keyof typeof TASK_ISSUE_RELATION];
