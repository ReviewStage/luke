import { Schema as EffectSchema } from "effect";
import {
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
} from "./github-repositories-wire.js";
import { linearIssueIdSchema } from "./linear-wire.js";

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
 * never kept. A task started with issues names each by what its provider
 * finds it by (`taskIssueChoiceSchema`), and the service reads each itself
 * before it links it, so nothing a client says of an issue is kept.
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

const taskIssueRelationSchema = EffectSchema.Literals(Object.values(TASK_ISSUE_RELATION));

/**
 * One issue a task is started linked to, as New task names it: a Linear
 * issue by its id, or a GitHub issue by its repository and number, with the
 * keyword its pull requests write of it, `closes` where none is named.
 */
export const taskIssueChoiceSchema = EffectSchema.Union([
  EffectSchema.Struct({
    provider: EffectSchema.Literal(TASK_ISSUE_PROVIDER.LINEAR),
    id: linearIssueIdSchema,
    relation: EffectSchema.optionalKey(taskIssueRelationSchema),
  }),
  EffectSchema.Struct({
    provider: EffectSchema.Literal(TASK_ISSUE_PROVIDER.GITHUB),
    repository: githubRepositoryFullNameSchema,
    number: githubPullRequestNumberSchema,
    relation: EffectSchema.optionalKey(taskIssueRelationSchema),
  }),
]);

export type TaskIssueChoice = typeof taskIssueChoiceSchema.Type;

/**
 * Whether two choices name the same issue: the same Linear id, or the same
 * number of the same repository, whatever case its name is spelled in, as
 * GitHub reads it.
 */
export function sameIssueChoice(a: TaskIssueChoice, b: TaskIssueChoice): boolean {
  if (a.provider === TASK_ISSUE_PROVIDER.LINEAR || b.provider === TASK_ISSUE_PROVIDER.LINEAR) {
    return a.provider === b.provider && "id" in a && "id" in b && a.id === b.id;
  }
  return a.number === b.number && a.repository.toLowerCase() === b.repository.toLowerCase();
}
