import type {
  CodingAgentAgentInboxParams,
  CodingAgentChangesAnswerView,
  CodingAgentChatAnswerView,
  CodingAgentChatParams,
  CodingAgentChatPostParams,
  CodingAgentChatWriteAnswerView,
  CodingAgentGitHubImageParams,
  CodingAgentGitHubImageView,
  CodingAgentInboxAnsweredView,
  CodingAgentInboxAnswerParams,
  CodingAgentInboxAnswerView,
  CodingAgentInboxAttachmentParams,
  CodingAgentInboxAttachmentView,
  CodingAgentInboxMessagedView,
  CodingAgentInboxMessageParams,
  CodingAgentInboxParams,
  CodingAgentInboxReadAllView,
  CodingAgentInboxReadStateParams,
  CodingAgentInboxReadStateView,
  CodingAgentOverviewChecksAnswerView,
  CodingAgentOverviewConversationAnswerView,
  CodingAgentOverviewPullRequestAnswerView,
  CodingAgentPictureParams,
  CodingAgentPullRequestActionParams,
  CodingAgentPullRequestAnswerView,
  CodingAgentPullRequestParams,
  CodingAgentPullRequestReadParams,
  CodingAgentPullRequestViewedAnswerView,
  CodingAgentPullRequestWriteAnswerView,
  CodingAgentReviewOptionsAnswerView,
} from "@luke/features/coding-agent-view";
import type { InboxReadAllRequest } from "@luke/features/inbox-wire";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import type { AgentNotices } from "../agent-notices.js";
import { ActRefused, type ActRows, type ActSender } from "./router.js";

/**
 * coding-agent-acts.ts -- the Tasks tab's coding-agent acts: the panel's asks of the host about a task's agents.
 *
 * The one check these rows make is who asked, as for every task act:
 * only a panel draws a task's agents, so every row refuses the takeover and
 * the hidden voice window. What the service answers comes back as the
 * panel's own answer; what an agent published is noted on its way by the
 * notices (`@luke/host/agent-notices`). The task's inbox is answered to the
 * panel alone: the notices watch what waits across the account on a read of
 * their own. Nothing else is held here. The core asks about an agent ride
 * the act port (`act-port/agents-procedures.ts`).
 */
export interface CodingAgentActsDependencies {
  host: {
    codingAgentPullRequest(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentPullRequestAnswerView>;
    codingAgentChanges(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentChangesAnswerView>;
    codingAgentOverviewPullRequest(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewPullRequestAnswerView>;
    codingAgentReviewOptions(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentReviewOptionsAnswerView>;
    codingAgentOverviewChecks(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewChecksAnswerView>;
    codingAgentOverviewConversation(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewConversationAnswerView>;
    codingAgentGitHubImage(
      params: CodingAgentGitHubImageParams,
    ): Effect.Effect<CodingAgentGitHubImageView>;
    codingAgentPullRequestAction(
      params: CodingAgentPullRequestActionParams,
    ): Effect.Effect<CodingAgentPullRequestWriteAnswerView>;
    codingAgentPullRequestViewed(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentPullRequestViewedAnswerView>;
    codingAgentInbox(params: CodingAgentInboxParams): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentAgentInbox(
      params: CodingAgentAgentInboxParams,
    ): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentInboxAnswer(
      params: CodingAgentInboxAnswerParams,
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
  };
  /** Where what an agent published is noted. */
  notices: Pick<AgentNotices, "observePublished">;
}

export type CodingAgentActKind =
  | typeof ACT_KIND.CODING_AGENTS_PULL_REQUEST
  | typeof ACT_KIND.CODING_AGENTS_CHANGES
  | typeof ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST
  | typeof ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS
  | typeof ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS
  | typeof ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION
  | typeof ACT_KIND.CODING_AGENTS_GITHUB_IMAGE
  | typeof ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION
  | typeof ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED
  | typeof ACT_KIND.CODING_AGENTS_INBOX
  | typeof ACT_KIND.CODING_AGENTS_AGENT_INBOX
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ANSWER
  | typeof ACT_KIND.CODING_AGENTS_INBOX_MESSAGE
  | typeof ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
  | typeof ACT_KIND.CODING_AGENTS_INBOX_READ_ALL
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT
  | typeof ACT_KIND.CODING_AGENTS_PICTURE
  | typeof ACT_KIND.CODING_AGENTS_CHAT
  | typeof ACT_KIND.CODING_AGENTS_CHAT_POST;

/** The refusal a window that draws no Tasks tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: CodingAgentActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

/** The answer as it stands, noted on its way to the panel. */
function noted<Answer>(
  answer: Effect.Effect<Answer>,
  note: (answer: Answer) => void,
): Effect.Effect<Answer> {
  return Effect.tap(answer, (value) => Effect.sync(() => note(value)));
}

export function codingAgentActRows(
  dependencies: CodingAgentActsDependencies,
): Pick<ActRows, CodingAgentActKind> {
  const { host, notices } = dependencies;
  return {
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PULL_REQUEST, sender);
      // Note that a read of another pull request by its number is no word on what the agent itself published.
      return noted(host.codingAgentPullRequest(params), (answer) => {
        if ("pullRequest" in answer && params.number === undefined) {
          notices.observePublished(params.agentId, answer.pullRequest);
        }
      });
    },
    [ACT_KIND.CODING_AGENTS_CHANGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHANGES, sender);
      return host.codingAgentChanges(params);
    },
    [ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST, sender);
      return host.codingAgentOverviewPullRequest(params);
    },
    [ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS, sender);
      return host.codingAgentReviewOptions(params);
    },
    [ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS, sender);
      return host.codingAgentOverviewChecks(params);
    },
    [ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION, sender);
      return host.codingAgentOverviewConversation(params);
    },
    // Note that the image's answer, a failure among them, is the panel's to read, as an agent's picture's is.
    [ACT_KIND.CODING_AGENTS_GITHUB_IMAGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, sender);
      return host.codingAgentGitHubImage(params);
    },
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, sender);
      return host.codingAgentPullRequestAction(params);
    },
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED, sender);
      return host.codingAgentPullRequestViewed(params);
    },
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
  };
}
