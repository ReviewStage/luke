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
 * a permission the member's account does not hold. A refusal of Luke's own,
 * an agent out of reach or a service that could not answer, travels as the
 * hosted vocabulary's refusal as every other call's does.
 */

export const PULL_REQUEST_WRITE_BOUNDS = {
  /** The most of GitHub's own words on a refused change the answer carries. */
  MAX_REFUSAL_CHARS: 1_000,
  /** The longest body a review may carry, GitHub's own bound on a comment's. */
  MAX_BODY_CHARS: 65_536,
  /** The most characters of a reviewer's login, a team's slug, or a label's name a change names. */
  MAX_NAME_CHARS: 100,
} as const;

/** The changes the Pull request tab makes, each one press. */
export const PULL_REQUEST_ACTION = {
  /** A draft marked ready for review. */
  READY_FOR_REVIEW: "ready-for-review",
  /** An open pull request turned back into a draft. */
  CONVERT_TO_DRAFT: "convert-to-draft",
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

/** One change, as the tab asks the service to make it (POST). */
export const pullRequestActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.READY_FOR_REVIEW) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CONVERT_TO_DRAFT) }),
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
