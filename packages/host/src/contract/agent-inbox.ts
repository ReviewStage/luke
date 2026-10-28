/**
 * agent-inbox.ts -- the Inbox's asks of the host, as procedures.
 *
 * What a task's coding agents need of the developer: a task's or an agent's
 * inbox followed, and every item the account reaches; one item answered,
 * closed, messaged, or marked, a thread started, every item marked read, and
 * an item's image and an agent's picture.
 *
 * Each output is its view schema's type side (`EffectSchema.toType`) rather
 * than the view flipped, as the agents' acts' are. The only difference
 * between a view's two sides here is the phantom brand on a block, a
 * response this build does not know (`UnknownInboxType` in
 * `inbox-wire.ts`), so encoding is the
 * identity; flipped, the window would read the encoded side, whose
 * unbranded `{ type: string }` swallows the union every reader narrows. The
 * output check still runs each view's checks and leaves out a key the view
 * does not name.
 */

import {
  type AgentInboxChanged,
  agentInboxAnsweredViewSchema,
  agentInboxAnswerParamsSchema,
  agentInboxAttachmentParamsSchema,
  agentInboxAttachmentViewSchema,
  agentInboxCloseParamsSchema,
  agentInboxMessagedViewSchema,
  agentInboxMessageParamsSchema,
  agentInboxReadAllViewSchema,
  agentInboxReadStateParamsSchema,
  agentInboxReadStateViewSchema,
  agentInboxScopeSchema,
  agentInboxStartParamsSchema,
  agentPictureParamsSchema,
  type CodingAgentAccountItems,
} from "@luke/features/agent-view";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import { eventIterator, type } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AGENT_INBOX_ACT_KIND } from "./kinds.js";

export const agentInboxActsContract = {
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: actProcedure(
    "Could not follow the inbox on this system.",
  )
    .input(exactInput(agentInboxScopeSchema))
    .output(eventIterator(type<AgentInboxChanged["inbox"]>())),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_ACCOUNT_ITEMS_FOLLOW]: actProcedure(
    "Could not follow the inbox on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<CodingAgentAccountItems>())),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: actProcedure(
    "Could not acknowledge the inbox item on this system.",
  )
    .input(exactInput(agentInboxAnswerParamsSchema))
    .output(EffectSchema.toType(agentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: actProcedure(
    "Could not close the inbox item on this system.",
  )
    .input(exactInput(agentInboxCloseParamsSchema))
    .output(EffectSchema.toType(agentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: actProcedure(
    "Could not send the message on this system.",
  )
    .input(exactInput(agentInboxMessageParamsSchema))
    .output(EffectSchema.toType(agentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_START]: actProcedure(
    "Could not start the thread on this system.",
  )
    .input(exactInput(agentInboxStartParamsSchema))
    .output(EffectSchema.toType(agentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: actProcedure(
    "Could not mark the inbox item on this system.",
  )
    .input(exactInput(agentInboxReadStateParamsSchema))
    .output(EffectSchema.toType(agentInboxReadStateViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: actProcedure(
    "Could not mark the inbox read on this system.",
  )
    .input(exactInput(inboxReadAllRequestSchema))
    .output(EffectSchema.toType(agentInboxReadAllViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: actProcedure(
    "Could not read the inbox item's image on this system.",
  )
    .input(exactInput(agentInboxAttachmentParamsSchema))
    .output(EffectSchema.toType(agentInboxAttachmentViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE]: actProcedure(
    "Could not read the agent's picture on this system.",
  )
    .input(exactInput(agentPictureParamsSchema))
    .output(EffectSchema.toType(agentInboxAttachmentViewSchema)),
};
