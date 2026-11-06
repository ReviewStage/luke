import { eventIterator, type } from "@orpc/contract";
import {
  agentInboxAnsweredViewSchema,
  agentInboxAnswerParamsSchema,
  agentInboxAttachmentParamsSchema,
  agentInboxAttachmentViewSchema,
  agentInboxCloseParamsSchema,
  agentInboxItemHomeParamsSchema,
  agentInboxItemHomeViewSchema,
  agentInboxMessagedViewSchema,
  agentInboxMessageParamsSchema,
  agentInboxReadAllParamsSchema,
  agentInboxReadAllViewSchema,
  agentInboxReadStateParamsSchema,
  agentInboxReadStateViewSchema,
  agentInboxRemindParamsSchema,
  agentInboxScopeSchema,
  agentInboxStartParamsSchema,
  agentPictureParamsSchema,
} from "@repo/features/agent-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AGENT_INBOX_ACT_KIND } from "./kinds.js";

export const agentInboxActsContract = {
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW]: actProcedure(
    "Could not follow the inbox on this system.",
  )
    .input(exactInput(agentInboxScopeSchema))
    .output(eventIterator(type<never>())),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_RETRY]: actProcedure(
    "Could not read the inbox again on this system.",
  )
    .input(exactInput(agentInboxScopeSchema))
    .output(EffectSchema.Void),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]: actProcedure(
    "Could not read the inbox again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ANSWER]: actProcedure(
    "Could not acknowledge the inbox item on this system.",
  )
    .input(exactInput(agentInboxAnswerParamsSchema))
    .output(EffectSchema.toType(agentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_CLOSE]: actProcedure(
    "Could not close the inbox item on this system.",
  )
    .input(exactInput(agentInboxCloseParamsSchema))
    .output(EffectSchema.toType(agentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_MESSAGE]: actProcedure(
    "Could not send the message on this system.",
  )
    .input(exactInput(agentInboxMessageParamsSchema))
    .output(EffectSchema.toType(agentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_START]: actProcedure(
    "Could not start the thread on this system.",
  )
    .input(exactInput(agentInboxStartParamsSchema))
    .output(EffectSchema.toType(agentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_STATE]: actProcedure(
    "Could not mark the inbox item on this system.",
  )
    .input(exactInput(agentInboxReadStateParamsSchema))
    .output(EffectSchema.toType(agentInboxReadStateViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_REMIND]: actProcedure(
    "Could not set the inbox item's reminder on this system.",
  )
    .input(exactInput(agentInboxRemindParamsSchema))
    .output(EffectSchema.toType(agentInboxReadStateViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEM_HOME]: actProcedure(
    "Could not find the inbox item on this system.",
  )
    .input(exactInput(agentInboxItemHomeParamsSchema))
    .output(EffectSchema.toType(agentInboxItemHomeViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_ALL]: actProcedure(
    "Could not mark the inbox read on this system.",
  )
    .input(exactInput(agentInboxReadAllParamsSchema))
    .output(EffectSchema.toType(agentInboxReadAllViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ATTACHMENT]: actProcedure(
    "Could not read the inbox item's image on this system.",
  )
    .input(exactInput(agentInboxAttachmentParamsSchema))
    .output(EffectSchema.toType(agentInboxAttachmentViewSchema)),
  [AGENT_INBOX_ACT_KIND.AGENTS_PICTURE]: actProcedure(
    "Could not read the agent's picture on this system.",
  )
    .input(exactInput(agentPictureParamsSchema))
    .output(EffectSchema.toType(agentInboxAttachmentViewSchema)),
};
