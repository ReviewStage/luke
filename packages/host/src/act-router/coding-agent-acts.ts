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
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import { ActRefused, type ActRows, type ActSender } from "./router.js";

/**
 * coding-agent-acts.ts -- the Tasks tab's coding-agent acts: the panel's asks of the host about a task's agents.
 *
 * The one check these rows make is who asked, as for every task act:
 * only a panel draws a task's agents, so every row refuses the takeover and
 * the hidden voice window. What the service answers comes back as the
 * panel's own answer. The task's inbox is answered to the panel alone: the
 * notices (`@luke/host/agent-notices`) watch what waits across the account
 * on a read of their own. Nothing else is held here. The core asks about an
 * agent, and what it published, ride the act port
 * (`act-port/agents-procedures.ts`).
 */
export interface CodingAgentActsDependencies {
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

export type CodingAgentActKind =
  | typeof ACT_KIND.CODING_AGENTS_INBOX
  | typeof ACT_KIND.CODING_AGENTS_AGENT_INBOX
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ANSWER
  | typeof ACT_KIND.CODING_AGENTS_INBOX_CLOSE
  | typeof ACT_KIND.CODING_AGENTS_INBOX_MESSAGE
  | typeof ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
  | typeof ACT_KIND.CODING_AGENTS_INBOX_READ_ALL
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT
  | typeof ACT_KIND.CODING_AGENTS_PICTURE
  | typeof ACT_KIND.CODING_AGENTS_CHAT
  | typeof ACT_KIND.CODING_AGENTS_CHAT_POST
  | typeof ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT;

/** The refusal a window that draws no Tasks tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: CodingAgentActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function codingAgentActRows(
  dependencies: CodingAgentActsDependencies,
): Pick<ActRows, CodingAgentActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.CODING_AGENTS_INBOX]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX, sender);
      return host.codingAgentInbox(params);
    },
    [ACT_KIND.CODING_AGENTS_AGENT_INBOX]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_AGENT_INBOX, sender);
      return host.codingAgentAgentInbox(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_ANSWER, sender);
      return host.codingAgentInboxAnswer(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_CLOSE, sender);
      return host.codingAgentInboxClose(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, sender);
      return host.codingAgentInboxMessage(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, sender);
      return host.codingAgentInboxReadState(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, sender);
      return host.codingAgentInboxReadAll(params);
    },
    [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT, sender);
      return host.codingAgentInboxAttachment(params);
    },
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [ACT_KIND.CODING_AGENTS_PICTURE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PICTURE, sender);
      return host.codingAgentPicture(params);
    },
    [ACT_KIND.CODING_AGENTS_CHAT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHAT, sender);
      return host.codingAgentChat(params);
    },
    [ACT_KIND.CODING_AGENTS_CHAT_POST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHAT_POST, sender);
      return host.codingAgentChatPost(params);
    },
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT, sender);
      return host.codingAgentChatAttachment(params);
    },
  };
}
