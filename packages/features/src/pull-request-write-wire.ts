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
  /** GitHub's own bound on a pull request's title. */
  MAX_TITLE_CHARS: 256,
  /** The longest body a review may carry, GitHub's own bound on a comment's. */
  MAX_BODY_CHARS: 65_536,
  /** The most characters of a reviewer's login, a team's slug, or a label's name a change names. */
  MAX_NAME_CHARS: 100,
  /** The longest GitHub id for a review thread the request names; GitHub's run near thirty. */
  MAX_NODE_ID_CHARS: 256,
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

/** The reactions GitHub offers on a comment, in the order it draws them; a reaction is read with the conversation (`coding-agent-wire.ts`) and changed here. */
export const REACTION = {
  THUMBS_UP: "thumbs_up",
  THUMBS_DOWN: "thumbs_down",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
} as const;

export type Reaction = (typeof REACTION)[keyof typeof REACTION];

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
  /** Closed without merging. */
  CLOSE: "close",
  /** A closed pull request opened again. */
  REOPEN: "reopen",
  /** Its title changed to the one named. */
  EDIT_TITLE: "edit-title",
  /** A review submitted: the member's own pending review where they hold one, else a new one. */
  SUBMIT_REVIEW: "submit-review",
  /** A user or a team asked for a review. */
  REQUEST_REVIEW: "request-review",
  /** A review asked of a user or a team asked no longer. */
  REMOVE_REVIEW_REQUEST: "remove-review-request",
  /** One of the repository's labels put on the pull request. */
  ADD_LABEL: "add-label",
  /** A label taken off the pull request. */
  REMOVE_LABEL: "remove-label",
  /** A reply on a review thread of the pull request. */
  REPLY_TO_THREAD: "reply-to-thread",
  /** A review thread of the pull request marked resolved. */
  RESOLVE_THREAD: "resolve-thread",
  /** A resolved review thread of the pull request opened again. */
  UNRESOLVE_THREAD: "unresolve-thread",
  /** A comment on the pull request itself, at the foot of its conversation. */
  COMMENT: "comment",
  /** A reaction given to the description, a comment, a review, or a review comment. */
  ADD_REACTION: "add-reaction",
  /** The member's own reaction taken back. */
  REMOVE_REACTION: "remove-reaction",
} as const;

export type PullRequestAction = (typeof PULL_REQUEST_ACTION)[keyof typeof PULL_REQUEST_ACTION];

/** What a submitted review says of the pull request, as GitHub's own review box offers it. */
export const REVIEW_EVENT = {
  /** Feedback that neither approves nor asks for changes. */
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;

export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

/** A review's words, Markdown, which may be empty where GitHub allows it; GitHub's bound. */
const reviewBodySchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS),
);

/** Who a review is asked of: a user by their login, or a team of the repository's organization by its slug. */
export const REVIEWER_KIND = {
  USER: "user",
  TEAM: "team",
} as const;

/** A name a change names, as GitHub spells it. */
const writeName = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NAME_CHARS),
);

/** A reviewer a change names: a user's login or a team's slug. */
const reviewerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(REVIEWER_KIND)),
  name: writeName,
});

export type PullRequestReviewerRef = typeof reviewerSchema.Type;

/** GitHub's own id for a review thread of the pull request, as the conversation's read carries it. */
const threadIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

/**
 * GitHub's own id for what wears a reaction, as the conversation's read
 * carries it (`subject`); the service holds it to this pull request before
 * it reacts.
 */
const subjectIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

/** A reply's or a comment's words, Markdown, never blank; GitHub's bound. */
const replyBodySchema = reviewBodySchema.check(EffectSchema.isPattern(/\S/u));

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
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CLOSE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.REOPEN) }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.EDIT_TITLE),
    title: EffectSchema.Trim.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_TITLE_CHARS),
    ),
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.SUBMIT_REVIEW),
    event: EffectSchema.Literals(Object.values(REVIEW_EVENT)),
    body: reviewBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REQUEST_REVIEW),
    reviewer: reviewerSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST),
    reviewer: reviewerSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.ADD_LABEL),
    label: writeName,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REMOVE_LABEL),
    label: writeName,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REPLY_TO_THREAD),
    threadId: threadIdSchema,
    body: replyBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.RESOLVE_THREAD),
    threadId: threadIdSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.UNRESOLVE_THREAD),
    threadId: threadIdSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.COMMENT),
    body: replyBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literals([
      PULL_REQUEST_ACTION.ADD_REACTION,
      PULL_REQUEST_ACTION.REMOVE_REACTION,
    ]),
    subject: subjectIdSchema,
    content: EffectSchema.Literals(Object.values(REACTION)),
  }),
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
