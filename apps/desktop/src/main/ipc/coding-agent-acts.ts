import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentAgentInboxParams,
  type CodingAgentArchiveParams,
  type CodingAgentChangesAnswerView,
  type CodingAgentChooseParams,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageParams,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentParams,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxParams,
  type CodingAgentListAnswer,
  type CodingAgentListParams,
  type CodingAgentMessageParams,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPageParams,
  type CodingAgentPictureParams,
  type CodingAgentPinParams,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestParams,
  type CodingAgentRenameParams,
  type CodingAgentServersParams,
  type CodingAgentStartParams,
  type CodingAgentStopParams,
  type CodingAgentWorkspaceListParams,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "@luke/features/coding-agent-view";
import type { ModelChoice } from "@luke/features/models-wire";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { AgentNotices } from "@luke/host/agent-notices";
import { Effect } from "effect";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * coding-agent-acts.ts -- the Plans tab's coding-agent acts: the panel's asks of the host about a plan's agents.
 *
 * The one check this process makes is who asked, as for every planning act:
 * only a panel draws a plan's agents, so every row refuses the takeover and
 * the hidden voice window. What the service answers comes back as the
 * panel's own answer; on its way it is noted by the notices
 * (`@luke/host/agent-notices`), which hold where each agent stands so an end
 * the panel is not looking at is still announced, and which plan's Inbox
 * the panel shows, so an item it is looking at is not. The plan's inbox is
 * answered to the panel alone: the notices watch what waits across the
 * account on a read of their own. Nothing else is held here.
 *
 * The account's own provider keys, which an agent runs on, are asked here
 * too, from Settings in the same panel: a save's key passes through to the
 * host once and is noted nowhere. The account's plan template is asked here
 * too, from Settings › Plan template, and is noted nowhere either.
 *
 * So does a clip dictated into an agent's or a new plan's box: only a panel
 * records one, and it passes through to the host once and is noted nowhere.
 */
