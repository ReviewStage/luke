import { Schema as EffectSchema } from "effect";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { chapterSchema } from "./pull-request-chapters.js";
import { countedNumber } from "./service-wire.js";

export const PULL_REQUEST_CHAPTERS_STATE = {
  NONE: "none",
  GENERATING: "generating",
  FAILED: "failed",
  READY: "ready",
} as const;

export const PULL_REQUEST_CHAPTERS_FAILURE_KIND = {
  TOO_LARGE: "too_large",
  TIMEOUT: "timeout",
  MODEL_REFUSED: "model_refused",
  INVALID_ANSWER: "invalid_answer",
  UNEXPECTED: "unexpected",
} as const;

const commitSchema = EffectSchema.NonEmptyString;

const generationCommits = { headSha: commitSchema, baseSha: commitSchema };

const pullRequestChaptersStateSchema = EffectSchema.Union([
  EffectSchema.Struct({ status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.NONE) }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(PULL_REQUEST_CHAPTERS_STATE.GENERATING),
    ...generationCommits,
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
    model: EffectSchema.NonEmptyString,
    chapters: EffectSchema.Array(chapterSchema),
  }),
]);

export type PullRequestChaptersState = typeof pullRequestChaptersStateSchema.Type;

export const chaptersRunsOnSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(MODEL_PROVIDER)),
  model: EffectSchema.NonEmptyString,
});

export type ChaptersRunsOn = typeof chaptersRunsOnSchema.Type;

export const pullRequestChaptersRequestSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  number: EffectSchema.optionalKey(EffectSchema.String),
});

export const pullRequestChaptersReadRequestSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  number: EffectSchema.String,
});

export const pullRequestChaptersAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      number: githubPullRequestNumberSchema,
      generatable: EffectSchema.Boolean,
      runsOn: EffectSchema.optionalKey(chaptersRunsOnSchema),
      chapters: pullRequestChaptersStateSchema,
    }),
  ),
});

export type PullRequestChaptersAnswer = typeof pullRequestChaptersAnswerSchema.Type;
