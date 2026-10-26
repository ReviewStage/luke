/**
 * agent-inbox.ts -- the Inbox's asks of the host, as procedures.
 *
 * What a task's coding agents need of the developer: a task's or an agent's
 * inbox followed, one item answered, closed, messaged, or marked, a thread
 * started, every item marked read, and an item's image and an agent's picture.
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
  type CodingAgentInboxChanged,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentInboxCloseParamsSchema,
  codingAgentInboxMessagedViewSchema,
  codingAgentInboxMessageParamsSchema,
  codingAgentInboxReadAllViewSchema,
  codingAgentInboxReadStateParamsSchema,
  codingAgentInboxReadStateViewSchema,
  codingAgentInboxScopeSchema,
  codingAgentInboxStartParamsSchema,
  codingAgentPictureParamsSchema,
} from "@luke/features/coding-agent-view";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import { eventIterator, type } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AGENT_INBOX_ACT_KIND } from "./kinds.js";

export const agentInboxActsContract = {
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: actProcedure(
    "Could not follow the inbox on this system.",
  )
    .input(exactInput(codingAgentInboxScopeSchema))
    .output(eventIterator(type<CodingAgentInboxChanged["inbox"]>())),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: actProcedure(
    "Could not acknowledge the inbox item on this system.",
  )
    .input(exactInput(codingAgentInboxAnswerParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: actProcedure(
    "Could not close the inbox item on this system.",
  )
    .input(exactInput(codingAgentInboxCloseParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAnsweredViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: actProcedure(
    "Could not send the message on this system.",
  )
    .input(exactInput(codingAgentInboxMessageParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_START]: actProcedure(
    "Could not start the thread on this system.",
  )
    .input(exactInput(codingAgentInboxStartParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxMessagedViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: actProcedure(
    "Could not mark the inbox item on this system.",
  )
    .input(exactInput(codingAgentInboxReadStateParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxReadStateViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: actProcedure(
    "Could not mark the inbox read on this system.",
  )
    .input(exactInput(inboxReadAllRequestSchema))
    .output(EffectSchema.toType(codingAgentInboxReadAllViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: actProcedure(
    "Could not read the inbox item's image on this system.",
  )
    .input(exactInput(codingAgentInboxAttachmentParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAttachmentViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE]: actProcedure(
    "Could not read the agent's picture on this system.",
  )
    .input(exactInput(codingAgentPictureParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAttachmentViewSchema)),
};
