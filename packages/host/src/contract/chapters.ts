import {
  pullRequestChaptersAnswerViewSchema,
  pullRequestChaptersParamsSchema,
} from "@luke/features/pull-request-chapters-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CHAPTERS_ACT_KIND } from "./kinds.js";

/**
 * chapters.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, the convention the hosted contract
 * keeps (`@luke/features/contract`).
 */
export const chaptersActsContract = {
  [CHAPTERS_ACT_KIND.CHAPTERS_READ]: actProcedure(
    "Could not read the pull request's chapters on this system.",
  )
    .input(exactInput(pullRequestChaptersParamsSchema))
    .output(EffectSchema.flip(pullRequestChaptersAnswerViewSchema)),
  [CHAPTERS_ACT_KIND.CHAPTERS_GENERATE]: actProcedure(
    "Could not generate the pull request's chapters on this system.",
  )
    .input(exactInput(pullRequestChaptersParamsSchema))
    .output(EffectSchema.flip(pullRequestChaptersAnswerViewSchema)),
};
