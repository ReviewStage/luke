import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  pullRequestChaptersAnswerViewSchema,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * chapters.ts -- a coding agent's Pull request tab's asks of the host about a pull request's chapters: a Generate declared, and their live follow beside it.
 *
 * Only a panel draws the Pull request tab, so every ask is the panel's
 * alone. A refusal or a defect of the host's is drawn as the coding-agent
 * calls' unanswered failure, as a Generate was before it was declared. The
 * hold and its Try again are a live follow, declared once
 * (`live-follow.ts`): a live read, not a plain act.
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

/** A pull request's chapters, followed for the Pull request tab that holds them. */
export const CHAPTERS_FOLLOWS = liveFollows({
  CHAPTERS_FOLLOW: liveFollow({
    slice: LIVE_READ.PULL_REQUEST_CHAPTERS,
    hold: HOLD.WINDOW,
    key: pullRequestChaptersReadParamsSchema,
    refusal: "Could not follow the pull request's chapters on this system.",
    panelOnly: true,
    retry: {
      name: "CHAPTERS_RETRY",
      refusal: "Could not read the pull request's chapters again on this system.",
    },
  }),
});

export const chaptersActsContract = {
  ...contractOf(CHAPTERS_ACTS),
  ...followsContractOf(CHAPTERS_FOLLOWS),
};
