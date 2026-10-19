import { Schema as EffectSchema } from "effect";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { pullRequestChaptersAnswerSchema } from "./pull-request-chapters-wire.js";

/**
 * pull-request-chapters-view.ts -- a pull request's chapters as one Mac's window hears them: the answer whole, or why there is none.
 *
 * The host asks the service for them on the panel's behalf, a read or a
 * Generate, and answers the panel one of the shapes here, so the Chapters
 * tab draws chapters or draws why, and nothing else the service said
 * reaches it. The failures are the few the tab acts on: the service never
 * answered, the agent is gone, the App does not reach its repository,
 * GitHub did not say, or the service cannot generate chapters right now,
 * where a deployment holds no key for the model or its store is down.
 */

/** Why a read or a Generate of a pull request's chapters answered nothing the tab can draw. */
export const PULL_REQUEST_CHAPTERS_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The agent is not one the account reaches: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The agent's workspace's GitHub installation no longer reaches its repository. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** GitHub did not answer; the same call a moment later may be taken. */
  GITHUB_UNANSWERED: "github-unanswered",
  /** The service cannot read or generate chapters right now: it holds no key for the model, or its store did not answer. */
  UNAVAILABLE: "unavailable",
} as const;

/** One agent's Pull request tab, as the panel names the pull request whose chapters it reads or generates: the agent's own, or the one of its repository by number. */
export const pullRequestChaptersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
});

export type PullRequestChaptersParams = typeof pullRequestChaptersParamsSchema.Type;

/** A pull request's chapters, as the panel hears a read or a Generate: the answer, or why there is none. */
export const pullRequestChaptersAnswerViewSchema = EffectSchema.Union([
  pullRequestChaptersAnswerSchema,
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(PULL_REQUEST_CHAPTERS_CALL_FAILURE)),
  }),
]);

export type PullRequestChaptersAnswerView = typeof pullRequestChaptersAnswerViewSchema.Type;
