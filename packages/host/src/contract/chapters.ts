import { eventIterator, type } from "@orpc/contract";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  pullRequestChaptersAnswerViewSchema,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { CHAPTERS_ACT_KIND } from "./kinds.js";

/**
 * chapters.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters: a Generate declared, and the procedures of the hold and its Try again beside it.
 *
 * Only a panel draws the Pull request tab, so every ask is the panel's
 * alone. A refusal or a defect of the host's is drawn as the coding-agent
 * calls' unanswered failure, as a Generate was before it was declared. The
 * hold and its Try again stay procedures of their own
 * (`act-port/chapters-procedures.ts`): a live read, not a plain act.
 */

/** The chapters' plain asks, answered by the agents' composer. */
export const CHAPTERS_ACTS = declaredActs({
  CHAPTERS_GENERATE: hostAct({
    input: pullRequestChaptersParamsSchema,
    output: pullRequestChaptersAnswerViewSchema,
    refusal: "Could not generate the pull request's chapters on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: { failure: AGENT_CALL_FAILURE.UNANSWERED },
  }),
});

export const chaptersActsContract = {
  ...contractOf(CHAPTERS_ACTS),
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
};
