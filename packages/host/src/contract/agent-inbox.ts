/**
 * agent-inbox.ts -- the Inbox's and the workspace chat's asks of the host, as procedures.
 *
 * What a task's coding agents need of the developer, and what they say in
 * the workspace: an Inbox read, one item answered, closed, messaged, or
 * marked, every item marked read, an item's image and an agent's picture,
 * and the workspace's chat read, written to, and a message's picture.
 *
 * Each output is its view schema's type side (`EffectSchema.toType`) rather
 * than the view flipped, as the agents' acts' are. The only difference
 * between a view's two sides here is the phantom brand on a block, a
 * response, or a chat type this build does not know (`UnknownInboxType` in
 * `inbox-wire.ts`, `UnknownChatType` in `chat-wire.ts`), so encoding is the
 * identity; flipped, the window would read the encoded side, whose
 * unbranded `{ type: string }` swallows the union every reader narrows. The
 * output check still runs each view's checks and leaves out a key the view
 * does not name.
 */

import {
  codingAgentAgentInboxParamsSchema,
  codingAgentChatAnswerViewSchema,
  codingAgentChatAttachmentParamsSchema,
  codingAgentChatParamsSchema,
  codingAgentChatPostParamsSchema,
  codingAgentChatWriteAnswerViewSchema,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAnswerViewSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentInboxCloseParamsSchema,
  codingAgentInboxMessagedViewSchema,
  codingAgentInboxMessageParamsSchema,
  codingAgentInboxParamsSchema,
  codingAgentInboxReadAllViewSchema,
  codingAgentInboxReadStateParamsSchema,
  codingAgentInboxReadStateViewSchema,
  codingAgentPictureParamsSchema,
} from "@luke/features/coding-agent-view";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AGENT_INBOX_ACT_KIND } from "./kinds.js";

export const agentInboxActsContract = {
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX]: actProcedure(
    "Could not read the task's inbox on this system.",
  )
    .input(exactInput(codingAgentInboxParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAnswerViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_AGENT_INBOX]: actProcedure(
    "Could not read the agent's inbox on this system.",
  )
    .input(exactInput(codingAgentAgentInboxParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAnswerViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: actProcedure(
    "Could not answer the inbox item on this system.",
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
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT]: actProcedure(
    "Could not read the workspace's chat on this system.",
  )
    .input(exactInput(codingAgentChatParamsSchema))
    .output(EffectSchema.toType(codingAgentChatAnswerViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_POST]: actProcedure(
    "Could not write to the workspace's chat on this system.",
  )
    .input(exactInput(codingAgentChatPostParamsSchema))
    .output(EffectSchema.toType(codingAgentChatWriteAnswerViewSchema)),
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT]: actProcedure(
    "Could not read the chat message's picture on this system.",
  )
    .input(exactInput(codingAgentChatAttachmentParamsSchema))
    .output(EffectSchema.toType(codingAgentInboxAttachmentViewSchema)),
};
