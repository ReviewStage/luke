import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  pullRequestChaptersAnswerSchema,
  pullRequestChaptersReadRequestSchema,
  pullRequestChaptersRequestSchema,
} from "../pull-request-chapters-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";
import { numberedQuerySchema } from "./github.js";

const GENERATE_BODY_BYTES = 1_024;

const PULL_REQUEST_CHAPTERS_PATH = {
  AGENT: "/api/agents/{id}/chapters",
  REPOSITORY: "/api/pull-requests/chapters",
} as const;

const generateInput = exactInput(
  EffectSchema.Struct({
    params: EffectSchema.Struct({ id: pullRequestChaptersRequestSchema.fields.id }),
    query: EffectSchema.optionalKey(
      EffectSchema.StructWithRest(
        EffectSchema.Struct({ number: pullRequestChaptersRequestSchema.fields.number }),
        [EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)],
      ),
    ),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: EffectSchema.optional(EffectSchema.Record(EffectSchema.String, EffectSchema.Never)),
  }),
);

const repositoryGenerateInput = exactInput(
  EffectSchema.Struct({
    params: EffectSchema.optionalKey(EffectSchema.Unknown),
    query: EffectSchema.StructWithRest(numberedQuerySchema, [
      EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
    ]),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: EffectSchema.optional(EffectSchema.Record(EffectSchema.String, EffectSchema.Never)),
  }),
);

export const pullRequestChaptersContract = {
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PULL_REQUEST_CHAPTERS_PATH.AGENT }))
    .input(pullRequestChaptersReadRequestSchema)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  generate: hostedProcedure
    .meta(bodyCap(GENERATE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: PULL_REQUEST_CHAPTERS_PATH.AGENT,
        inputStructure: "detailed",
      }),
    )
    .input(generateInput)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  repositoryRead: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PULL_REQUEST_CHAPTERS_PATH.REPOSITORY }))
    .input(numberedQuerySchema)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  repositoryGenerate: hostedProcedure
    .meta(bodyCap(GENERATE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: PULL_REQUEST_CHAPTERS_PATH.REPOSITORY,
        inputStructure: "detailed",
      }),
    )
    .input(repositoryGenerateInput)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
};
