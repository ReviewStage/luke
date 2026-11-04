import { eventIterator, type } from "@orpc/contract";
import {
  chaptersModelAnswerViewSchema,
  chaptersModelWriteParamsSchema,
  pullRequestChaptersAnswerViewSchema,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CHAPTERS_ACT_KIND } from "./kinds.js";

/**
 * chapters.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters, as procedures.
 *
 * Each output but the hold's is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, the convention the hosted contract
 * keeps (`@repo/features/contract`).
 */
export const chaptersActsContract = {
  // Note that the hold's stream carries nothing: the held chapters reach the panel on app state, and the stream is the window's hold on them.
  [CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW]: actProcedure(
    "Could not follow the pull request's chapters on this system.",
  )
    .input(exactInput(pullRequestChaptersReadParamsSchema))
    .output(eventIterator(type<never>())),
  [CHAPTERS_ACT_KIND.CHAPTERS_RETRY]: actProcedure(
    "Could not read the pull request's chapters again on this system.",
  )
    .input(exactInput(pullRequestChaptersReadParamsSchema))
    .output(EffectSchema.Void),
  [CHAPTERS_ACT_KIND.CHAPTERS_GENERATE]: actProcedure(
    "Could not generate the pull request's chapters on this system.",
  )
    .input(exactInput(pullRequestChaptersParamsSchema))
    .output(EffectSchema.flip(pullRequestChaptersAnswerViewSchema)),
  [CHAPTERS_ACT_KIND.CHAPTERS_MODEL_READ]: actProcedure(
    "Could not read the chapters model on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(chaptersModelAnswerViewSchema)),
  [CHAPTERS_ACT_KIND.CHAPTERS_MODEL_WRITE]: actProcedure(
    "Could not change the chapters model on this system.",
  )
    .input(exactInput(chaptersModelWriteParamsSchema))
    .output(EffectSchema.flip(chaptersModelAnswerViewSchema)),
};
