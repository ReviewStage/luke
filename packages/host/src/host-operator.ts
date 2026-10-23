import type { AccountProvider, AccountSnapshot } from "@luke/credentials/snapshot";
import { WORKSPACE_CALL_FAILURE } from "@luke/features";
import {
  ADMIN_UNANSWERED,
  type AdminFavoriteParams,
  type AdminReadAnswer,
  type AdminReadParams,
  adminReadAnswerSchema,
} from "@luke/features/admin-wire";
import type { ProductEventName, ProductEventPropertiesFor } from "@luke/features/analytics";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationFollow,
  type AutomationFollowed,
  type AutomationIdParams,
  type AutomationListParams,
  type AutomationListView,
  type AutomationRunParams,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationView,
  automationDeletedViewSchema,
  automationFollowedSchema,
  automationListViewSchema,
  automationRunsViewSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@luke/features/automation-view";
import {
  type BrowserLiveClosedEvent,
  type BrowserLiveMessageEvent,
  browserLiveClosedEventSchema,
  browserLiveMessageEventSchema,
} from "@luke/features/browser-live-acts";
import {
  type ChatGptSignInAnswerView,
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentAgentAnswer,
  type CodingAgentArchiveParams,
  type CodingAgentCallsAnswerView,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatAttachmentParams,
  type CodingAgentChatChanged,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentChooseParams,
  type CodingAgentDefaultAnswer,
  type CodingAgentDeleteAnswerView,
  type CodingAgentGitHubImageParams,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAttachmentParams,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxChanged,
  type CodingAgentInboxCloseParams,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxMessageParams,
  type CodingAgentInboxReadAllView,
  type CodingAgentInboxReadStateParams,
  type CodingAgentInboxReadStateView,
  type CodingAgentInboxScope,
  type CodingAgentInboxStartParams,
  type CodingAgentListAnswer,
  type CodingAgentListParams,
  type CodingAgentMessageParams,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentModelsAnswer,
  type CodingAgentOperatorEnsureAnswerView,
  type CodingAgentOperatorEnsureParams,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPageParams,
  type CodingAgentPartParams,
  type CodingAgentPartView,
  type CodingAgentPictureParams,
  type CodingAgentPinParams,
  type CodingAgentPullRequestActionParams,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestParams,
  type CodingAgentPullRequestReadParams,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  type CodingAgentRenameParams,
  type CodingAgentReviewOptionsAnswerView,
  type CodingAgentRewindParams,
  type CodingAgentServersParams,
  type CodingAgentStartParams,
  type CodingAgentStopParams,
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  type CodingAgentTranscriptOlderAnswer,
  type CodingAgentTranscriptOlderParams,
  type CodingAgentWorkspaceListParams,
  chatGptSignInAnswerViewSchema,
  codingAgentAccountInboxAnswerViewSchema,
  codingAgentAgentAnswerSchema,
  codingAgentCallsAnswerViewSchema,
  codingAgentChangesAnswerViewSchema,
  codingAgentChatChangedSchema,
  codingAgentChatWriteAnswerViewSchema,
  codingAgentDefaultAnswerViewSchema,
  codingAgentDeleteAnswerViewSchema,
  codingAgentGitHubImageViewSchema,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentInboxChangedSchema,
  codingAgentInboxMessagedViewSchema,
  codingAgentInboxReadAllViewSchema,
  codingAgentInboxReadStateViewSchema,
  codingAgentListAnswerViewSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentModelsAnswerSchema,
  codingAgentOperatorEnsureAnswerViewSchema,
  codingAgentOverviewChecksAnswerViewSchema,
  codingAgentOverviewConversationAnswerViewSchema,
  codingAgentOverviewPullRequestAnswerViewSchema,
  codingAgentPageAnswerViewSchema,
  codingAgentPartViewSchema,
  codingAgentPullRequestAnswerViewSchema,
  codingAgentPullRequestViewedAnswerViewSchema,
  codingAgentPullRequestWriteAnswerViewSchema,
  codingAgentReviewOptionsAnswerViewSchema,
  codingAgentTranscriptChangedSchema,
  codingAgentTranscriptOlderAnswerSchema,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  dictationTranscribeAnswerViewSchema,
  type GitHubTokenAnswerView,
  type GitHubTokenSaveParams,
  githubTokenAnswerViewSchema,
  type MemoriesAnswerView,
  type MemoriesReadParams,
  type MemoryForgetParams,
  memoriesAnswerViewSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyForAgentsParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
  planTemplateAnswerViewSchema,
  planTemplateRevisionAnswerViewSchema,
  planTemplateRevisionsAnswerViewSchema,
  providerKeysAnswerViewSchema,
} from "@luke/features/coding-agent-view";
import type { InboxReadAllRequest } from "@luke/features/inbox-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillIdParams,
  type InstalledSkillInstallParams,
  type InstalledSkillInstallView,
  type InstalledSkillListParams,
  type InstalledSkillListView,
  type InstalledSkillPreviewFileParams,
  type InstalledSkillPreviewFileView,
  type InstalledSkillPreviewParams,
  type InstalledSkillPreviewView,
  type InstalledSkillRemovedView,
  type InstalledSkillShareParams,
  type InstalledSkillToggleParams,
  type InstalledSkillUpdateCheckView,
  type InstalledSkillUpdatedView,
  type InstalledSkillUpdateParams,
  type InstalledSkillView,
  installedSkillContentViewSchema,
  installedSkillInstallViewSchema,
  installedSkillListViewSchema,
  installedSkillPreviewFileViewSchema,
  installedSkillPreviewViewSchema,
  installedSkillRemovedViewSchema,
  installedSkillUpdateCheckViewSchema,
  installedSkillUpdatedViewSchema,
  installedSkillViewSchema,
} from "@luke/features/installed-skill-view";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationConnectView,
  type IntegrationProviderParams,
  type IntegrationRenameParams,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationStatusesViewSchema,
  integrationStatusViewSchema,
  integrationToolsViewSchema,
} from "@luke/features/integration-view";
import {
  type MacRepositoriesAnswer,
  type MacRepository,
  macRepositoriesAnswerSchema,
} from "@luke/features/mac-terminal-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import {
  type ChaptersModelAnswerView,
  type ChaptersModelWriteParams,
  chaptersModelAnswerViewSchema,
  type PullRequestChaptersAnswerView,
  type PullRequestChaptersParams,
  pullRequestChaptersAnswerViewSchema,
} from "@luke/features/pull-request-chapters-view";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TaskBrowserTabsFollow,
  type TaskBrowserTabsFollowed,
  type TaskHistoryFollow,
  type TaskHistoryFollowed,
  type TaskPagesFollow,
  type TaskPagesFollowed,
  type TasksBoardSaveParams,
  type TasksBrowserTabOpenAnswer,
  type TasksBrowserTabOpenParams,
  type TasksBrowserTabsAnswer,
  type TasksBrowserTabsParams,
  type TasksCommentActParams,
  type TasksCommentAnswer,
  type TasksCommentStartParams,
  type TasksCommentsAnswer,
  type TasksCommentsParams,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksFileAnswer,
  type TasksFileParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubIssuesAnswer,
  type TasksGitHubIssuesParams,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksIssueLinkAnswer,
  type TasksIssueLinkParams,
  type TasksIssueLinksAnswer,
  type TasksIssueLinksParams,
  type TasksIssueParams,
  type TasksIssueRelateAnswer,
  type TasksIssueRelateParams,
  type TasksIssueUnlinkAnswer,
  type TasksIssueUnlinkParams,
  type TasksLinearIssuesAnswer,
  type TasksLinearIssuesParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksPagesAnswer,
  type TasksPagesParams,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPictureKeepParams,
  type TasksPictureParams,
  type TasksPinParams,
  type TasksPinRepositoryParams,
  type TasksPullRequestAnswer,
  type TasksPullRequestParams,
  type TasksRenameParams,
  type TasksRepositoriesAnswer,
  type TasksRepositoriesParams,
  type TasksRevisionAnswer,
  type TasksRevisionParams,
  type TasksRevisionsAnswer,
  type TasksRevisionsParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksSetStandingParams,
  type TasksSkillsAnswer,
  type TasksSkillsParams,
  type TasksStartAnswer,
  type TasksStartRequest,
  type TasksTreeAnswer,
  type TasksTreeParams,
  type TasksView,
  type TasksWorkspaceAnswer,
  type TasksWorkspaceCreateParams,
  type TasksWorkspaceGitHubConnectAnswer,
  type TasksWorkspaceInvitationAnswer,
  type TasksWorkspaceInvitationCancelParams,
  type TasksWorkspaceInvitationsAnswer,
  type TasksWorkspaceInviteParams,
  type TasksWorkspaceLeaveAnswer,
  type TasksWorkspaceLeaveParams,
  type TasksWorkspaceMemberRemoveParams,
  type TasksWorkspaceMemberRoleParams,
  type TasksWorkspaceMembersAnswer,
  type TasksWorkspaceMembersParams,
  type TasksWorkspaceParams,
  type TasksWorkspacePhotoAnswer,
  type TasksWorkspacePhotoParams,
  type TasksWorkspacePhotoSetParams,
  type TasksWorkspaceRenameParams,
  type TasksWorkspaceSentryAnswer,
  type TasksWorkspaceSentryDisconnectParams,
  type TasksWorkspaceTokenRepositoriesAnswer,
  type TasksWorkspaceTokenRepositoriesParams,
  type TasksWorkspaceTokenRepositorySetParams,
  type TasksWorkspaceTransferParams,
  type TasksWriteSectionParams,
  taskBrowserTabsFollowedSchema,
  taskHistoryFollowedSchema,
  taskPagesFollowedSchema,
  tasksBrowserTabOpenAnswerSchema,
  tasksBrowserTabsAnswerSchema,
  tasksCommentAnswerSchema,
  tasksCommentsAnswerSchema,
  tasksEditAnswerSchema,
  tasksFileAnswerSchema,
  tasksGitHubDisconnectAnswerSchema,
  tasksGitHubIssuesAnswerSchema,
  tasksGitHubPageAnswerSchema,
  tasksIssueAnswerSchema,
  tasksIssueLinkAnswerSchema,
  tasksIssueLinksAnswerSchema,
  tasksIssueRelateAnswerSchema,
  tasksIssueUnlinkAnswerSchema,
  tasksLinearIssuesAnswerSchema,
  tasksMoveAnswerSchema,
  tasksPageAnswerSchema,
  tasksPagesAnswerSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksPullRequestAnswerSchema,
  tasksRepositoriesAnswerSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionsAnswerSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSkillsAnswerSchema,
  tasksStartAnswerSchema,
  tasksTreeAnswerSchema,
  tasksWorkspaceAnswerSchema,
  tasksWorkspaceGitHubConnectAnswerSchema,
  tasksWorkspaceInvitationAnswerSchema,
  tasksWorkspaceInvitationsAnswerSchema,
  tasksWorkspaceLeaveAnswerSchema,
  tasksWorkspaceMembersAnswerSchema,
  tasksWorkspacePhotoAnswerSchema,
  tasksWorkspaceSentryAnswerSchema,
  tasksWorkspaceTokenRepositoriesAnswerSchema,
  type WorkspaceInvitationsFollowed,
  type WorkspacePeopleFollow,
  type WorkspacePeopleFollowed,
  workspaceInvitationsFollowedSchema,
  workspacePeopleFollowedSchema,
} from "@luke/features/tasks-view";
import {
  type TerminalCreatedActAnswer,
  type TerminalResumedActAnswer,
  type TerminalStateEvent,
  type TerminalsActAnswer,
  terminalCreatedActAnswerSchema,
  terminalOutputEventSchema,
  terminalResumedActAnswerSchema,
  terminalStateEventSchema,
  terminalsActAnswerSchema,
} from "@luke/features/terminal-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  type GatewayMethod,
  gatewayEventReader,
  type VoiceCreateLiveSessionResult,
  type VoiceEndLiveSessionParams,
  type VoiceLiveSessionChanged,
  type VoiceReportLiveTransportParams,
  voiceCreateLiveSessionResultSchema,
  voiceLiveSessionChangedSchema,
  voiceSetVideoResultSchema,
  voiceStopSpeakingResultSchema,
} from "@luke/gateway";
import type { AgentWireTrace } from "@luke/gateway/devtrace";
import type { LiveDiagnostics } from "@luke/live";
import type {
  AppSettingField,
  AppSettingValue,
  Experiment,
  SettingsResetScope,
} from "@luke/settings";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
import type { VoiceCallAbout } from "@luke/voice/voice-view";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, type Schema as EffectSchema, ErrorReporter, Option, Result } from "effect";
import { Base64 } from "effect/encoding";
import type { AppAccessSlice } from "./app-state.js";
import {
  type MacCommandAnswer,
  type MacCommandAsk,
  macCommandAsksSchema,
} from "./mac-command-ask.js";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * voice, task, and client-fact methods the runtime host answers, and the events it pushes. Every method answers an effect: it
 * composes one request and reads its answer, and nothing here runs it — the
 * act procedure that asked yields it, and the act port runs it once on the launch's
 * own runtime. The host is this same process, so an answer that is not the
 * shape the method documents is a defect of the build rather than a reachable
 * host state, and dies where it is read; the act port words a defect as the
 * kind's own refusal. Nothing here holds host state beyond the last settings
 * snapshot a refusal is answered with.
 */
