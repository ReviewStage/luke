/**
 * agent-inbox-procedures.ts -- the Inbox's and the workspace chat's asks of the host.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws the Inbox and the chat, so every one refuses the
 * takeover and the hidden voice window, in its own sentence. What the
 * service answers comes back as the panel's own answer. The task's inbox is
 * answered to the panel alone: the notices (`@luke/host/agent-notices`)
 * watch what waits across the account on a read of their own. Nothing else
 * is held here.
 */

import type {
  CodingAgentAgentInboxParams,
  CodingAgentChatAnswerView,
  CodingAgentChatAttachmentParams,
  CodingAgentChatParams,
  CodingAgentChatPostParams,
  CodingAgentChatWriteAnswerView,
  CodingAgentInboxAnsweredView,
  CodingAgentInboxAnswerParams,
  CodingAgentInboxAnswerView,
  CodingAgentInboxAttachmentParams,
  CodingAgentInboxAttachmentView,
  CodingAgentInboxCloseParams,
  CodingAgentInboxMessagedView,
  CodingAgentInboxMessageParams,
  CodingAgentInboxParams,
  CodingAgentInboxReadAllView,
  CodingAgentInboxReadStateParams,
  CodingAgentInboxReadStateView,
  CodingAgentPictureParams,
} from "@luke/features/coding-agent-view";
import type { InboxReadAllRequest } from "@luke/features/inbox-wire";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/** What the Inbox and chat procedures reach: the host's asks of the service. */
export interface AgentInboxProceduresDependencies {
  host: {
    codingAgentInbox(params: CodingAgentInboxParams): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentAgentInbox(
      params: CodingAgentAgentInboxParams,
    ): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentInboxAnswer(
      params: CodingAgentInboxAnswerParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxClose(
      params: CodingAgentInboxCloseParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxMessage(
      params: CodingAgentInboxMessageParams,
    ): Effect.Effect<CodingAgentInboxMessagedView>;
    codingAgentInboxReadState(
      params: CodingAgentInboxReadStateParams,
    ): Effect.Effect<CodingAgentInboxReadStateView>;
    codingAgentInboxReadAll(
      params: InboxReadAllRequest,
    ): Effect.Effect<CodingAgentInboxReadAllView>;
    codingAgentInboxAttachment(
      params: CodingAgentInboxAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentPicture(
      params: CodingAgentPictureParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentChat(params: CodingAgentChatParams): Effect.Effect<CodingAgentChatAnswerView>;
    codingAgentChatPost(
      params: CodingAgentChatPostParams,
    ): Effect.Effect<CodingAgentChatWriteAnswerView>;
    codingAgentChatAttachment(
      params: CodingAgentChatAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
  };
}

/** The refusal a window that draws no Inbox hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function agentInboxProcedures(dependencies: AgentInboxProceduresDependencies) {
  const { host } = dependencies;
  return {
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInbox(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_AGENT_INBOX]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_AGENT_INBOX
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentAgentInbox(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxAnswer(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxClose(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxMessage(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxReadState(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxReadAll(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxAttachment(input);
    }),
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentPicture(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentChat(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_POST]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_POST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentChatPost(input);
    }),
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentChatAttachment(input);
    }),
  };
}
