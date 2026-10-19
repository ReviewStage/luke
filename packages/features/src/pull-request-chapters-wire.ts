import { Schema as EffectSchema } from "effect";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { chapterSchema } from "./pull-request-chapters.js";
import { countedNumber } from "./service-wire.js";

/**
 * pull-request-chapters-wire.ts -- a pull request's chapters as the hosted service answers them: read as they stand, or generated on a member's Generate.
 *
 * Both procedures name the pull request as a Pull request tab's other reads
 * do: the coding agent by its id in the path, and, where the tab shows a
 * pull request of the agent's repository other than the agent's own, that
 * pull request's number in the `number` query, as the query spells it
 * (`pullRequestChaptersRequestSchema`). Each answers the same way
 * (`pullRequestChaptersAnswerSchema`): none where the agent published no pull
 * request, or the number names none; else the pull request's head as GitHub
 * holds it now, whether this deployment can generate chapters at all, and
 * the workspace's newest chapters for the pull request, whatever head they
 * were made for, so the panel draws chapters made for an older head as
 * stale beside a Regenerate.
 */

/** Where a pull request's newest chapters stand for its workspace: never asked for, being made, given up on, or made. */
export const PULL_REQUEST_CHAPTERS_STATE = {
  NONE: "none",
  GENERATING: "generating",
  FAILED: "failed",
  READY: "ready",
} as const;

/**
 * Why a generation failed, in the store's words: the diff was too large to
 * send, the model took too long, the model declined, what it answered could
 * not be read as chapters, or something else went wrong on the service,
 * which says nothing more.
 */
export const PULL_REQUEST_CHAPTERS_FAILURE_KIND = {
  TOO_LARGE: "too_large",
  TIMEOUT: "timeout",
  MODEL_REFUSED: "model_refused",
  INVALID_ANSWER: "invalid_answer",
  UNEXPECTED: "unexpected",
} as const;

/** A git commit's name, as GitHub spells it. */
const commitSchema = EffectSchema.NonEmptyString;

/** The commits a generation read the diff between: the base it was read against and the head it split. */
const generationCommits = { headSha: commitSchema, baseSha: commitSchema };

/** The pull request's newest chapters, by where their generation stands. */
export const pullRequestChaptersStateSchema = EffectSchema.Union([
  EffectSchema.Struct({ status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.NONE) }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.GENERATING),
    ...generationCommits,
    /** When the generation was claimed, as epoch milliseconds. */
    startedAt: countedNumber,
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.FAILED),
    ...generationCommits,
    failureKind: EffectSchema.Literals(Object.values(PULL_REQUEST_CHAPTERS_FAILURE_KIND)),
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.READY),
    ...generationCommits,
    /** The model that told them, by its provider's id. */
    model: EffectSchema.NonEmptyString,
    /** In reading order, "Other changes" last where it holds anything. */
    chapters: EffectSchema.Array(chapterSchema),
  }),
]);

export type PullRequestChaptersState = typeof pullRequestChaptersStateSchema.Type;

/** A read or a Generate of a pull request's chapters: the agent in the path, and the number in the query where the tab names one. */
export const pullRequestChaptersRequestSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  number: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * A pull request's chapters as the service answers a read or a Generate:
 * none where there is no pull request to tell; else its head as GitHub
 * holds it now, which chapters made for another head are stale against,
 * whether this deployment can generate chapters, and the newest chapters.
 */
export const pullRequestChaptersAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      number: githubPullRequestNumberSchema,
      headSha: commitSchema,
      generatable: EffectSchema.Boolean,
      chapters: pullRequestChaptersStateSchema,
    }),
  ),
});

export type PullRequestChaptersAnswer = typeof pullRequestChaptersAnswerSchema.Type;
