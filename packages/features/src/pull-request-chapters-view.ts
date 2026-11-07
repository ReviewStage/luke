import { Schema as EffectSchema } from "effect";
import { pullRequestChaptersContract } from "./contract/pull-request-chapters.js";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

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
 *
 * A model picked on the Chapters view's Generate writes the member's own
 * chapters model, which a Generate then reads on the service, through the
 * same host on the same terms: the model as kept, or why there is none.
 */

/** How a Generate reads its refusals: the service unable to generate chapters right now as its own failure, which any procedure may answer besides. */
export const PULL_REQUEST_CHAPTERS_RENAMES = {
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_API_ERROR.UNAVAILABLE,
} as const;

/**
 * Why a read or a Generate of a pull request's chapters answered nothing
 * the tab can draw, as a Generate's contract declares its refusals: the
 * call never reached an answer (`unanswered`), the agent is not one the
 * account reaches (`not-found`), the App no longer reaches its repository
 * (`repository-not-reachable`), GitHub did not say (`github-unanswered`),
 * or the service cannot generate chapters right now, holding no key for
 * the model or its store down (`unavailable`).
 */
export const PULL_REQUEST_CHAPTERS_CALL_FAILURE = failureSetOf(
  { generate: pullRequestChaptersContract.generate },
  { as: PULL_REQUEST_CHAPTERS_RENAMES },
);

/** One agent's Pull request tab, as the panel names the pull request whose chapters it reads or generates: the agent's own, or the one of its repository by number. */
export const pullRequestChaptersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
});

export type PullRequestChaptersParams = typeof pullRequestChaptersParamsSchema.Type;

/** A read of a pull request's chapters, which names the number the tab's own read of it found. */
export const pullRequestChaptersReadParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: githubPullRequestNumberSchema,
});

export type PullRequestChaptersReadParams = typeof pullRequestChaptersReadParamsSchema.Type;

/** A pull request's chapters, as the panel hears a read or a Generate: the answer, or why there is none. */
export const pullRequestChaptersAnswerViewSchema = answerView(
  pullRequestChaptersContract.generate,
  {
    as: PULL_REQUEST_CHAPTERS_RENAMES,
  },
);

export type PullRequestChaptersAnswerView = typeof pullRequestChaptersAnswerViewSchema.Type;
