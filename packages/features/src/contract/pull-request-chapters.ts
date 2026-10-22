/**
 * pull-request-chapters.ts -- a pull request's chapters as its Pull request tab reads and generates them, as two procedures.
 *
 * Each names the agent by its id in the path and, where the tab shows a
 * pull request of the agent's repository other than the agent's own, that
 * pull request's number in the `number` query, which the service reads as
 * every other read of the tab does, so it travels as the query's own text
 * (`pull-request-chapters-wire.ts`). The read is a GET, compact. The
 * Generate is a POST with no body: it takes its input detailed, so the
 * number stays in the query rather than moving into a body, and a body sent
 * all the same may hold no key. The outputs are the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  pullRequestChaptersAnswerSchema,
  pullRequestChaptersRequestSchema,
} from "../pull-request-chapters-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A Generate reads no body; it may send an empty one, and nothing larger. */
const GENERATE_BODY_BYTES = 1_024;

/** The one public path, naming the agent under `{id}`. */
const PULL_REQUEST_CHAPTERS_PATH = "/api/agents/{id}/chapters";

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

export const pullRequestChaptersContract = {
  /** The workspace's newest chapters for the pull request, with its head as GitHub holds it now. */
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PULL_REQUEST_CHAPTERS_PATH }))
    .input(pullRequestChaptersRequestSchema)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
  /** The pull request's chapters generated for its head now, or the generation already under way, answered as the read answers. */
  generate: hostedProcedure
    .meta(bodyCap(GENERATE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: PULL_REQUEST_CHAPTERS_PATH,
        inputStructure: "detailed",
      }),
    )
    .input(generateInput)
    .output(EffectSchema.flip(pullRequestChaptersAnswerSchema)),
};
