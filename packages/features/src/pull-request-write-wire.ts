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
  /** The longest GitHub id for a review thread the request names; GitHub's run near thirty. */
  MAX_NODE_ID_CHARS: 256,
} as const;

/** The changes the Pull request tab makes, each one press. */
export const PULL_REQUEST_ACTION = {
  /** A draft marked ready for review. */
  READY_FOR_REVIEW: "ready-for-review",
  /** An open pull request turned back into a draft. */
  CONVERT_TO_DRAFT: "convert-to-draft",
  /** A review submitted: the member's own pending review where they hold one, else a new one. */
  SUBMIT_REVIEW: "submit-review",
  /** A reply on a review thread of the pull request. */
  REPLY_TO_THREAD: "reply-to-thread",
  /** A review thread of the pull request marked resolved. */
  RESOLVE_THREAD: "resolve-thread",
  /** A resolved review thread of the pull request opened again. */
  UNRESOLVE_THREAD: "unresolve-thread",
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

/** GitHub's own id for a review thread of the pull request, as the conversation's read carries it. */
const threadIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

/** A reply's words, Markdown, never blank; GitHub's bound. */
const replyBodySchema = reviewBodySchema.check(EffectSchema.isPattern(/\S/u));

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