export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessionReplay: { permitted: boolean; accountId?: string };
  /** What the signed-in account may open in the app, as the host last read it. */
  access: AppAccessSlice;
  voiceAvailable: boolean;
  agentTraceEnabled: boolean;
}

interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

interface HostSessionReplay {
  permitted: boolean;
  accountId?: string;
}

export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  /** Every repository with a run command on this Mac; none where the host could not answer. */
  macRepositories(): Effect.Effect<MacRepositoriesAnswer | undefined>;
  /** One repository's run command set on this Mac, or forgotten with null; the repositories as they then stand. */
  setMacRepository(entry: MacRepository): Effect.Effect<MacRepositoriesAnswer | undefined>;
  /** The developer's answer to one command an agent asked to run on this Mac; whether the ask still waited. */
  answerMacCommand(answer: MacCommandAnswer): Effect.Effect<boolean>;
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  /** One group returned to its defaults, but for the fields `kept`, which the asking page does not draw. */
  resetSettings(
    scope: SettingsResetScope,
    kept: readonly AppSettingField[],
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  /** One experiment turned on or off for the signed-in account, on the service. */
  setExperiment(
    experiment: Experiment,
    on: boolean,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  accountSnapshot(): Effect.Effect<Option.Option<AccountSnapshot>>;
  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot>;
  /** The sign-in taken again over the session that stands: whether a new session landed. */
  signInAgain(provider: AccountProvider): Effect.Effect<boolean>;
  cancelSignIn(): Effect.Effect<void>;
  signOut(): Effect.Effect<AccountSnapshot>;
  deleteAccount(): Effect.Effect<AccountSnapshot>;
  /** Why voice is or is not available, carrying no credential; a host that cannot be reached answers nothing. */
  liveDiagnostics(): Effect.Effect<Option.Option<LiveDiagnostics>>;
  /**
   * The peer's SDP offer, and the agent the call speaks into with its task where it has one,
   * answered with the session the host created; a host that creates none
   * answers nothing.
   */
  createLiveSession(
    sdp: string,
    about: VoiceCallAbout,
  ): Effect.Effect<Option.Option<VoiceCreateLiveSessionResult>>;
  /** The peer's hang-up of the session it names; one the host no longer holds is left alone. */
  endLiveSession(request: VoiceEndLiveSessionParams): Effect.Effect<void>;
  reportLiveTransport(report: VoiceReportLiveTransportParams): Effect.Effect<void>;
  /** The peer's own idle decision, from its local signals alone; the host decides the close. */
  reportLiveActivity(idle: boolean): Effect.Effect<void>;
  /** The stop key: the standing session is told to stop speaking; answers whether one stood to tell. */
  stopSpeaking(): Effect.Effect<boolean>;
  /** Luke's avatar asked for on the standing call, or taken down as the developer's own; answers whether the service was asked. */
  setVideo(on: boolean): Effect.Effect<boolean>;
  /** One tapped wire event for the host's development trace; the host drops it where no writer stands. */
  recordAgentTrace(trace: AgentWireTrace): Effect.Effect<void>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Tasks tab shows: the host reads the task list and the active document now and follows both until it is paused. */
  tasksRefresh(): Effect.Effect<void>;
  /** The account's workspaces read again, where the host's last read is a minute old. */
  workspacesRefresh(): Effect.Effect<void>;
  /** The Tasks tab stopped showing: the host follows nothing, and the open task and its call stand. */
  /** One task made the active one, replacing whichever was; answers whether the host took it. */
  tasksOpen(taskId: string): Effect.Effect<boolean>;
  /** The developer left the open task: its call ends and no task is active. */
  tasksClose(): Effect.Effect<void>;
  /** A named task started on the repository it names, where it names one, and made the active one; or why none started. */
  tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
  /** One task deleted; answers whether the service deleted it. */
  tasksDelete(taskId: string): Effect.Effect<boolean>;
  /** One task renamed; answers whether the service renamed it. */
  tasksRename(params: TasksRenameParams): Effect.Effect<boolean>;
  tasksSetStanding(params: TasksSetStandingParams): Effect.Effect<boolean>;
  /** One task pinned or unpinned; answers whether the service changed it. */
  tasksPin(params: TasksPinParams): Effect.Effect<boolean>;
  /** One repository pinned in the sidebar or unpinned, kept on the account; answers whether the service changed the pins. */
  tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
  tasksWriteSection(params: TasksWriteSectionParams): Effect.Effect<boolean>;
  /** The repositories the account reaches through the Luke GitHub App, read from the service now; or why there is no list. */
  tasksRepositories(params: TasksRepositoriesParams): Effect.Effect<TasksRepositoriesAnswer>;
  /** One task given its repository, or none; the repository as kept, or why it is unchanged. */
  tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
  /** One task moved to another of the account's workspaces; the workspace it now belongs to, or why it stands where it was. */
  tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
  /** The developer's edit of a task's document; saved, a conflict with the text as it stands now, or why nothing was saved. */
  tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
  /** The open task's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  tasksBoardSave(params: TasksBoardSaveParams): Effect.Effect<void>;
  /** A window of a file of a task's repository, coloured; or why it is not shown. */
  tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
  tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
  /** The skills a developer may choose of a task's repository; or why they are not read. */
  tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
  /** One pull request of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksPullRequest(params: TasksPullRequestParams): Effect.Effect<TasksPullRequestAnswer>;
  /** One issue of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksIssue(params: TasksIssueParams): Effect.Effect<TasksIssueAnswer>;
  /** A repository's issues as New task's picker asks for them; or that its installation grants none, or that the service did not answer. */
  tasksGitHubIssues(params: TasksGitHubIssuesParams): Effect.Effect<TasksGitHubIssuesAnswer>;
  /** The issues a task links, each with where it stands now; or why there are none. */
  tasksIssueLinks(params: TasksIssueLinksParams): Effect.Effect<TasksIssueLinksAnswer>;
  /** The Browser tabs open in a task's agents' browsers, the oldest first; or that the service did not answer. */
  tasksBrowserTabs(params: TasksBrowserTabsParams): Effect.Effect<TasksBrowserTabsAnswer>;
  /** A Browser tab opened at an address in a task's coding agent's browser, taken over by the account; or why none opened. */
  tasksBrowserTabOpen(params: TasksBrowserTabOpenParams): Effect.Effect<TasksBrowserTabOpenAnswer>;
  /** One more issue linked to a task, read from its provider by the service; or why none was. */
  tasksIssueLink(params: TasksIssueLinkParams): Effect.Effect<TasksIssueLinkAnswer>;
  /** Which keyword a task's pull requests write of one of its links; or why it stands as it was. */
  tasksIssueRelate(params: TasksIssueRelateParams): Effect.Effect<TasksIssueRelateAnswer>;
  /** One of a task's links let go; or why it stands. */
  tasksIssueUnlink(params: TasksIssueUnlinkParams): Effect.Effect<TasksIssueUnlinkAnswer>;
  /** A page of a plan's history; or that the service did not answer. */
  tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
  /** One revision of a plan beside the one before it; or that the service did not answer. */
  tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
  /** One revision of a plan restored as its content; answers whether the service restored it. */
  tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
  /** One version of one page of a task with its HTML, for the frame that draws it; or that the service did not answer. */
  tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
  /** One plan's pages, each by its newest version; or that the service did not answer. */
  tasksPages(params: TasksPagesParams): Effect.Effect<TasksPagesAnswer>;
  /** One plan's pages followed from now until let go, heard through `onTaskPagesChanged`. */
  tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
  /** A followed plan's pages let go: nothing more is heard of them until they are followed again. */
  tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
  /** A followed plan's pages as they now stand, each time they move while followed. */
  onTaskPagesChanged(listener: (followed: TaskPagesFollowed) => void): () => void;
  /** One task's cloud Browser tabs followed from now until let go, heard through `onTaskBrowserTabsChanged`. */
  tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  /** A followed task's Browser tabs let go: nothing more is heard of them until they are followed again. */
  tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  /** A followed task's Browser tabs as they now stand, each time one moves or a takeover lapses while followed. */
  onTaskBrowserTabsChanged(listener: (followed: TaskBrowserTabsFollowed) => void): () => void;
  /** One plan's newest page of history followed from now until let go, heard through `onTaskHistoryChanged`. */
  tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  /** A followed plan's history let go: nothing more is heard of it until it is followed again. */
  tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  /** A followed plan's newest page of history as it now stands, each time a save lands while followed. */
  onTaskHistoryChanged(listener: (followed: TaskHistoryFollowed) => void): () => void;
  /** One picture of one plan as its bytes in base64, or why there is none. */
  tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
  /** One picture kept on one plan, answering the id its text names it by, or why it was not kept. */
  tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
  /** One task's comment threads past a cursor, held by the service while nothing changed; or why there are none. */
  tasksComments(params: TasksCommentsParams): Effect.Effect<TasksCommentsAnswer>;
  /** A comment thread started on one task's plan, answered as it stands, or why not. */
  tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
  /** One thing done to one comment thread of one task's plan, answered as it stands, or why not. */
  tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  /** Where every one of the account's integrations stands; or why there is no answer. */
  integrationsStatus(): Effect.Effect<IntegrationStatusesView>;
  /** A sign-in to one provider begun and opened in the browser by the host; whether it was, never the address. */
  integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
  /** The tools one provider's server offers the account's agents; or why there is no answer. */
  integrationsTools(params: IntegrationProviderParams): Effect.Effect<IntegrationToolsView>;
  /** The account's sign-in to one provider under way ended, revoking nothing; where it then stands, or why there is no answer. */
  integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  /** The account's connection to one account at a provider ended; where it then stands, or why there is no answer. */
  integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  /** One account at a provider named as the developer calls it; the account as it then stands, or why there is no answer. */
  integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
  /** The page that connects the account's GitHub, asked of the service; its address, or why there is none. */
  githubConnect(): Effect.Effect<TasksGitHubPageAnswer>;
  /** The account's GitHub disconnected under the Mac's session; the connection as it then stands, or why it is not. */
  githubDisconnect(): Effect.Effect<TasksGitHubDisconnectAnswer>;
  /** One admin dashboard read under the account's session; the service's answer as it came, or why there is none. */
  adminRead(params: AdminReadParams): Effect.Effect<AdminReadAnswer>;
  /** The admin dashboard's star set or taken back on one account; whether it landed. */
  adminFavorite(params: AdminFavoriteParams): Effect.Effect<boolean>;
  /** A workspace made under a name, owned by the account; the workspace, or why none was. */
  workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace renamed by an owner or admin; the workspace under its new name, or why it was not. */
  workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's photo set or removed by an owner or admin; the workspace with its photo's new version or none, or why it was not. */
  workspacePhotoSet(params: TasksWorkspacePhotoSetParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's GitHub organization connection begun; the install address to open, or why there is none. */
  workspaceGitHubConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  /** A workspace's GitHub organization disconnected; the workspace as it then stands, or why it is not. */
  workspaceGitHubDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's Linear connection begun; Vercel Connect's sign-in address to open, or why there is none. */
  workspaceLinearConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  /** A workspace's Linear disconnected; the workspace as it then stands, or why it is not. */
  workspaceLinearDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** The Linear issues a workspace's connection reaches; or why there are none. */
  workspaceLinearIssues(params: TasksLinearIssuesParams): Effect.Effect<TasksLinearIssuesAnswer>;
  /** Whether the deployment holds Luke's Sentry integration, and a workspace's installations of it; or why there is no answer. */
  workspaceSentry(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceSentryAnswer>;
  /** A workspace's Sentry install begun; Sentry's install address to open, or why there is none. */
  workspaceSentryInstall(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  /** One of a workspace's Sentry installations disconnected; the workspace's Sentry as it then stands, or why it is not. */
  workspaceSentryDisconnect(
    params: TasksWorkspaceSentryDisconnectParams,
  ): Effect.Effect<TasksWorkspaceSentryAnswer>;
  /** One workspace's members; or why there are none. */
  workspaceMembers(params: TasksWorkspaceMembersParams): Effect.Effect<TasksWorkspaceMembersAnswer>;
  /** A workspace's people followed from now until let go, heard through `onWorkspacePeopleChanged`; following again starts over. */
  workspacePeopleFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** A followed workspace's people let go: nothing more is heard of them until they are followed again. */
  workspacePeopleUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** A followed workspace's people as they now stand, each time they move while followed. */
  onWorkspacePeopleChanged(listener: (followed: WorkspacePeopleFollowed) => void): () => void;
  /** A workspace's pending invitations followed from now until let go, heard through `onWorkspaceInvitationsChanged`; following again starts over. */
  workspaceInvitationsFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** A followed workspace's invitations let go. */
  workspaceInvitationsUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** A followed workspace's pending invitations as they now stand, each time they move while followed. */
  onWorkspaceInvitationsChanged(
    listener: (followed: WorkspaceInvitationsFollowed) => void,
  ): () => void;
  /** One workspace's photo, its bytes in base64 under its media type; or why there is none. */
  workspacePhoto(params: TasksWorkspacePhotoParams): Effect.Effect<TasksWorkspacePhotoAnswer>;
  /** The repositories members added to a workspace on their own GitHub tokens; or why there are none. */
  workspaceTokenRepositories(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<TasksWorkspaceTokenRepositoriesAnswer>;
  /** A repository added to a workspace on the account's own GitHub token, or removed from it; the workspace's token repositories as they then stand, or why nothing changed. */
  workspaceTokenRepositorySet(
    params: TasksWorkspaceTokenRepositorySetParams,
  ): Effect.Effect<TasksWorkspaceTokenRepositoriesAnswer>;
  /** One member removed from a workspace; the members who remain, or why none was removed. */
  workspaceMemberRemove(
    params: TasksWorkspaceMemberRemoveParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  /** Another member of a workspace made an admin or an admin a member by the owner; the members as they then stand, or why no role changed. */
  workspaceMemberRole(
    params: TasksWorkspaceMemberRoleParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  /** A workspace handed by its owner to one of its admins, the owner becoming an admin; the members as they then stand, or why it was not handed over. */
  workspaceTransfer(
    params: TasksWorkspaceTransferParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  /** One workspace left; or why it was not. */
  workspaceLeave(params: TasksWorkspaceLeaveParams): Effect.Effect<TasksWorkspaceLeaveAnswer>;
  /** One workspace's pending invitations; or why there are none. */
  workspaceInvitations(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
  /** An invitation made; it with its accept link, or why none was. */
  workspaceInvite(
    params: TasksWorkspaceInviteParams,
  ): Effect.Effect<TasksWorkspaceInvitationAnswer>;
  /** A pending invitation canceled; those still pending, or why it was not. */
  workspaceInvitationCancel(
    params: TasksWorkspaceInvitationCancelParams,
  ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
  /** The models a coding agent may run on, as the service offers them now; or why there is no list. */
  codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
  /** The account's default model and effort for a coding agent; or why there is none. */
  codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
  /** The default written; the choice as kept, or why it is unchanged. */
  codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
  /** One task's coding agents with their status; or why there is no list. */
  codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
  /** One workspace's coding agents, newest started first, on one repository where one is named; or why there is no list. */
  codingAgentWorkspaceList(
    params: CodingAgentWorkspaceListParams,
  ): Effect.Effect<CodingAgentListAnswer>;
  /** An agent started on a task under the press's own key; the agent, or why none started. */
  codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent's transcript past a cursor, held by the service while the agent runs; or why there is none. */
  codingAgentMessages(
    params: CodingAgentMessagesParams,
  ): Effect.Effect<CodingAgentMessagesAnswerView>;
  /** One agent sent a message naming how it reaches a turn under way; the agent as it then stands, or why it was not. */
  codingAgentMessage(params: CodingAgentMessageParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent's model and effort changed for its next step; the agent as it then stands, or why it is unchanged. */
  codingAgentChoose(params: CodingAgentChooseParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent renamed, or its title cleared; the agent as it then stands, or why it is unchanged. */
  codingAgentRename(params: CodingAgentRenameParams): Effect.Effect<CodingAgentAgentAnswer>;
  codingAgentServers(params: CodingAgentServersParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent stopped; the agent as it then stands, or why it was not. */
  codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent taken back to just before one of the developer's lines, stopped first where it still works; the agent as it then stands, or why it was not. */
  codingAgentRewind(params: CodingAgentRewindParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  codingAgentArchive(params: CodingAgentArchiveParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent deleted for good, a turn it still runs stopped first; that it was, or why not. */
  codingAgentDelete(params: CodingAgentStopParams): Effect.Effect<CodingAgentDeleteAnswerView>;
  codingAgentPin(params: CodingAgentPinParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** The account's operator in a workspace, Luke, ensured, or reset and ensured afresh: its id, or why there is none. */
  codingAgentEnsureOperator(
    params: CodingAgentOperatorEnsureParams,
  ): Effect.Effect<CodingAgentOperatorEnsureAnswerView>;
  /** One agent read whole as its own page, on a task or with none; or why there is no answer. */
  codingAgentPage(params: CodingAgentPageParams): Effect.Effect<CodingAgentPageAnswerView>;
  /** The calls into one agent, each with its lines and its record; or why there is no answer. */
  codingAgentCalls(params: CodingAgentPageParams): Effect.Effect<CodingAgentCallsAnswerView>;
  /** The account's automations, or one task's or one workspace's; or why there are none. */
  automationList(params: AutomationListParams): Effect.Effect<AutomationListView>;
  /** An automation made; the automation as the service kept it, or why it was not made. */
  automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
  /** One automation changed; the automation as it then stands, or why it is unchanged. */
  automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
  /** One automation deleted with its history; or why it stands. */
  automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
  /** One automation run now under the window's key; the run as it came out, or why there is none. */
  automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
  /** One automation's runs, newest first; or why there are none. */
  automationRuns(params: AutomationIdParams): Effect.Effect<AutomationRunsView>;
  /** A webhook's secret minted again; the automation and the new secret, for the asking window alone to show once, or why there is none. */
  automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
  /** A workspace's automations, or an automation's runs, followed from now until let go or signed out, heard through `onAutomationsChanged`; following again starts over. */
  automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
  /** A followed list or history let go: nothing more is heard of it until it is followed again. */
  automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
  /** A followed list or history as it now stands, each time it moves while followed. */
  onAutomationsChanged(listener: (followed: AutomationFollowed) => void): () => void;
  /** What one agent published: its branch and pull request as GitHub holds them; or why there is no answer. */
  codingAgentPullRequest(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentPullRequestAnswerView>;
  /** The workspace's newest chapters of one agent's pull request, with its head as GitHub holds it; or why there are none. */
  pullRequestChapters(
    params: PullRequestChaptersParams,
  ): Effect.Effect<PullRequestChaptersAnswerView>;
  /** One agent's pull request's chapters generated for its head, or the generation already under way; the chapters as they then stand, or why there are none. */
  pullRequestChaptersGenerate(
    params: PullRequestChaptersParams,
  ): Effect.Effect<PullRequestChaptersAnswerView>;
  /** The Claude model the account's Generate chapters runs on, read from the service; or why there is none. */
  chaptersModelRead(): Effect.Effect<ChaptersModelAnswerView>;
  /** The account's chapters model written to the service; the model as kept, or why it is unchanged. */
  chaptersModelWrite(params: ChaptersModelWriteParams): Effect.Effect<ChaptersModelAnswerView>;
  /** The skills the account sees in a workspace, the workspace's then its own; or why there are none. */
  installedSkillsList(params: InstalledSkillListParams): Effect.Effect<InstalledSkillListView>;
  /** One installed skill read whole, its `SKILL.md` and every file's path and size; or why it was not. */
  installedSkillsRead(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillContentView>;
  /** What a paste would install, read by the service; or why it did not say. */
  installedSkillsPreview(
    params: InstalledSkillPreviewParams,
  ): Effect.Effect<InstalledSkillPreviewView>;
  /** One previewed skill's `SKILL.md` at the commit the preview pinned, read by the service; or why it did not answer. */
  installedSkillsPreviewFile(
    params: InstalledSkillPreviewFileParams,
  ): Effect.Effect<InstalledSkillPreviewFileView>;
  /** The skills a paste makes, installed all or none; or why none were. */
  installedSkillsInstall(
    params: InstalledSkillInstallParams,
  ): Effect.Effect<InstalledSkillInstallView>;
  /** One installed skill turned on or off; the skill as it then stands, or why it is unchanged. */
  installedSkillsSetEnabled(params: InstalledSkillToggleParams): Effect.Effect<InstalledSkillView>;
  /** Whether a GitHub skill's folder moved at its ref; or why that is unknown. */
  installedSkillsCheckUpdate(
    params: InstalledSkillUpdateParams,
  ): Effect.Effect<InstalledSkillUpdateCheckView>;
  /** A GitHub skill's files read again at its ref; the skill as it then stands, or why it is unchanged. */
  installedSkillsUpdate(
    params: InstalledSkillUpdateParams,
  ): Effect.Effect<InstalledSkillUpdatedView>;
  /** The account's own personal skill moved into a workspace; the skill as it then stands, or why it is unchanged. */
  installedSkillsShare(params: InstalledSkillShareParams): Effect.Effect<InstalledSkillView>;
  /** One installed skill removed; or why it stands. */
  installedSkillsRemove(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillRemovedView>;
  /** One agent's changes: its pull request's files as GitHub holds them; or why there are none. */
  codingAgentChanges(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentChangesAnswerView>;
  /** One image an agent's pull request's overview names, read by the service on the App's token; or why there is none. */
  codingAgentGitHubImage(
    params: CodingAgentGitHubImageParams,
  ): Effect.Effect<CodingAgentGitHubImageView>;
  /** One change to an agent's pull request, made on GitHub as the account on its own GitHub sign-in; how GitHub took it, or why there is no answer. */
  codingAgentPullRequestAction(
    params: CodingAgentPullRequestActionParams,
  ): Effect.Effect<CodingAgentPullRequestWriteAnswerView>;
  /** Which of one agent's pull request's files the account marked viewed on GitHub, read on its own GitHub sign-in; or why there is no answer. */
  codingAgentPullRequestViewed(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentPullRequestViewedAnswerView>;
  /** One agent's pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them; or why there is none. */
  codingAgentOverviewPullRequest(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentOverviewPullRequestAnswerView>;
  /** What the reviewer and label pickers of one agent's Pull request tab offer: its repository's labels, collaborators, and teams; or why there is no answer. */
  codingAgentReviewOptions(
    params: CodingAgentPullRequestParams,
  ): Effect.Effect<CodingAgentReviewOptionsAnswerView>;
  /** The checks on one agent's pull request's head as GitHub holds them; or why there are none. */
  codingAgentOverviewChecks(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentOverviewChecksAnswerView>;
  /** One agent's pull request's conversation and where its reviewers stand, as GitHub holds them; or why there is none. */
  codingAgentOverviewConversation(
    params: CodingAgentPullRequestReadParams,
  ): Effect.Effect<CodingAgentOverviewConversationAnswerView>;
  /** The account's own provider keys as hints and statuses; or why there are none. */
  providerKeysRead(): Effect.Effect<ProviderKeysAnswerView>;
  /** One provider key saved, carried once; the keys as they then stand, or why nothing was kept. */
  providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
  /** One provider's key of the kind named removed, an API key where none is; the keys as they then stand. */
  providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
  /** A connected plan's default for the account's coding agents turned on or off; the keys as they then stand. */
  providerKeyForAgents(params: ProviderKeyForAgentsParams): Effect.Effect<ProviderKeysAnswerView>;
  /** A ChatGPT sign-in run through the browser and handed to the service; the keys as they then stand, or why nothing was kept. Never a token. */
  chatGptSignIn(): Effect.Effect<ChatGptSignInAnswerView>;
  /** The ChatGPT sign-in waiting on the browser, withdrawn. */
  chatGptSignInCancel(): Effect.Effect<void>;
  /** The member's own GitHub token as its login, hint, and status; or why there is none. */
  githubTokenRead(): Effect.Effect<GitHubTokenAnswerView>;
  /** The member's GitHub token saved, carried once; the token as it then stands, or why nothing was kept. */
  githubTokenSave(params: GitHubTokenSaveParams): Effect.Effect<GitHubTokenAnswerView>;
  /** The member's GitHub token removed; none then stands. */
  githubTokenRemove(): Effect.Effect<GitHubTokenAnswerView>;
  /** The account's plan template and whether it wrote it; or why there is none. */
  /** The memories Luke's agents kept in a workspace; or why there are none. */
  memoriesRead(params: MemoriesReadParams): Effect.Effect<MemoriesAnswerView>;
  /** One memory forgotten for good; the workspace's memories as they then stand, or why they are unchanged. */
  memoryForget(params: MemoryForgetParams): Effect.Effect<MemoriesAnswerView>;
  planTemplateRead(): Effect.Effect<PlanTemplateAnswerView>;
  /** The template kept verbatim, or the default again for null; the template as kept, or why it is unchanged. */
  planTemplateWrite(params: PlanTemplateWriteParams): Effect.Effect<PlanTemplateAnswerView>;
  /** A page of the template's history, newest first; or why there is none. */
  planTemplateRevisions(
    params: PlanTemplateRevisionsParams,
  ): Effect.Effect<PlanTemplateRevisionsAnswerView>;
  /** One revision of the template beside the one before it; or why there is none. */
  planTemplateRevision(
    params: PlanTemplateRevisionParams,
  ): Effect.Effect<PlanTemplateRevisionAnswerView>;
  /** One revision of the template put back as the template; the template as kept, or why it is unchanged. */
  planTemplateRestore(params: PlanTemplateRevisionParams): Effect.Effect<PlanTemplateAnswerView>;
  /** One dictated clip, carried once; its words, or why there are none. */
  dictationTranscribe(
    params: DictationTranscribeParams,
  ): Effect.Effect<DictationTranscribeAnswerView>;
  /** One task's or agent's inbox, followed from now until let go or signed out, heard through `onInboxChanged`; following again starts over. */
  codingAgentInboxFollow(scope: CodingAgentInboxScope): Effect.Effect<void>;
  /** One task's or agent's inbox let go: nothing more is heard of it until it is followed again. */
  codingAgentInboxUnfollow(scope: CodingAgentInboxScope): Effect.Effect<void>;
  /** A followed inbox, its items whole or why there are none, each time it changes. */
  onInboxChanged(listener: (changed: CodingAgentInboxChanged) => void): () => void;
  /** One item of a task's inbox answered; the item as it then stands and whether the answer was taken, or why there is no answer. */
  codingAgentInboxAnswer(
    params: CodingAgentInboxAnswerParams,
  ): Effect.Effect<CodingAgentInboxAnsweredView>;
  /** One open item of a task's inbox closed without an answer; the item as it then stands and whether the close was taken, or why there is no answer. */
  codingAgentInboxClose(
    params: CodingAgentInboxCloseParams,
  ): Effect.Effect<CodingAgentInboxAnsweredView>;
  /** One message on an item's thread, open or settled; the item as it then stands, its thread with the message on it, or why there is no answer. */
  codingAgentInboxMessage(
    params: CodingAgentInboxMessageParams,
  ): Effect.Effect<CodingAgentInboxMessagedView>;
  /** A thread started with one agent, its subject and first message; the thread as it then stands, its message on it, or why there is no answer. */
  codingAgentInboxStart(
    params: CodingAgentInboxStartParams,
  ): Effect.Effect<CodingAgentInboxMessagedView>;
  /** One item marked read or unread for the account; its read state, or why there is no answer. */
  codingAgentInboxReadState(
    params: CodingAgentInboxReadStateParams,
  ): Effect.Effect<CodingAgentInboxReadStateView>;
  /** Every item of the account's Inbox marked read, in the one workspace named or in all; how many were unread, or why there is no answer. */
  codingAgentInboxReadAll(params: InboxReadAllRequest): Effect.Effect<CodingAgentInboxReadAllView>;
  /** What waits on the developer across the account, followed from now until let go or signed out, heard through `onAccountInboxChanged`; following again starts over. */
  codingAgentAccountInboxFollow(): Effect.Effect<void>;
  /** The account inbox let go: nothing more is heard of it until it is followed again. */
  codingAgentAccountInboxUnfollow(): Effect.Effect<void>;
  /** What waits across the followed account, or why there is none, each time it moves. */
  onAccountInboxChanged(listener: (answer: CodingAgentAccountInboxAnswerView) => void): () => void;
  /** One image of an inbox item, fetched under the account; its bytes in base64 under its media type, or why there is none. */
  /** One agent's, worker's, or planning worker's transcript, followed from now until let go or signed out, its pages heard through `onTranscriptChanged`; following again starts over. */
  transcriptFollow(transcript: CodingAgentTranscriptKey): Effect.Effect<void>;
  /** One followed transcript let go: nothing more is heard of it until it is followed again. */
  transcriptUnfollow(transcript: CodingAgentTranscriptKey): Effect.Effect<void>;
  /** The page of a transcript below the oldest message the window holds, read at once; or why there is none. */
  transcriptOlder(
    params: CodingAgentTranscriptOlderParams,
  ): Effect.Effect<CodingAgentTranscriptOlderAnswer>;
  /** A followed transcript's next page, or why there is none, each time it moves. */
  onTranscriptChanged(listener: (changed: CodingAgentTranscriptChanged) => void): () => void;
  codingAgentInboxAttachment(
    params: CodingAgentInboxAttachmentParams,
  ): Effect.Effect<CodingAgentInboxAttachmentView>;
  /** One picture a tool answered an agent or one of its workers, read under the account: its bytes in base64 under its type, or why there is none. */
  codingAgentPicture(
    params: CodingAgentPictureParams,
  ): Effect.Effect<CodingAgentInboxAttachmentView>;
  /** One part of a message of an agent's transcript or one of its workers', read whole under the account: what the page carried cut, or why there is none. */
  codingAgentPart(params: CodingAgentPartParams): Effect.Effect<CodingAgentPartView>;
  /** A workspace's chat, followed from now until let go or signed out, heard through `onChatChanged`; following again starts over. */
  codingAgentChatFollow(workspaceId: string): Effect.Effect<void>;
  /** A workspace's chat let go: nothing more is heard of it until it is followed again. */
  codingAgentChatUnfollow(workspaceId: string): Effect.Effect<void>;
  /** A followed workspace's chat, whole or why there is none, each time it changes. */
  onChatChanged(listener: (changed: CodingAgentChatChanged) => void): () => void;
  /** A write to a workspace's chat as the account's own member; what it came to, or why there is no answer. */
  codingAgentChatPost(
    params: CodingAgentChatPostParams,
  ): Effect.Effect<CodingAgentChatWriteAnswerView>;
  /** One picture a chat message carries, read under the account: its bytes in base64 under its type, or why there is none. */
  codingAgentChatAttachment(
    params: CodingAgentChatAttachmentParams,
  ): Effect.Effect<CodingAgentInboxAttachmentView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onAccountAccessChanged(listener: (access: AppAccessSlice) => void): () => void;
  onVoiceLiveSessionChanged(listener: (change: VoiceLiveSessionChanged) => void): () => void;
  onSessionReplayChanged(listener: (replay: HostSessionReplay) => void): () => void;
  onTasksChanged(listener: (view: TasksView) => void): () => void;
  /** The commands agents asked to run on this Mac that wait on the developer, whole, each time one is asked or answered. */
  onMacCommandAsksChanged(listener: (asks: readonly MacCommandAsk[]) => void): () => void;
  /** An agent's shells and where its sandbox stands, or why not; none where the host could not answer. */
  terminalList(params: { agentId: string }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalCreate(params: {
    agentId: string;
    title?: string | undefined;
  }): Effect.Effect<TerminalCreatedActAnswer | undefined>;
  terminalRename(params: {
    agentId: string;
    terminalId: string;
    title: string;
  }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalKill(params: {
    agentId: string;
    terminalId: string;
  }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalResume(params: { agentId: string }): Effect.Effect<TerminalResumedActAnswer | undefined>;
  /** One shell attached under the connection id given; whether the host took the attach. */
  terminalConnect(params: {
    connectionId: string;
    agentId: string;
    terminalId: string;
    cols: number;
    rows: number;
  }): Effect.Effect<boolean>;
  terminalInput(params: { connectionId: string; data: string }): Effect.Effect<void>;
  terminalResize(params: { connectionId: string; cols: number; rows: number }): Effect.Effect<void>;
  terminalAck(params: { connectionId: string; bytes: number }): Effect.Effect<void>;
  terminalDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  /** Every waiting connection opened again now, as after the Mac woke. */
  terminalWake(): Effect.Effect<void>;
  /** What an attached shell printed, by its connection. */
  onTerminalOutput(
    listener: (output: { connectionId: string; data: Uint8Array }) => void,
  ): () => void;
  /** How an attached shell's connection stands, by its connection. */
  onTerminalState(listener: (state: TerminalStateEvent) => void): () => void;
  /** One cloud Browser tab's live view opened under the connection id given; whether the host took it. */
  browserLiveConnect(params: {
    connectionId: string;
    taskId: string;
    tabId: string;
  }): Effect.Effect<boolean>;
  /** One text frame for the service on a live view's connection. */
  browserLiveSend(params: { connectionId: string; text: string }): Effect.Effect<void>;
  /** A live view's connection let go, its socket closed. */
  browserLiveDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  /** One text frame the service sent on a live view, by its connection. */
  onBrowserLiveMessage(listener: (message: BrowserLiveMessageEvent) => void): () => void;
  /** A live view's socket closed, with its code, by its connection. */
  onBrowserLiveClosed(listener: (closed: BrowserLiveClosedEvent) => void): () => void;
}

/** The host's answer to a terminal call, read by its schema; none where the host refused it or the shape is not read. */
function terminalAnswer<Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) {
  return (answer: GatewayCallResult): Answer | undefined =>
    answer.ok
      ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
      : undefined;
}

interface HostOperatorOptions {
  client: GatewayClient;
  report: (message: string) => void;
}

/** A Pull request tab's read as the gateway carries it: the agent, and the pull request's number where the tab names one other than the agent's own. */
function pullRequestRead(
  params: CodingAgentPullRequestReadParams,
): CodingAgentPullRequestReadParams {
  return params.number === undefined
    ? { agentId: params.agentId }
    : { agentId: params.agentId, number: params.number };
}

/** A read or a Generate of a pull request's chapters as the gateway carries it: the agent, and the number where the tab names one. */
function pullRequestChaptersRead(params: PullRequestChaptersParams): PullRequestChaptersParams {
  return params.number === undefined
    ? { agentId: params.agentId }
    : { agentId: params.agentId, number: params.number };
}

/**
 * The host refused a call, or answered a shape its method does not document:
 * a defect of this build, worded by the router as the kind's refusal. Note
 * that only the shape is reported to Sentry, because a refusal is the host's
 * own answer, and a handler that died behind one was reported where it died
 * (`gatewayHost`).
 */
function unanswered(method: GatewayMethod, answer: GatewayCallResult): Effect.Effect<never> {
  if (answer.ok) return Effect.die(new Error(`${method} answered a shape this client cannot read`));
  const refusal = new Error(`${method} was refused: ${answer.error.message}`);
  return Effect.die(Object.assign(refusal, { [ErrorReporter.ignore]: true }));
}

/**
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the act, whose own answer guard is checked in the router and
 * again in the window that asked.
 */
/** A workspace method's answer as its schema reads it; unanswered where the host refused or the shape is not read. */
function workspaceAnswer<Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) {
  return (answer: GatewayCallResult): Answer | typeof WORKSPACE_UNANSWERED =>
    (answer.ok
      ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
      : undefined) ?? WORKSPACE_UNANSWERED;
}

const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** A GitHub page's answer as its schema reads it; unanswered where the host refused or the shape is not read. */
function githubPage(answer: GatewayCallResult): TasksGitHubPageAnswer {
  return (
    (answer.ok
      ? Result.getOrUndefined(
          readEither(tasksGitHubPageAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
        )
      : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED }
  );
}

function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is Luke's own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is restored at this one boundary.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** What a coding-agent call the host could not answer is drawn as. */
/** A followed transcript as the gateway's params carry it. */
function transcriptParams(transcript: CodingAgentTranscriptKey): WireRecord {
  const { kind, agentId, callId } = transcript;
  return callId === undefined ? { kind, agentId } : { kind, agentId, callId };
}

const CODING_AGENT_UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** An automation call that reached no answer, as every automation method answers one. */
const AUTOMATION_UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** A call on a task's linked issues that reached no answer. */
const TASK_ISSUES_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** What an integration call the host could not answer is drawn as. */
const INTEGRATION_UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

/** An installed skills call that reached no answer, as every installed skills method answers one. */
const INSTALLED_SKILL_UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const settingsResult = (
    method: GatewayMethod,
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<SettingsUpdateResult> =>
    Effect.flatMap(result, (answer) => {
      const parsed = answered<SettingsUpdateResult>(record(answer));
      return parsed?.settings !== undefined ? Effect.succeed(parsed) : unanswered(method, answer);
    });

  const accountResult = (
    method: GatewayMethod,
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<AccountSnapshot> =>
    Effect.flatMap(result, (answer) => {
      const account = answered<AccountSnapshot>(record(answer)?.account);
      return account ? Effect.succeed(account) : unanswered(method, answer);
    });

  const fire = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<void> =>
    Effect.asVoid(result);

  const on = gatewayEventReader(client);

  const wireReporter = (reporter: string) => ({ reporter });

  /**
   * A setting's value as the method's own field, or no field for a cleared
   * one. The envelope is JSON, and its encoder refuses a record holding
   * `undefined` rather than dropping the key, so a clear carried as a value
   * would never leave this process.
   */
  const wireValue = <Value>(value: Value | undefined) =>
    value !== undefined ? { value: carried(value) } : undefined;

  /**
   * A coding-agent answer as the host's method documents it, or unanswered
   * where the host refused the call or answered a shape the view cannot
   * read: the window draws why and offers to try again either way.
   */
  const codingAgentAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof CODING_AGENT_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? CODING_AGENT_UNANSWERED;

  /** An automation answer as the host's method documents it, or unanswered, on the same terms as a coding-agent answer. */
  const automationAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof AUTOMATION_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? AUTOMATION_UNANSWERED;

  /** An installed skills answer as the host's method documents it, or unanswered, on the same terms as a coding-agent answer. */
  const installedSkillAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof INSTALLED_SKILL_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? INSTALLED_SKILL_UNANSWERED;

  /** The account an integration ask is about, as the gateway carries it: the provider, and the account and an add where the window named them. */
  const integrationTarget = (params: IntegrationProviderParams) => ({
    provider: params.provider,
    ...(params.connection !== undefined ? { connection: params.connection } : undefined),
    ...(params.add !== undefined ? { add: params.add } : undefined),
  });

  /** An answer on a task's linked issues as the host's method documents it, or unanswered, on the same terms as a coding-agent answer. */
  const taskIssueAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof TASK_ISSUES_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? TASK_ISSUES_UNANSWERED;

  /** An integration answer as the host's method documents it, or unanswered, on the same terms as a coding-agent answer. */
  const integrationAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof INTEGRATION_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? INTEGRATION_UNANSWERED;

  return {
    integrationsStatus: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_STATUS),
        integrationAnswer(integrationStatusesViewSchema),
      ),
    integrationsConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, integrationTarget(params)),
        integrationAnswer(integrationConnectViewSchema),
      ),
    integrationsTools: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_TOOLS, integrationTarget(params)),
        integrationAnswer(integrationToolsViewSchema),
      ),
    integrationsCancel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_CANCEL, integrationTarget(params)),
        integrationAnswer(integrationStatusViewSchema),
      ),
    integrationsDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_DISCONNECT, integrationTarget(params)),
        integrationAnswer(integrationStatusViewSchema),
      ),
    integrationsRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_RENAME, {
          provider: params.provider,
          connection: params.connection,
          label: params.label,
        }),
        integrationAnswer(integrationAccountViewSchema),
      ),
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        Option.fromUndefinedOr(answered<HostBootstrap>(record(answer))),
      ),
    macRepositories: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.MAC_REPOSITORIES_READ),
        terminalAnswer(macRepositoriesAnswerSchema),
      ),
    setMacRepository: (entry) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MAC_REPOSITORY_SET, {
          repository: entry.repository,
          command: entry.command,
        }),
        terminalAnswer(macRepositoriesAnswerSchema),
      ),
    answerMacCommand: (answer) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MAC_COMMAND_ANSWER, {
          id: answer.id,
          decision: answer.decision,
        }),
        (result) => record(result)?.answered === true,
      ),
    settingsSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AppSettings>(record(answer)?.settings)),
      ),
    updateSetting: (field, value, reporter) =>
      settingsResult(
        GATEWAY_METHOD.SETTINGS_UPDATE,
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE, {
          field,
          ...wireValue(value),
          ...wireReporter(reporter),
        }),
      ),
    resetSettings: (scope, kept, reporter) =>
      settingsResult(
        GATEWAY_METHOD.SETTINGS_RESET,
        client.call(GATEWAY_METHOD.SETTINGS_RESET, {
          scope,
          kept: [...kept],
          ...wireReporter(reporter),
        }),
      ),
    setExperiment: (experiment, on, reporter) =>
      settingsResult(
        GATEWAY_METHOD.EXPERIMENTS_SET,
        client.call(GATEWAY_METHOD.EXPERIMENTS_SET, {
          experiment,
          on,
          ...wireReporter(reporter),
        }),
      ),
    accountSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AccountSnapshot>(record(answer)?.account)),
      ),
    beginSignIn: (provider) =>
      accountResult(
        GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN,
        client.call(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, { provider }),
      ),
    signInAgain: (provider) =>
      Effect.flatMap(client.call(GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN, { provider }), (answer) => {
        const signedIn = record(answer)?.signedIn;
        return isWireBoolean(signedIn)
          ? Effect.succeed(signedIn)
          : unanswered(GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN, answer);
      }),
    cancelSignIn: () => fire(client.call(GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN)),
    signOut: () =>
      accountResult(GATEWAY_METHOD.ACCOUNT_SIGN_OUT, client.call(GATEWAY_METHOD.ACCOUNT_SIGN_OUT)),
    deleteAccount: () =>
      accountResult(GATEWAY_METHOD.ACCOUNT_DELETE, client.call(GATEWAY_METHOD.ACCOUNT_DELETE)),
    liveDiagnostics: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS), (answer) =>
        Option.fromUndefinedOr(answered<LiveDiagnostics>(record(answer)?.diagnostics)),
      ),
    createLiveSession: (sdp, { taskId, agentId }) =>
      Effect.map(
        client.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
          sdp,
          agentId,
          ...(taskId === undefined ? undefined : { taskId }),
        }),
        (answer) =>
          answer.ok
            ? Result.getSuccess(
                readEither(voiceCreateLiveSessionResultSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : Option.none(),
      ),
    endLiveSession: (request) => fire(client.call(GATEWAY_METHOD.VOICE_END_LIVE_SESSION, request)),
    reportLiveTransport: (report) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT, report)),
    reportLiveActivity: (idle) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY, { idle })),
    stopSpeaking: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_STOP_SPEAKING), (answer) =>
        answer.ok
          ? (Result.getOrUndefined(
              readEither(voiceStopSpeakingResultSchema, { excess: EXCESS_KEYS.DROP })(
                answer.result,
              ),
            )?.stopped ?? false)
          : false,
      ),
    setVideo: (on) =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on }), (answer) =>
        answer.ok
          ? (Result.getOrUndefined(
              readEither(voiceSetVideoResultSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
            )?.requested ?? false)
          : false,
      ),
    recordAgentTrace: (trace) =>
      fire(client.call(GATEWAY_METHOD.VOICE_RECORD_TRACE, { trace: carried(trace) })),
    recordEvent: (name, properties) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        fire(
          client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
            // The host reads the event against the allowlist again before it is queued.
            event: { name, at, properties: carried(properties) },
          }),
        ),
      ),
    tasksRefresh: () => fire(client.call(GATEWAY_METHOD.TASKS_REFRESH)),
    workspacesRefresh: () => fire(client.call(GATEWAY_METHOD.WORKSPACES_REFRESH)),
    tasksOpen: (taskId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_OPEN, { taskId }),
        (answer) => record(answer)?.opened === true,
      ),
    tasksClose: () => fire(client.call(GATEWAY_METHOD.TASKS_CLOSE)),
    tasksDelete: (taskId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_DELETE, { taskId }),
        (answer) => record(answer)?.deleted === true,
      ),
    tasksRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_RENAME, { taskId: params.taskId, name: params.name }),
        (answer) => record(answer)?.renamed === true,
      ),
    tasksSetStanding: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_SET_STANDING, { ...params }),
        (answer) => record(answer)?.changed === true,
      ),
    tasksPin: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PIN, {
          taskId: params.taskId,
          pinned: params.pinned,
          ...(params.position === undefined ? undefined : { position: params.position }),
        }),
        (answer) => record(answer)?.changed === true,
      ),
    tasksPinRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, {
          repository: params.repository,
          pinned: params.pinned,
        }),
        (answer) => record(answer)?.changed === true,
      ),
    tasksWriteSection: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_WRITE_SECTION, params),
        (answer) => record(answer)?.changed === true,
      ),
    tasksRepositories: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.TASKS_REPOSITORIES,
          params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId },
        ),
        (answer): TasksRepositoriesAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksRepositoriesAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksFile: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_FILE, {
          taskId: params.taskId,
          path: params.path,
          firstLine: params.firstLine,
          lastLine: params.lastLine,
          ...(params.raw === undefined ? undefined : { raw: params.raw }),
          ...(params.ref === undefined ? undefined : { ref: params.ref }),
        }),
        (answer): TasksFileAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksFileAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksTree: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_TREE, {
          ...("planId" in params
            ? { planId: params.planId }
            : { workspaceId: params.workspaceId, repository: params.repository }),
          path: params.path,
          ...(params.recursive === undefined ? undefined : { recursive: params.recursive }),
        }),
        (answer): TasksTreeAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksTreeAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksSkills: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.TASKS_SKILLS,
          "planId" in params
            ? { planId: params.planId }
            : {
                workspaceId: params.workspaceId,
                ...(params.repository === undefined
                  ? undefined
                  : { repository: params.repository }),
              },
        ),
        (answer): TasksSkillsAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksSkillsAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          number: params.number,
        }),
        (answer): TasksPullRequestAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksPullRequestAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksIssue: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          number: params.number,
        }),
        (answer): TasksIssueAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksIssueAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksGitHubIssues: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_GITHUB_ISSUES, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          ...("query" in params ? { query: params.query } : undefined),
          ...("number" in params ? { number: params.number } : undefined),
        }),
        (answer): TasksGitHubIssuesAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksGitHubIssuesAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksIssueLinks: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE_LINKS, { taskId: params.taskId }),
        taskIssueAnswer(tasksIssueLinksAnswerSchema),
      ),
    tasksBrowserTabs: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS, { taskId: params.taskId }),
        taskIssueAnswer(tasksBrowserTabsAnswerSchema),
      ),
    tasksBrowserTabOpen: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BROWSER_TAB_OPEN, {
          taskId: params.taskId,
          agentId: params.agentId,
          address: params.address,
        }),
        taskIssueAnswer(tasksBrowserTabOpenAnswerSchema),
      ),
    tasksIssueLink: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE_LINK, {
          taskId: params.taskId,
          issue: params.issue,
        }),
        taskIssueAnswer(tasksIssueLinkAnswerSchema),
      ),
    tasksIssueRelate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE_RELATE, {
          taskId: params.taskId,
          linkId: params.linkId,
          relation: params.relation,
        }),
        taskIssueAnswer(tasksIssueRelateAnswerSchema),
      ),
    tasksIssueUnlink: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE_UNLINK, {
          taskId: params.taskId,
          linkId: params.linkId,
        }),
        taskIssueAnswer(tasksIssueUnlinkAnswerSchema),
      ),
    tasksRevisions: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_REVISIONS, {
          taskId: params.taskId,
          ...(params.before === undefined ? undefined : { before: params.before }),
        }),
        (answer): TasksRevisionsAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksRevisionsAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksRevision: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_REVISION, { taskId: params.taskId, seq: params.seq }),
        (answer): TasksRevisionAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksRevisionAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksComments: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENTS, {
          planId: params.planId,
          after: params.after,
        }),
        (answer): TasksCommentsAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksCommentsAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksCommentStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENT_START, {
          planId: params.planId,
          start: params.start,
        }),
        (answer): TasksCommentAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksCommentAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksCommentAct: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENT_ACT, {
          planId: params.planId,
          threadId: params.threadId,
          action: params.action,
        }),
        (answer): TasksCommentAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksCommentAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksPictureKeep: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PICTURE_KEEP, {
          planId: params.planId,
          picture: params.picture,
        }),
        (answer): TasksPictureKeepAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksPictureKeepAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksPicture: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PICTURE, {
          planId: params.planId,
          attachmentId: params.attachmentId,
        }),
        (answer): TasksPictureAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksPictureAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PAGE, {
          ...("taskId" in params ? { taskId: params.taskId } : { agentId: params.agentId }),
          pageId: params.pageId,
          version: params.version,
        }),
        (answer): TasksPageAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksPageAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksPagesFollow: (scope) => fire(client.call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, scope)),
    tasksPagesUnfollow: (scope) => fire(client.call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, scope)),
    onTaskPagesChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_PAGES_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(taskPagesFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    tasksBrowserTabsFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW, scope)),
    tasksBrowserTabsUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW, scope)),
    onTaskBrowserTabsChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_BROWSER_TABS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(taskBrowserTabsFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    tasksHistoryFollow: (scope) => fire(client.call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, scope)),
    tasksHistoryUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW, scope)),
    onTaskHistoryChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_HISTORY_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(taskHistoryFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    tasksPages: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.TASKS_PAGES,
          "taskId" in params ? { taskId: params.taskId } : { agentId: params.agentId },
        ),
        (answer): TasksPagesAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksPagesAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksRestore: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_RESTORE, { taskId: params.taskId, seq: params.seq }),
        (answer) => record(answer)?.restored === true,
      ),
    githubConnect: () => Effect.map(client.call(GATEWAY_METHOD.GITHUB_CONNECT), githubPage),
    githubDisconnect: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_DISCONNECT),
        (answer): TasksGitHubDisconnectAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksGitHubDisconnectAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: GITHUB_DISCONNECT_FAILURE.UNANSWERED },
      ),
    adminRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.ADMIN_READ, {
          procedure: params.procedure,
          query: params.query,
        }),
        (answer): AdminReadAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(adminReadAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { refused: ADMIN_UNANSWERED },
      ),
    adminFavorite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.ADMIN_FAVORITE, { id: params.id, favorite: params.favorite }),
        (answer) => answer.ok && answer.result === true,
      ),
    workspaceCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: params.name }),
        workspaceAnswer(tasksWorkspaceAnswerSchema),
      ),
    workspaceRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_RENAME, {
          workspaceId: params.workspaceId,
          name: params.name,
        }),
        workspaceAnswer(tasksWorkspaceAnswerSchema),
      ),
    workspacePhotoSet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
          workspaceId: params.workspaceId,
          photo: params.photo,
        }),
        workspaceAnswer(tasksWorkspaceAnswerSchema),
      ),
    workspaceGitHubConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceGitHubConnectAnswerSchema),
      ),
    workspaceGitHubDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, {
          workspaceId: params.workspaceId,
        }),
        workspaceAnswer(tasksWorkspaceAnswerSchema),
      ),
    workspaceLinearConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_LINEAR_CONNECT, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceGitHubConnectAnswerSchema),
      ),
    workspaceLinearDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_LINEAR_DISCONNECT, {
          workspaceId: params.workspaceId,
        }),
        workspaceAnswer(tasksWorkspaceAnswerSchema),
      ),
    workspaceLinearIssues: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_LINEAR_ISSUES, {
          workspaceId: params.workspaceId,
          ...("query" in params ? { query: params.query } : undefined),
          ...("identifier" in params ? { identifier: params.identifier } : undefined),
        }),
        workspaceAnswer(tasksLinearIssuesAnswerSchema),
      ),
    workspaceSentry: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceSentryAnswerSchema),
      ),
    workspaceSentryInstall: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY_INSTALL, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceGitHubConnectAnswerSchema),
      ),
    workspaceSentryDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY_DISCONNECT, {
          workspaceId: params.workspaceId,
          installationId: params.installationId,
        }),
        workspaceAnswer(tasksWorkspaceSentryAnswerSchema),
      ),
    workspaceMembers: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceMembersAnswerSchema),
      ),
    workspacePeopleFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW, scope)),
    workspacePeopleUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.WORKSPACES_PEOPLE_UNFOLLOW, scope)),
    onWorkspacePeopleChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_PEOPLE_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(workspacePeopleFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    workspaceInvitationsFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, scope)),
    workspaceInvitationsUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW, scope)),
    onWorkspaceInvitationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(workspaceInvitationsFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    workspacePhoto: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_PHOTO, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspacePhotoAnswerSchema),
      ),
    workspaceTokenRepositories: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES, {
          workspaceId: params.workspaceId,
        }),
        workspaceAnswer(tasksWorkspaceTokenRepositoriesAnswerSchema),
      ),
    workspaceTokenRepositorySet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          added: params.added,
        }),
        workspaceAnswer(tasksWorkspaceTokenRepositoriesAnswerSchema),
      ),
    workspaceMemberRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
          workspaceId: params.workspaceId,
          userId: params.userId,
        }),
        workspaceAnswer(tasksWorkspaceMembersAnswerSchema),
      ),
    workspaceMemberRole: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
          workspaceId: params.workspaceId,
          userId: params.userId,
          role: params.role,
        }),
        workspaceAnswer(tasksWorkspaceMembersAnswerSchema),
      ),
    workspaceTransfer: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TRANSFER, {
          workspaceId: params.workspaceId,
          userId: params.userId,
        }),
        workspaceAnswer(tasksWorkspaceMembersAnswerSchema),
      ),
    workspaceLeave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceLeaveAnswerSchema),
      ),
    workspaceInvitations: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceInvitationsAnswerSchema),
      ),
    workspaceInvite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITE, {
          workspaceId: params.workspaceId,
          email: params.email,
          role: params.role,
        }),
        workspaceAnswer(tasksWorkspaceInvitationAnswerSchema),
      ),
    workspaceInvitationCancel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL, {
          workspaceId: params.workspaceId,
          invitationId: params.invitationId,
        }),
        workspaceAnswer(tasksWorkspaceInvitationsAnswerSchema),
      ),
    tasksSetRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_SET_REPOSITORY, {
          taskId: params.taskId,
          repository: params.repository,
        }),
        (answer): TasksSetRepositoryAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksSetRepositoryAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksMove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_MOVE, {
          taskId: params.taskId,
          workspaceId: params.workspaceId,
        }),
        (answer): TasksMoveAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksMoveAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksEdit: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_EDIT, { taskId: params.taskId, edit: params.edit }),
        (answer): TasksEditAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksEditAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksStart: (request) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_START, {
          ...("name" in request ? { name: request.name } : undefined),
          ...("repository" in request ? { repository: request.repository } : undefined),
          ...("workspaceId" in request ? { workspaceId: request.workspaceId } : undefined),
          ...("linearIssueId" in request ? { linearIssueId: request.linearIssueId } : undefined),
          ...("issues" in request ? { issues: request.issues } : undefined),
          ...("planning" in request ? { planning: request.planning } : undefined),
          ...("agent" in request ? { agent: request.agent } : undefined),
          ...("brief" in request ? { brief: request.brief } : undefined),
          ...("status" in request ? { status: request.status } : undefined),
          ...("priority" in request ? { priority: request.priority } : undefined),
        }),
        (answer): TasksStartAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(tasksStartAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
      ),
    tasksBoardSave: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TASKS_BOARD_SAVE, {
          taskId: params.taskId,
          elements: params.elements,
          appliedDrawing: params.appliedDrawing,
          ...(params.image === undefined ? undefined : { image: params.image }),
        }),
      ),
    codingAgentModels: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MODELS),
        codingAgentAnswer(codingAgentModelsAnswerSchema),
      ),
    codingAgentDefaultRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_READ),
        codingAgentAnswer(codingAgentDefaultAnswerViewSchema),
      ),
    codingAgentDefaultWrite: (choice) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE, {
          model: choice.model,
          effort: choice.effort,
          ...(choice.contextWindow === undefined
            ? undefined
            : { contextWindow: choice.contextWindow }),
        }),
        codingAgentAnswer(codingAgentDefaultAnswerViewSchema),
      ),
    codingAgentWorkspaceList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_WORKSPACE_LIST, params),
        codingAgentAnswer(codingAgentListAnswerViewSchema),
      ),
    codingAgentList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_LIST, {
          taskId: params.taskId,
          ...(params.includeArchived === undefined
            ? undefined
            : { includeArchived: params.includeArchived }),
        }),
        codingAgentAnswer(codingAgentListAnswerViewSchema),
      ),
    codingAgentStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_START, {
          ...(params.taskId === undefined ? undefined : { taskId: params.taskId }),
          idempotencyKey: params.idempotencyKey,
          ...("model" in params ? { model: params.model } : undefined),
          ...("effort" in params ? { effort: params.effort } : undefined),
          ...("contextWindow" in params ? { contextWindow: params.contextWindow } : undefined),
          ...("prompt" in params ? { prompt: params.prompt } : undefined),
          ...("attachments" in params ? { attachments: params.attachments } : undefined),
          ...("disabledServers" in params
            ? { disabledServers: params.disabledServers }
            : undefined),
          ...("from" in params ? { from: params.from } : undefined),
          ...("note" in params ? { note: params.note } : undefined),
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentMessages: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
          agentId: params.agentId,
          after: params.after,
          ...("callId" in params ? { callId: params.callId } : undefined),
        }),
        codingAgentAnswer(codingAgentMessagesAnswerViewSchema),
      ),
    codingAgentMessage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: params.agentId,
          text: params.text,
          clientKey: params.clientKey,
          ...("attachments" in params ? { attachments: params.attachments } : undefined),
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentChoose: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHOOSE, {
          agentId: params.agentId,
          model: params.model,
          effort: params.effort,
          ...("contextWindow" in params ? { contextWindow: params.contextWindow } : undefined),
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_RENAME, {
          agentId: params.agentId,
          title: params.title,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentServers: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_SERVERS, {
          agentId: params.agentId,
          disabledServers: params.disabledServers,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentStop: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_STOP, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentRewind: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_REWIND, {
          agentId: params.agentId,
          messageId: params.messageId,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentArchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_ARCHIVE, {
          agentId: params.agentId,
          archived: params.archived,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentDelete: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_DELETE, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentDeleteAnswerViewSchema),
      ),
    codingAgentPin: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PIN, {
          agentId: params.agentId,
          pinned: params.pinned,
          ...(params.position === undefined ? undefined : { position: params.position }),
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentEnsureOperator: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_ENSURE_OPERATOR, {
          workspaceId: params.workspaceId,
          ...(params.reset === undefined ? undefined : { reset: params.reset }),
        }),
        codingAgentAnswer(codingAgentOperatorEnsureAnswerViewSchema),
      ),
    codingAgentPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PAGE, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentPageAnswerViewSchema),
      ),
    codingAgentCalls: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CALLS, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentCallsAnswerViewSchema),
      ),
    automationList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_LIST, params),
        automationAnswer(automationListViewSchema),
      ),
    automationCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_CREATE, params),
        automationAnswer(automationViewSchema),
      ),
    automationChange: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_CHANGE, params),
        automationAnswer(automationViewSchema),
      ),
    automationDelete: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_DELETE, params),
        automationAnswer(automationDeletedViewSchema),
      ),
    automationRun: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_RUN, params),
        automationAnswer(automationRunViewSchema),
      ),
    automationRuns: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_RUNS, params),
        automationAnswer(automationRunsViewSchema),
      ),
    automationNewWebhookSecret: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, params),
        automationAnswer(automationViewSchema),
      ),
    automationsFollow: (scope) => fire(client.call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, scope)),
    automationsUnfollow: (scope) => fire(client.call(GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW, scope)),
    onAutomationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.AUTOMATIONS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(automationFollowedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    codingAgentPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST, pullRequestRead(params)),
        codingAgentAnswer(codingAgentPullRequestAnswerViewSchema),
      ),
    pullRequestChapters: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHAPTERS, pullRequestChaptersRead(params)),
        codingAgentAnswer(pullRequestChaptersAnswerViewSchema),
      ),
    pullRequestChaptersGenerate: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.CODING_AGENTS_CHAPTERS_GENERATE,
          pullRequestChaptersRead(params),
        ),
        codingAgentAnswer(pullRequestChaptersAnswerViewSchema),
      ),
    chaptersModelRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHAPTERS_MODEL_READ),
        codingAgentAnswer(chaptersModelAnswerViewSchema),
      ),
    chaptersModelWrite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHAPTERS_MODEL_WRITE, { model: params.model }),
        codingAgentAnswer(chaptersModelAnswerViewSchema),
      ),
    installedSkillsList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_LIST, params),
        installedSkillAnswer(installedSkillListViewSchema),
      ),
    installedSkillsRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_READ, params),
        installedSkillAnswer(installedSkillContentViewSchema),
      ),
    installedSkillsPreview: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW, params),
        installedSkillAnswer(installedSkillPreviewViewSchema),
      ),
    installedSkillsPreviewFile: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW_FILE, params),
        installedSkillAnswer(installedSkillPreviewFileViewSchema),
      ),
    installedSkillsInstall: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, params),
        installedSkillAnswer(installedSkillInstallViewSchema),
      ),
    installedSkillsSetEnabled: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, params),
        installedSkillAnswer(installedSkillViewSchema),
      ),
    installedSkillsCheckUpdate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_CHECK_UPDATE, params),
        installedSkillAnswer(installedSkillUpdateCheckViewSchema),
      ),
    installedSkillsUpdate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE, params),
        installedSkillAnswer(installedSkillUpdatedViewSchema),
      ),
    installedSkillsShare: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_SHARE, params),
        installedSkillAnswer(installedSkillViewSchema),
      ),
    installedSkillsRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE, params),
        installedSkillAnswer(installedSkillRemovedViewSchema),
      ),
    codingAgentChanges: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHANGES, pullRequestRead(params)),
        codingAgentAnswer(codingAgentChangesAnswerViewSchema),
      ),
    codingAgentGitHubImage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE, params),
        codingAgentAnswer(codingAgentGitHubImageViewSchema),
      ),
    codingAgentPullRequestAction: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_ACTION, {
          ...pullRequestRead(params),
          request: params.request,
        }),
        codingAgentAnswer(codingAgentPullRequestWriteAnswerViewSchema),
      ),
    codingAgentPullRequestViewed: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_VIEWED, pullRequestRead(params)),
        codingAgentAnswer(codingAgentPullRequestViewedAnswerViewSchema),
      ),
    codingAgentOverviewPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_PULL_REQUEST, pullRequestRead(params)),
        codingAgentAnswer(codingAgentOverviewPullRequestAnswerViewSchema),
      ),
    codingAgentReviewOptions: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_REVIEW_OPTIONS, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentReviewOptionsAnswerViewSchema),
      ),
    codingAgentOverviewChecks: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CHECKS, pullRequestRead(params)),
        codingAgentAnswer(codingAgentOverviewChecksAnswerViewSchema),
      ),
    codingAgentOverviewConversation: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CONVERSATION, pullRequestRead(params)),
        codingAgentAnswer(codingAgentOverviewConversationAnswerViewSchema),
      ),
    providerKeysRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_READ),
        codingAgentAnswer(providerKeysAnswerViewSchema),
      ),
    providerKeySave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_SAVE, {
          provider: params.provider,
          ...(params.kind === undefined ? undefined : { kind: params.kind }),
          key: params.key,
        }),
        codingAgentAnswer(providerKeysAnswerViewSchema),
      ),
    providerKeyRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_REMOVE, {
          provider: params.provider,
          ...(params.kind === undefined ? undefined : { kind: params.kind }),
        }),
        codingAgentAnswer(providerKeysAnswerViewSchema),
      ),
    providerKeyForAgents: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_FOR_AGENTS, {
          provider: params.provider,
          kind: params.kind,
          forAgents: params.forAgents,
        }),
        codingAgentAnswer(providerKeysAnswerViewSchema),
      ),
    chatGptSignIn: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHATGPT_SIGN_IN),
        codingAgentAnswer(chatGptSignInAnswerViewSchema),
      ),
    chatGptSignInCancel: () => fire(client.call(GATEWAY_METHOD.CHATGPT_SIGN_IN_CANCEL)),
    githubTokenRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_READ),
        codingAgentAnswer(githubTokenAnswerViewSchema),
      ),
    githubTokenSave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_SAVE, { token: params.token }),
        codingAgentAnswer(githubTokenAnswerViewSchema),
      ),
    githubTokenRemove: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_REMOVE),
        codingAgentAnswer(githubTokenAnswerViewSchema),
      ),
    memoriesRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MEMORIES_READ, { workspaceId: params.workspaceId }),
        codingAgentAnswer(memoriesAnswerViewSchema),
      ),
    memoryForget: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MEMORIES_FORGET, {
          workspaceId: params.workspaceId,
          id: params.id,
        }),
        codingAgentAnswer(memoriesAnswerViewSchema),
      ),
    planTemplateRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLAN_TEMPLATE_READ),
        codingAgentAnswer(planTemplateAnswerViewSchema),
      ),
    planTemplateWrite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, { template: params.template }),
        codingAgentAnswer(planTemplateAnswerViewSchema),
      ),
    planTemplateRevisions: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS,
          params.before === undefined ? {} : { before: params.before },
        ),
        codingAgentAnswer(planTemplateRevisionsAnswerViewSchema),
      ),
    planTemplateRevision: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLAN_TEMPLATE_REVISION, { seq: params.seq }),
        codingAgentAnswer(planTemplateRevisionAnswerViewSchema),
      ),
    planTemplateRestore: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE, { seq: params.seq }),
        codingAgentAnswer(planTemplateAnswerViewSchema),
      ),
    dictationTranscribe: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.DICTATION_TRANSCRIBE, {
          audio: params.audio,
          durationMs: params.durationMs,
          keywords: [...params.keywords],
        }),
        codingAgentAnswer(dictationTranscribeAnswerViewSchema),
      ),
    codingAgentInboxFollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, { kind: scope.kind, id: scope.id }),
      ),
    codingAgentInboxUnfollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_UNFOLLOW, {
          kind: scope.kind,
          id: scope.id,
        }),
      ),
    onInboxChanged: (listener) =>
      on(
        GATEWAY_EVENT.INBOX_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(codingAgentInboxChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    codingAgentInboxAnswer: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, {
          itemId: params.itemId,
          revision: params.revision,
          reply: params.reply,
          ...("choices" in params ? { choices: params.choices } : undefined),
          ...("values" in params ? { values: params.values } : undefined),
          ...("note" in params ? { note: params.note } : undefined),
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
          clientKey: params.clientKey,
        }),
        codingAgentAnswer(codingAgentInboxAnsweredViewSchema),
      ),
    codingAgentInboxClose: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_CLOSE, {
          itemId: params.itemId,
          revision: params.revision,
          clientKey: params.clientKey,
        }),
        codingAgentAnswer(codingAgentInboxAnsweredViewSchema),
      ),
    codingAgentInboxMessage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE, {
          itemId: params.itemId,
          text: params.text,
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
          clientKey: params.clientKey,
          ...(params.answers === undefined ? undefined : { answers: params.answers }),
          ...(params.revision === undefined ? undefined : { revision: params.revision }),
        }),
        codingAgentAnswer(codingAgentInboxMessagedViewSchema),
      ),
    codingAgentInboxStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_START, {
          agentId: params.agentId,
          ...(params.title === undefined ? undefined : { title: params.title }),
          text: params.text,
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
          clientKey: params.clientKey,
        }),
        codingAgentAnswer(codingAgentInboxMessagedViewSchema),
      ),
    codingAgentInboxReadState: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE, {
          itemId: params.itemId,
          unread: params.unread,
        }),
        codingAgentAnswer(codingAgentInboxReadStateViewSchema),
      ),
    codingAgentInboxReadAll: (params) =>
      Effect.map(
        client.call(
          GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_ALL,
          params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId },
        ),
        codingAgentAnswer(codingAgentInboxReadAllViewSchema),
      ),
    codingAgentAccountInboxFollow: () =>
      fire(client.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW, {})),
    codingAgentAccountInboxUnfollow: () =>
      fire(client.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW, {})),
    onAccountInboxChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(codingAgentAccountInboxAnswerViewSchema, { excess: EXCESS_KEYS.DROP })(
              payload,
            ),
          ),
        listener,
      ),
    transcriptFollow: (transcript) =>
      fire(
        client.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, transcriptParams(transcript)),
      ),
    transcriptOlder: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_OLDER, {
          ...transcriptParams(params),
          before: params.before,
        }),
        codingAgentAnswer(codingAgentTranscriptOlderAnswerSchema),
      ),
    transcriptUnfollow: (transcript) =>
      fire(
        client.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, transcriptParams(transcript)),
      ),
    onTranscriptChanged: (listener) =>
      on(
        GATEWAY_EVENT.TRANSCRIPT_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(codingAgentTranscriptChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    codingAgentInboxAttachment: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_ATTACHMENT, {
          itemId: params.itemId,
          attachmentId: params.attachmentId,
        }),
        codingAgentAnswer(codingAgentInboxAttachmentViewSchema),
      ),
    codingAgentPicture: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PICTURE, params),
        codingAgentAnswer(codingAgentInboxAttachmentViewSchema),
      ),
    codingAgentPart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PART, params),
        codingAgentAnswer(codingAgentPartViewSchema),
      ),
    codingAgentChatFollow: (workspaceId) =>
      fire(client.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId })),
    codingAgentChatUnfollow: (workspaceId) =>
      fire(client.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_UNFOLLOW, { workspaceId })),
    onChatChanged: (listener) =>
      on(
        GATEWAY_EVENT.CHAT_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(codingAgentChatChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    codingAgentChatPost: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_POST, {
          workspaceId: params.workspaceId,
          write: params.write,
        }),
        codingAgentAnswer(codingAgentChatWriteAnswerViewSchema),
      ),
    codingAgentChatAttachment: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_ATTACHMENT, {
          workspaceId: params.workspaceId,
          messageId: params.messageId,
          attachmentId: params.attachmentId,
        }),
        codingAgentAnswer(codingAgentInboxAttachmentViewSchema),
      ),
    onSettingsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SETTINGS_CHANGED,
        (payload): HostSettingsChange | undefined => {
          if (!isRecord(payload) || !isRecord(payload.settings)) return undefined;
          const settings = answered<AppSettings>(payload.settings);
          if (!settings) return undefined;
          return {
            settings,
            ...(isWireString(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
    onAccountChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_CHANGED,
        (payload) => (isRecord(payload) ? answered<AccountSnapshot>(payload) : undefined),
        listener,
      ),
    onAccountAccessChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_ACCESS_CHANGED,
        (payload): AppAccessSlice | undefined =>
          isRecord(payload) && isWireBoolean(payload.admin)
            ? {
                admin: payload.admin,
                ...(payload.pending === true ? { pending: true } : undefined),
              }
            : undefined,
        listener,
      ),
    onVoiceLiveSessionChanged: (listener) =>
      on(
        GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(voiceLiveSessionChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    onTasksChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_CHANGED,
        // Note that the view is the host's own, handed over in this process
        // (`gatewayHost`), so it is passed on as built: a decode here would
        // only rebuild the same tree new, and every comparison after it walk it.
        (payload) => (isRecord(payload) ? answered<TasksView>(payload) : undefined),
        listener,
      ),
    onMacCommandAsksChanged: (listener) =>
      on(
        GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(macCommandAsksSchema, { excess: EXCESS_KEYS.DROP })(payload),
          )?.asks,
        listener,
      ),
    terminalList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: params.agentId }),
        terminalAnswer(terminalsActAnswerSchema),
      ),
    terminalCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_CREATE, {
          agentId: params.agentId,
          ...(params.title === undefined ? undefined : { title: params.title }),
        }),
        terminalAnswer(terminalCreatedActAnswerSchema),
      ),
    terminalRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RENAME, {
          agentId: params.agentId,
          terminalId: params.terminalId,
          title: params.title,
        }),
        terminalAnswer(terminalsActAnswerSchema),
      ),
    terminalKill: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_KILL, {
          agentId: params.agentId,
          terminalId: params.terminalId,
        }),
        terminalAnswer(terminalsActAnswerSchema),
      ),
    terminalResume: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RESUME, { agentId: params.agentId }),
        terminalAnswer(terminalResumedActAnswerSchema),
      ),
    terminalConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_CONNECT, {
          connectionId: params.connectionId,
          agentId: params.agentId,
          terminalId: params.terminalId,
          cols: params.cols,
          rows: params.rows,
        }),
        (answer) => answer.ok,
      ),
    terminalInput: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_INPUT, {
          connectionId: params.connectionId,
          data: params.data,
        }),
      ),
    terminalResize: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_RESIZE, {
          connectionId: params.connectionId,
          cols: params.cols,
          rows: params.rows,
        }),
      ),
    terminalAck: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_ACK, {
          connectionId: params.connectionId,
          bytes: params.bytes,
        }),
      ),
    terminalDisconnect: (params) =>
      fire(client.call(GATEWAY_METHOD.TERMINALS_DISCONNECT, { connectionId: params.connectionId })),
    terminalWake: () => fire(client.call(GATEWAY_METHOD.TERMINALS_WAKE)),
    onTerminalOutput: (listener) =>
      on(
        GATEWAY_EVENT.TERMINAL_OUTPUT,
        (payload) => {
          const output = Result.getOrUndefined(readEither(terminalOutputEventSchema)(payload));
          if (output === undefined) return undefined;
          const bytes = Base64.decode(output.data);
          return Result.isSuccess(bytes)
            ? { connectionId: output.connectionId, data: bytes.success }
            : undefined;
        },
        listener,
      ),
    onTerminalState: (listener) =>
      on(
        GATEWAY_EVENT.TERMINAL_STATE,
        (payload) => Result.getOrUndefined(readEither(terminalStateEventSchema)(payload)),
        listener,
      ),
    browserLiveConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_CONNECT, {
          connectionId: params.connectionId,
          taskId: params.taskId,
          tabId: params.tabId,
        }),
        (answer) => answer.ok,
      ),
    browserLiveSend: (params) =>
      fire(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_SEND, {
          connectionId: params.connectionId,
          text: params.text,
        }),
      ),
    browserLiveDisconnect: (params) =>
      fire(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT, { connectionId: params.connectionId }),
      ),
    onBrowserLiveMessage: (listener) =>
      on(
        GATEWAY_EVENT.BROWSER_LIVE_MESSAGE,
        (payload) => Result.getOrUndefined(readEither(browserLiveMessageEventSchema)(payload)),
        listener,
      ),
    onBrowserLiveClosed: (listener) =>
      on(
        GATEWAY_EVENT.BROWSER_LIVE_CLOSED,
        (payload) => Result.getOrUndefined(readEither(browserLiveClosedEventSchema)(payload)),
        listener,
      ),
    onSessionReplayChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSION_REPLAY_CHANGED,
        (payload): HostSessionReplay | undefined =>
          isRecord(payload) && isWireBoolean(payload.permitted)
            ? {
                permitted: payload.permitted,
                ...(isWireString(payload.accountId) ? { accountId: payload.accountId } : undefined),
              }
            : undefined,
        listener,
      ),
  };
}
