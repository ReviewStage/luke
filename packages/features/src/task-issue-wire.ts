import { Schema as EffectSchema } from "effect";
import {
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
  ISSUE_STATE,
} from "./github-repositories-wire.js";
import { linearIssueIdSchema } from "./linear-wire.js";
import { wireUuidSchema } from "./service-wire.js";

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
 *
 * A task's links are read, linked, related, and unlinked at any time after
 * its start too, on its page (`/api/plans/{id}/issues`): a read answers each
 * link as its row keeps it with where the issue stands now, read live from
 * its provider and never kept (`taskIssueLinksAnswerSchema`); a link names
 * its issue as a start does and answers the link made, or why none was made
 * where the task links that issue already or as many as it may
 * (`taskIssueLinkAnswerSchema`); a relation names the keyword alone.
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

export const taskIssueRelationSchema = EffectSchema.Literals(Object.values(TASK_ISSUE_RELATION));

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

/**
 * Where a linked issue stands now, as its provider answered on the read:
 * GitHub's mark, open, closed, or closed as not planned, or the name of the
 * Linear workflow state it is in, `In Progress`. Never kept.
 */
export const taskIssueStandingSchema = EffectSchema.Union([
  EffectSchema.Struct({
    provider: EffectSchema.Literal(TASK_ISSUE_PROVIDER.GITHUB),
    state: EffectSchema.Literals(Object.values(ISSUE_STATE)),
  }),
  EffectSchema.Struct({
    provider: EffectSchema.Literal(TASK_ISSUE_PROVIDER.LINEAR),
    state: EffectSchema.String,
  }),
]);

export type TaskIssueStanding = typeof taskIssueStandingSchema.Type;

/**
 * One issue a task links, as its page draws it: the link's own id, which an
 * unlink and a relation name it by, the provider and its own id for the
 * issue, which a picker marks it linked by, its key, page, and title as the
 * provider last answered them, its repository and number where GitHub holds
 * it, the keyword its pull requests write of it, and where it stands now,
 * absent where the provider did not answer.
 */
export const taskIssueLinkViewSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  provider: EffectSchema.Literals(Object.values(TASK_ISSUE_PROVIDER)),
  externalId: EffectSchema.String,
  key: EffectSchema.String,
  url: EffectSchema.String,
  title: EffectSchema.String,
  repository: EffectSchema.optionalKey(EffectSchema.String),
  number: EffectSchema.optionalKey(EffectSchema.Number),
  relation: taskIssueRelationSchema,
  standing: EffectSchema.optionalKey(taskIssueStandingSchema),
});

export type TaskIssueLinkView = typeof taskIssueLinkViewSchema.Type;

/**
 * One issue a task links as its row of the task list names it, the Board's
 * card drawing it as a tag: the link's own id, which a change of it on the
 * task page finds the tag by, the provider, its key and page as the
 * provider last answered them, and the keyword its pull requests write of
 * it. Never its title, description, or where it stands, which the task's
 * page alone reads.
 */
export const taskIssueTagSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  provider: EffectSchema.Literals(Object.values(TASK_ISSUE_PROVIDER)),
  key: EffectSchema.String,
  url: EffectSchema.String,
  relation: taskIssueRelationSchema,
});

export type TaskIssueTag = typeof taskIssueTagSchema.Type;

/** A link as the task list's tag names it. */
export function issueTagOf(link: TaskIssueLinkView): TaskIssueTag {
  return {
    id: link.id,
    provider: link.provider,
    key: link.key,
    url: link.url,
    relation: link.relation,
  };
}

/** A task's links, oldest linked first, each with where its issue stands now. */
export const taskIssueLinksAnswerSchema = EffectSchema.Struct({
  issues: EffectSchema.Array(taskIssueLinkViewSchema),
});

/** Why a link was not made, nothing written: the task links the issue already, or as many issues as a task may. */
export const TASK_ISSUE_LINK_REFUSAL = {
  LINKED: "linked",
  FULL: "full",
} as const;

export type TaskIssueLinkRefusal =
  (typeof TASK_ISSUE_LINK_REFUSAL)[keyof typeof TASK_ISSUE_LINK_REFUSAL];

/** A link made, as the page draws it, or why none was. */
export const taskIssueLinkAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ issue: taskIssueLinkViewSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(TASK_ISSUE_LINK_REFUSAL)),
  }),
]);

export type TaskIssueLinkAnswer = typeof taskIssueLinkAnswerSchema.Type;

/** A link's keyword changed (PATCH). */
export const taskIssueRelateRequestSchema = EffectSchema.Struct({
  relation: taskIssueRelationSchema,
});

/** A link changed, as the page draws it. */
export const taskIssueLinkChangedAnswerSchema = EffectSchema.Struct({
  issue: taskIssueLinkViewSchema,
});

/** A link let go (DELETE): nothing beyond that it was. */
export const taskIssueUnlinkAnswerSchema = EffectSchema.Struct({
  unlinked: EffectSchema.Literal(true),
});
