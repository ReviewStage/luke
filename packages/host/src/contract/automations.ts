import { eventIterator, type } from "@orpc/contract";
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
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { AUTOMATION_ACT_KIND } from "./kinds.js";

/**
 * automations.ts -- the Automations pages' asks of the host about the account's automations: each plain ask declared, and the procedures of the hold and its Try again beside them.
 *
 * Only a panel draws the Automations pages, so every ask is the panel's
 * alone. A refusal or a defect of the host's is drawn as the automation
 * calls' unanswered failure, as every one was before it was declared. A
 * hold's stream carries nothing: what it holds reaches the panel on app
 * state, and the stream is the window's hold on it. The hold and its Try
 * again stay procedures of their own (`act-port/automation-procedures.ts`):
 * a live read, not a plain act.
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

export const automationActsContract = {
  ...contractOf(AUTOMATION_ACTS),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: actProcedure(
    "Could not follow the automations on this system.",
  )
    .input(exactInput(automationFollowSchema))
    .output(eventIterator(type<never>())),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RETRY]: actProcedure(
    "Could not read the automations again on this system.",
  )
    .input(exactInput(automationFollowSchema))
    .output(EffectSchema.Void),
};
