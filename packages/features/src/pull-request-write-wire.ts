import { Schema as EffectSchema } from "effect";

/**
 * pull-request-write-wire.ts -- a change a workspace member makes to a coding agent's pull request from its Pull request tab, and how GitHub took it.
 *
 * Every change is sent to GitHub by the service as the member who pressed
 * the button, on their own GitHub sign-in, never as the Luke GitHub App, so
 * nobody does on GitHub through Luke what their own account may not. The
 * request names the change (`POST /api/agents/{id}/pull-request/action`); the
 * answer says it was made, that the member must sign in with GitHub again
 * because they hold no sign-in GitHub takes, or that GitHub refused the
 * change itself, in GitHub's own words: a branch protection, a conflict, or
 * a permission the member's account does not hold. A merge, and turning
 * auto-merge on, name the head commit the member saw, so GitHub refuses one
 * made against a head pushed since. A refusal of Luke's own,
 * an agent out of reach or a service that could not answer, travels as the
 * hosted vocabulary's refusal as every other call's does.
 */

export const PULL_REQUEST_WRITE_BOUNDS = {
  /** The most of GitHub's own words on a refused change the answer carries. */
  MAX_REFUSAL_CHARS: 1_000,
  /** A commit's id as GitHub spells one: forty hex digits for SHA-1, sixty-four for SHA-256. */
  MAX_COMMIT_CHARS: 64,
} as const;

/** How a pull request is merged, as GitHub offers each where the repository allows it. */
export const MERGE_METHOD = {
  MERGE: "merge",
  SQUASH: "squash",
  REBASE: "rebase",
} as const;

export type MergeMethod = (typeof MERGE_METHOD)[keyof typeof MERGE_METHOD];

export const mergeMethodSchema = EffectSchema.Literals(Object.values(MERGE_METHOD));

/** The head commit a merge is made against, as GitHub spells it. */
const headShaSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_COMMIT_CHARS),
  EffectSchema.isPattern(/^[0-9a-f]+$/u),
);

/** The changes the Pull request tab makes, each one press. */
export const PULL_REQUEST_ACTION = {
  /** A draft marked ready for review. */
  READY_FOR_REVIEW: "ready-for-review",
  /** An open pull request turned back into a draft. */
  CONVERT_TO_DRAFT: "convert-to-draft",
  /** Merged now, by the method named, against the head named. */
  MERGE: "merge",
  /**
   * Merged by GitHub once what it waits on passes, against the head named: by
   * the method named, or, on a base merged through a merge queue, added to
   * the queue once ready, by the queue's own method.
   */
  ENABLE_AUTO_MERGE: "enable-auto-merge",
  /** Auto-merge turned off again. */
  DISABLE_AUTO_MERGE: "disable-auto-merge",
  /** Taken out of the merge queue. */
  DEQUEUE: "dequeue",
} as const;

export type PullRequestAction = (typeof PULL_REQUEST_ACTION)[keyof typeof PULL_REQUEST_ACTION];

/** One change, as the tab asks the service to make it (POST). */
export const pullRequestActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.READY_FOR_REVIEW) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CONVERT_TO_DRAFT) }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.MERGE),
    method: mergeMethodSchema,
    headSha: headShaSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE),
    method: EffectSchema.optionalKey(mergeMethodSchema),
    headSha: headShaSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.DEQUEUE) }),
]);

export type PullRequestActionRequest = typeof pullRequestActionRequestSchema.Type;

/** How GitHub took a change. */
export const PULL_REQUEST_WRITE_OUTCOME = {
  /** GitHub made it. */
  DONE: "done",
  /** The member holds no GitHub sign-in GitHub takes: none at all, one whose refresh lapsed, or a token GitHub refused; signing in with GitHub again mends it. */
  SIGN_IN_REQUIRED: "sign-in-required",
  /** GitHub refused the change itself, its words beside. */
  REFUSED: "refused",
} as const;

/** How GitHub took a change, as the service answers it. */
export const pullRequestWriteAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.DONE) }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED),
  }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.REFUSED),
    /** What GitHub said, cut to the bound. */
    words: EffectSchema.String.check(
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_REFUSAL_CHARS),
    ),
  }),
]);

export type PullRequestWriteAnswer = typeof pullRequestWriteAnswerSchema.Type;
