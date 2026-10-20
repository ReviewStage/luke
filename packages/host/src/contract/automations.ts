import {
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationDeletedViewSchema,
  automationIdParamsSchema,
  automationListParamsSchema,
  automationListViewSchema,
  automationRunParamsSchema,
  automationRunsViewSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@luke/features/automation-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AUTOMATION_ACT_KIND } from "./kinds.js";

/**
 * automations.ts -- the Automations pages' asks of the host about the account's automations, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port.
 */
export const automationActsContract = {
  [AUTOMATION_ACT_KIND.AUTOMATIONS_LIST]: actProcedure(
    "Could not read the automations on this system.",
  )
    .input(exactInput(automationListParamsSchema))
    .output(EffectSchema.flip(automationListViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE]: actProcedure(
    "Could not make the automation on this system.",
  )
    .input(exactInput(automationCreateParamsSchema))
    .output(EffectSchema.flip(automationViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: actProcedure(
    "Could not change the automation on this system.",
  )
    .input(exactInput(automationChangeParamsSchema))
    .output(EffectSchema.flip(automationViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: actProcedure(
    "Could not delete the automation on this system.",
  )
    .input(exactInput(automationIdParamsSchema))
    .output(EffectSchema.flip(automationDeletedViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: actProcedure(
    "Could not run the automation on this system.",
  )
    .input(exactInput(automationRunParamsSchema))
    .output(EffectSchema.flip(automationRunViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS]: actProcedure(
    "Could not read the automation's runs on this system.",
  )
    .input(exactInput(automationIdParamsSchema))
    .output(EffectSchema.flip(automationRunsViewSchema)),
  [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: actProcedure(
    "Could not make a new webhook secret on this system.",
  )
    .input(exactInput(automationIdParamsSchema))
    .output(EffectSchema.flip(automationViewSchema)),
};
