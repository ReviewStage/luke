import { Schema as EffectSchema } from "effect";
import { OVERVIEW_BOUNDS, REACTION } from "./coding-agent-wire.js";

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
} as const;

/** The changes the Pull request tab makes, each one press. */
export const PULL_REQUEST_ACTION = {
  /** A draft marked ready for review. */
  READY_FOR_REVIEW: "ready-for-review",
  /** An open pull request turned back into a draft. */
  CONVERT_TO_DRAFT: "convert-to-draft",
  /** A reaction given to the description, a comment, a review, or a thread comment. */
  ADD_REACTION: "add-reaction",
  /** The member's own reaction taken back. */
  REMOVE_REACTION: "remove-reaction",
} as const;

/**
 * One change, as the tab asks the service to make it (POST). A reaction
 * names what it is on by the GraphQL id the conversation's read gave it
 * (`subject`), which the service holds to this pull request before it
 * reacts.
 */
export const pullRequestActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.READY_FOR_REVIEW) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CONVERT_TO_DRAFT) }),
  EffectSchema.Struct({
    action: EffectSchema.Literals([
      PULL_REQUEST_ACTION.ADD_REACTION,
      PULL_REQUEST_ACTION.REMOVE_REACTION,
    ]),
    subject: EffectSchema.String.check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_NAME_CHARS),
    ),
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
