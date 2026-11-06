import { eventIterator, type } from "@orpc/contract";
import {
  pullRequestChaptersAnswerViewSchema,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CHAPTERS_ACT_KIND } from "./kinds.js";

export const chaptersActsContract = {
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
};
