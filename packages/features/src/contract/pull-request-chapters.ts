/**
 * pull-request-chapters.ts -- a pull request's chapters as its Pull request tab reads and generates them, as two procedures through an agent and two by the repository and number.
 *
 * Each names the agent by its id in the path and a pull request's number in
 * the `number` query: the read always, the number the tab's own read of the
 * pull request found; the Generate where the tab shows a pull request of the
 * agent's repository other than the agent's own. The service reads it as
 * every other read of the tab does, so it travels as the query's own text
 * (`pull-request-chapters-wire.ts`). The read is a GET, compact. The
 * Generate is a POST with no body: it takes its input detailed, so the
 * number stays in the query rather than moving into a body, and a body sent
 * all the same may hold no key. The outputs are the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 *
 * The other two name the pull request as a link names it, in the query: the
 * workspace, the repository, and the number (`github.ts`'s
 * `numberedQuerySchema`), as the rest of a pull request read by its
 * repository is named (`pull-requests.ts`), for one no agent opened. The
 * read and the Generate split as the agent's do, and answer alike.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  pullRequestChaptersAnswerSchema,
  pullRequestChaptersReadRequestSchema,
  pullRequestChaptersRequestSchema,
} from "../pull-request-chapters-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";
import { numberedQuerySchema } from "./github.js";

/** A Generate reads no body; it may send an empty one, and nothing larger. */
const GENERATE_BODY_BYTES = 1_024;

/** The public paths: through an agent, naming it under `{id}`, and by the repository and number, naming them in the query. */
const PULL_REQUEST_CHAPTERS_PATH = {
  AGENT: "/api/agents/{id}/chapters",
  REPOSITORY: "/api/pull-requests/chapters",
} as const;

/**
 * The Generate's input, detailed: the agent in the path, the number in the
 * query beside whatever else the rewrite wrote there, and no body, or an
 * empty one.
 */
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

/** The Generate by the repository's input, detailed: the pull request in the query beside whatever else a caller wrote there, and no body, or an empty one. */
const repositoryGenerateInput = exactInput(
  EffectSchema.Struct({
    // Note that the path names nothing, so its parameters are passed over as the headers are.
    params: EffectSchema.optionalKey(EffectSchema.Unknown),
    query: EffectSchema.StructWithRest(numberedQuerySchema, [
      EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
    ]),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: EffectSchema.optional(EffectSchema.Record(EffectSchema.String, EffectSchema.Never)),
  }),
);

export const pullRequestChaptersContract = {
  /** The workspace's newest chapters for the pull request the number names. */
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PULL_REQUEST_CHAPTERS_PATH.AGENT }))
    .input(pullRequestChaptersReadRequestSchema)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  /** The pull request's chapters generated for its head now, or the generation already under way, answered as the read answers. */
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
  /** The workspace's newest chapters for the pull request its repository and number name. */
  repositoryRead: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PULL_REQUEST_CHAPTERS_PATH.REPOSITORY }))
    .input(numberedQuerySchema)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  /** That pull request's chapters generated for its head now, or the generation already under way, answered as the read answers. */
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
