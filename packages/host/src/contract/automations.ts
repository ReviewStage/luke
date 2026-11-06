import { eventIterator, type } from "@orpc/contract";
import {
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationDeletedViewSchema,
  automationFollowSchema,
  automationIdParamsSchema,
  automationRunParamsSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@repo/features/automation-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AUTOMATION_ACT_KIND } from "./kinds.js";

export const automationActsContract = {
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
  [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: actProcedure(
    "Could not make a new webhook secret on this system.",
  )
    .input(exactInput(automationIdParamsSchema))
    .output(EffectSchema.flip(automationViewSchema)),
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
