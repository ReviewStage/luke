import {
  AUTOMATION_CALL_FAILURE,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationDeletedViewSchema,
  automationFollowSchema,
  automationIdParamsSchema,
  automationRunParamsSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@repo/features/automation-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * automations.ts -- the Automations pages' asks of the host about the account's automations: each plain ask declared, and the live follow beside them.
 *
 * Only a panel draws the Automations pages, so every ask is the panel's
 * alone. A refusal or a defect of the host's is drawn as the automation
 * calls' unanswered failure, as every one was before it was declared. A
 * workspace's automations and the runs are one live follow, declared once
 * (`live-follow.ts`), told on the slice of what its key names.
 */

/** What the window draws for an automation ask the host could not answer. */
const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** The automations' plain asks, each answered by the automations' composer. */
export const AUTOMATION_ACTS = declaredActs({
  AUTOMATIONS_CREATE: hostAct({
    input: automationCreateParamsSchema,
    output: automationViewSchema,
    refusal: "Could not make the automation on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AUTOMATIONS_CHANGE: hostAct({
    input: automationChangeParamsSchema,
    output: automationViewSchema,
    refusal: "Could not change the automation on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AUTOMATIONS_DELETE: hostAct({
    input: automationIdParamsSchema,
    output: automationDeletedViewSchema,
    refusal: "Could not delete the automation on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  AUTOMATIONS_RUN: hostAct({
    input: automationRunParamsSchema,
    output: automationRunViewSchema,
    refusal: "Could not run the automation on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  AUTOMATIONS_NEW_WEBHOOK_SECRET: hostAct({
    input: automationIdParamsSchema,
    output: automationViewSchema,
    refusal: "Could not make a new webhook secret on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
});

/** A workspace's automations, its runs, or one automation's runs, by what the key names, followed for the Automations pages while they hold them. */
export const AUTOMATION_FOLLOWS = liveFollows({
  AUTOMATIONS_FOLLOW: liveFollow({
    slice: LIVE_READ.AUTOMATIONS,
    alsoTold: [LIVE_READ.AUTOMATION_RUNS, LIVE_READ.AUTOMATION_WORKSPACE_RUNS],
    hold: HOLD.WINDOW,
    key: automationFollowSchema,
    refusal: "Could not follow the automations on this system.",
    panelOnly: true,
    retry: {
      name: "AUTOMATIONS_RETRY",
      refusal: "Could not read the automations again on this system.",
    },
  }),
});

export const automationActsContract = {
  ...contractOf(AUTOMATION_ACTS),
  ...followsContractOf(AUTOMATION_FOLLOWS),
};
