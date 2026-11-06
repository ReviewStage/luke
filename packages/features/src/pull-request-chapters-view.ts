import { Schema as EffectSchema } from "effect";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { pullRequestChaptersAnswerSchema } from "./pull-request-chapters-wire.js";

export const PULL_REQUEST_CHAPTERS_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  GITHUB_UNANSWERED: "github-unanswered",
  UNAVAILABLE: "unavailable",
} as const;

export const pullRequestChaptersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
});

export type PullRequestChaptersParams = typeof pullRequestChaptersParamsSchema.Type;

export const pullRequestChaptersReadParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: githubPullRequestNumberSchema,
});

export type PullRequestChaptersReadParams = typeof pullRequestChaptersReadParamsSchema.Type;

export const pullRequestChaptersAnswerViewSchema = EffectSchema.Union([
  pullRequestChaptersAnswerSchema,
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(PULL_REQUEST_CHAPTERS_CALL_FAILURE)),
  }),
]);

export type PullRequestChaptersAnswerView = typeof pullRequestChaptersAnswerViewSchema.Type;