export interface CodingAgentActsDependencies {
  host: {
    codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
    codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
    codingAgentWorkspaceList(
      params: CodingAgentWorkspaceListParams,
    ): Effect.Effect<CodingAgentListAnswer>;
    codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentMessages(
      params: CodingAgentMessagesParams,
    ): Effect.Effect<CodingAgentMessagesAnswerView>;
    codingAgentMessage(params: CodingAgentMessageParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentChoose(params: CodingAgentChooseParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentRename(params: CodingAgentRenameParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentServers(params: CodingAgentServersParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentArchive(params: CodingAgentArchiveParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentPin(params: CodingAgentPinParams): Effect.Effect<CodingAgentAgentAnswer>;
    /** The plan list read again, which carries every agent with no plan beside the plans. */
    tasksRefresh(): Effect.Effect<void>;
    codingAgentPage(params: CodingAgentPageParams): Effect.Effect<CodingAgentPageAnswerView>;
    codingAgentPullRequest(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentPullRequestAnswerView>;
    codingAgentChanges(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentChangesAnswerView>;
    codingAgentOverview(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentOverviewAnswerView>;
    codingAgentGitHubImage(
      params: CodingAgentGitHubImageParams,
    ): Effect.Effect<CodingAgentGitHubImageView>;
    providerKeysRead(): Effect.Effect<ProviderKeysAnswerView>;
    providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
    planTemplateRead(): Effect.Effect<PlanTemplateAnswerView>;
    planTemplateWrite(params: PlanTemplateWriteParams): Effect.Effect<PlanTemplateAnswerView>;
    planTemplateRevisions(
      params: PlanTemplateRevisionsParams,
    ): Effect.Effect<PlanTemplateRevisionsAnswerView>;
    planTemplateRevision(
      params: PlanTemplateRevisionParams,
    ): Effect.Effect<PlanTemplateRevisionAnswerView>;
    planTemplateRestore(params: PlanTemplateRevisionParams): Effect.Effect<PlanTemplateAnswerView>;
    dictationTranscribe(
      params: DictationTranscribeParams,
    ): Effect.Effect<DictationTranscribeAnswerView>;
    codingAgentInbox(params: CodingAgentInboxParams): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentAgentInbox(
      params: CodingAgentAgentInboxParams,
    ): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentInboxAnswer(
      params: CodingAgentInboxAnswerParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxAttachment(
      params: CodingAgentInboxAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentPicture(
      params: CodingAgentPictureParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
  };
  /** Where every answer's agents are noted, and which agent's tab the panel shows. */
  notices: Pick<
    AgentNotices,
    | "observeAgents"
    | "observeStatus"
    | "observeTitle"
    | "observeMessaged"
    | "observeModels"
    | "observePublished"
    | "observeTaskGone"
    | "shown"
    | "shownInbox"
  >;
}

type CodingAgentActKind =
  | typeof ACT_KIND.CODING_AGENTS_MODELS
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_READ
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_WRITE
  | typeof ACT_KIND.CODING_AGENTS_LIST
  | typeof ACT_KIND.CODING_AGENTS_WORKSPACE_LIST
  | typeof ACT_KIND.CODING_AGENTS_START
  | typeof ACT_KIND.CODING_AGENTS_MESSAGES
  | typeof ACT_KIND.CODING_AGENTS_MESSAGE
  | typeof ACT_KIND.CODING_AGENTS_CHOOSE
  | typeof ACT_KIND.CODING_AGENTS_RENAME
  | typeof ACT_KIND.CODING_AGENTS_SERVERS
  | typeof ACT_KIND.CODING_AGENTS_STOP
  | typeof ACT_KIND.CODING_AGENTS_ARCHIVE
  | typeof ACT_KIND.CODING_AGENTS_PIN
  | typeof ACT_KIND.CODING_AGENTS_SHOWN
  | typeof ACT_KIND.CODING_AGENTS_PAGE
  | typeof ACT_KIND.CODING_AGENTS_PULL_REQUEST
  | typeof ACT_KIND.CODING_AGENTS_CHANGES
  | typeof ACT_KIND.CODING_AGENTS_OVERVIEW
  | typeof ACT_KIND.CODING_AGENTS_GITHUB_IMAGE
  | typeof ACT_KIND.PROVIDER_KEYS_READ
  | typeof ACT_KIND.PROVIDER_KEYS_SAVE
  | typeof ACT_KIND.PROVIDER_KEYS_REMOVE
  | typeof ACT_KIND.PLAN_TEMPLATE_READ
  | typeof ACT_KIND.PLAN_TEMPLATE_WRITE
  | typeof ACT_KIND.PLAN_TEMPLATE_REVISIONS
  | typeof ACT_KIND.PLAN_TEMPLATE_REVISION
  | typeof ACT_KIND.PLAN_TEMPLATE_RESTORE
  | typeof ACT_KIND.DICTATION_TRANSCRIBE
  | typeof ACT_KIND.CODING_AGENTS_INBOX
  | typeof ACT_KIND.CODING_AGENTS_AGENT_INBOX
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ANSWER
  | typeof ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT
  | typeof ACT_KIND.CODING_AGENTS_PICTURE;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
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
  // Note that an agent with no plan is listed by the plan list, which is read again so its row says what the act changed.
  const notedAgent = (answer: Effect.Effect<CodingAgentAgentAnswer>) =>
    Effect.tap(
      noted(answer, (value) => {
        if ("agent" in value) notices.observeAgents([value.agent]);
      }),
      (value) =>
        "agent" in value && value.agent.planId === null ? host.tasksRefresh() : Effect.void,
    );
  return {
    [ACT_KIND.CODING_AGENTS_MODELS]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MODELS, sender);
      return noted(host.codingAgentModels(), (answer) => {
        if ("models" in answer) notices.observeModels(answer.models);
      });
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_READ, sender);
      return host.codingAgentDefaultRead();
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: (choice, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, sender);
      return host.codingAgentDefaultWrite(choice);
    },
    [ACT_KIND.CODING_AGENTS_WORKSPACE_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST, sender);
      return host.codingAgentWorkspaceList(params);
    },
    [ACT_KIND.CODING_AGENTS_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_LIST, sender);
      return noted(host.codingAgentList(params), (answer) => {
        if ("agents" in answer) notices.observeAgents(answer.agents);
        else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
          notices.observeTaskGone(params.taskId);
        }
      });
    },
    [ACT_KIND.CODING_AGENTS_START]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_START, sender);
      return notedAgent(host.codingAgentStart(params));
    },
    [ACT_KIND.CODING_AGENTS_MESSAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MESSAGES, sender);
      // A worker's page says where the worker stands and what it is called, which is no word on the agent.
      return noted(host.codingAgentMessages(params), (answer) => {
        if ("status" in answer && params.callId === undefined) {
          // The title first, so an end this page carries is announced under it.
          notices.observeTitle(params.agentId, answer.title);
          notices.observeStatus(params.agentId, answer.status);
        }
      });
    },
    [ACT_KIND.CODING_AGENTS_MESSAGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MESSAGE, sender);
      return noted(host.codingAgentMessage(params), (answer) => {
        if ("agent" in answer) notices.observeMessaged(answer.agent);
      });
    },
    [ACT_KIND.CODING_AGENTS_CHOOSE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHOOSE, sender);
      return notedAgent(host.codingAgentChoose(params));
    },
    [ACT_KIND.CODING_AGENTS_RENAME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_RENAME, sender);
      return notedAgent(host.codingAgentRename(params));
    },
    [ACT_KIND.CODING_AGENTS_SERVERS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_SERVERS, sender);
      return notedAgent(host.codingAgentServers(params));
    },
    [ACT_KIND.CODING_AGENTS_STOP]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_STOP, sender);
      return notedAgent(host.codingAgentStop(params));
    },
    [ACT_KIND.CODING_AGENTS_ARCHIVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_ARCHIVE, sender);
      return notedAgent(host.codingAgentArchive(params));
    },
    [ACT_KIND.CODING_AGENTS_PIN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PIN, sender);
      return notedAgent(host.codingAgentPin(params));
    },
    [ACT_KIND.CODING_AGENTS_SHOWN]: ({ agentId, inboxTaskId: inboxPlanId }, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_SHOWN, sender);
      notices.shown(agentId);
      notices.shownInbox(inboxPlanId);
    },
    [ACT_KIND.CODING_AGENTS_PAGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PAGE, sender);
      return host.codingAgentPage(params);
    },
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PULL_REQUEST, sender);
      return noted(host.codingAgentPullRequest(params), (answer) => {
        if ("pullRequest" in answer) notices.observePublished(params.agentId, answer.pullRequest);
      });
    },
    [ACT_KIND.CODING_AGENTS_CHANGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_CHANGES, sender);
      return host.codingAgentChanges(params);
    },
    [ACT_KIND.CODING_AGENTS_OVERVIEW]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_OVERVIEW, sender);
      return host.codingAgentOverview(params);
    },
    // Note that the image's answer, a failure among them, is the panel's to read, as an agent's picture's is.
    [ACT_KIND.CODING_AGENTS_GITHUB_IMAGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, sender);
      return host.codingAgentGitHubImage(params);
    },
    [ACT_KIND.PROVIDER_KEYS_READ]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PROVIDER_KEYS_READ, sender);
      return host.providerKeysRead();
    },
    [ACT_KIND.PROVIDER_KEYS_SAVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PROVIDER_KEYS_SAVE, sender);
      return host.providerKeySave(params);
    },
    [ACT_KIND.PROVIDER_KEYS_REMOVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PROVIDER_KEYS_REMOVE, sender);
      return host.providerKeyRemove(params);
    },
    [ACT_KIND.PLAN_TEMPLATE_READ]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLAN_TEMPLATE_READ, sender);
      return host.planTemplateRead();
    },
    [ACT_KIND.PLAN_TEMPLATE_WRITE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLAN_TEMPLATE_WRITE, sender);
      return host.planTemplateWrite(params);
    },
    [ACT_KIND.PLAN_TEMPLATE_REVISIONS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLAN_TEMPLATE_REVISIONS, sender);
      return host.planTemplateRevisions(params);
    },
    [ACT_KIND.PLAN_TEMPLATE_REVISION]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLAN_TEMPLATE_REVISION, sender);
      return host.planTemplateRevision(params);
    },
    [ACT_KIND.PLAN_TEMPLATE_RESTORE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLAN_TEMPLATE_RESTORE, sender);
      return host.planTemplateRestore(params);
    },
    [ACT_KIND.DICTATION_TRANSCRIBE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.DICTATION_TRANSCRIBE, sender);
      return host.dictationTranscribe(params);
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
    [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT, sender);
      return host.codingAgentInboxAttachment(params);
    },
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [ACT_KIND.CODING_AGENTS_PICTURE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PICTURE, sender);
      return host.codingAgentPicture(params);
    },
  };
}
