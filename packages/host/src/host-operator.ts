import type { AccountProvider, AccountSnapshot, SignInAnswer } from "@luke/credentials/snapshot";
import { WORKSPACE_CALL_FAILURE } from "@luke/features";
import {
  ADMIN_UNANSWERED,
  type AdminFavoriteParams,
  type AdminReadAnswer,
  type AdminReadParams,
  adminReadAnswerSchema,
} from "@luke/features/admin-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentAccountInboxAnswerView,
  type AgentAgentAnswer,
  type AgentArchiveParams,
  type AgentChangesAnswerView,
  type AgentChooseParams,
  type AgentDefaultAnswer,
  type AgentDeleteAnswerView,
  type AgentGitHubImageParams,
  type AgentGitHubImageView,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxAttachmentParams,
  type AgentInboxAttachmentView,
  type AgentInboxChanged,
  type AgentInboxCloseParams,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxReadAllParams,
  type AgentInboxReadAllView,
  type AgentInboxReadStateParams,
  type AgentInboxReadStateView,
  type AgentInboxScope,
  type AgentInboxStartParams,
  type AgentListAnswer,
  type AgentListParams,
  type AgentLukeToolsAnswerView,
  type AgentMessageParams,
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentModelsAnswer,
  type AgentOperatorEnsureAnswerView,
  type AgentOperatorEnsureParams,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPageAnswerView,
  type AgentPageParams,
  type AgentPartParams,
  type AgentPartView,
  type AgentPictureParams,
  type AgentPinParams,
  type AgentPullRequestActionParams,
  type AgentPullRequestAnswerView,
  type AgentPullRequestParams,
  type AgentPullRequestReadParams,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  type AgentRenameParams,
  type AgentReviewOptionsAnswerView,
  type AgentRewindParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentStopParams,
  type AgentTranscriptChanged,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  type AgentWorkspaceListParams,
  agentAccountInboxAnswerViewSchema,
  agentAgentAnswerSchema,
  agentChangesAnswerViewSchema,
  agentDefaultAnswerViewSchema,
  agentDeleteAnswerViewSchema,
  agentGitHubImageViewSchema,
  agentInboxAnsweredViewSchema,
  agentInboxAttachmentViewSchema,
  agentInboxChangedSchema,
  agentInboxMessagedViewSchema,
  agentInboxReadAllViewSchema,
  agentInboxReadStateViewSchema,
  agentListAnswerViewSchema,
  agentLukeToolsAnswerViewSchema,
  agentMessagesAnswerViewSchema,
  agentModelsAnswerSchema,
  agentOperatorEnsureAnswerViewSchema,
  agentOverviewChecksAnswerViewSchema,
  agentOverviewConversationAnswerViewSchema,
  agentOverviewPullRequestAnswerViewSchema,
  agentPageAnswerViewSchema,
  agentPartViewSchema,
  agentPullRequestAnswerViewSchema,
  agentPullRequestViewedAnswerViewSchema,
  agentPullRequestWriteAnswerViewSchema,
  agentReviewOptionsAnswerViewSchema,
  agentTranscriptChangedSchema,
  agentTranscriptOlderAnswerSchema,
  type ChatGptSignInAnswerView,
  chatGptSignInAnswerViewSchema,
  type DevicePresenceAnswerView,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  devicePresenceAnswerViewSchema,
  dictationTranscribeAnswerViewSchema,
  type GitHubTokenAnswerView,
  type GitHubTokenSaveParams,
  githubTokenAnswerViewSchema,
  type HostDoneAnswerView,
  type HostInstallTokenAnswerView,
  type HostsAnswerView,
  hostDoneAnswerViewSchema,
  hostInstallTokenAnswerViewSchema,
  hostsAnswerViewSchema,
  type MemoriesAnswerView,
  type MemoriesReadParams,
  type MemoryForgetParams,
  memoriesAnswerViewSchema,
  type ProviderKeyForAgentsParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
  providerKeysAnswerViewSchema,
} from "@luke/features/agent-view";
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
  type ArchivedChannelsView,
  archivedChannelsViewSchema,
  CHANNEL_CALL_FAILURE,
  type ChannelArchiveParams,
  type ChannelCreateParams,
  type ChannelEditParams,
  type ChannelLookParams,
  type ChannelMoveParams,
  type ChannelMoveView,
  type ChannelsArchivedParams,
  type ChannelsChanged,
  type ChannelsFollowParams,
  type ChannelsListParams,
  type ChannelsView,
  type ChannelThreadsParams,
  type ChannelThreadsView,
  type ChannelUnarchiveParams,
  channelMoveViewSchema,
  channelsChangedSchema,
  channelsViewSchema,
  channelThreadsViewSchema,
} from "@luke/features/channel-view";
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
  type PullRequestChaptersReadParams,
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
  type TasksBlockAnswer,
  type TasksBlockParams,
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
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksIssueParams,
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
  tasksBlockAnswerSchema,
  tasksBrowserTabOpenAnswerSchema,
  tasksBrowserTabsAnswerSchema,
  tasksCommentAnswerSchema,
  tasksCommentsAnswerSchema,
  tasksEditAnswerSchema,
  tasksFileAnswerSchema,
  tasksGitHubDisconnectAnswerSchema,
  tasksGitHubPageAnswerSchema,
  tasksIssueAnswerSchema,
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
import { isSignInFailure } from "@luke/features/words";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  type GatewayMethod,
  gatewayEventReader,
} from "@luke/gateway";
import type {
  AppSettingField,
  AppSettingValue,
  Experiment,
  SettingsResetScope,
} from "@luke/settings";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
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
import type { AppAccessSlice, AppHostRead, AppInboxItems } from "./app-state.js";
import { type ThisMacHostStanding, thisMacHostStandingSchema } from "./contract/this-mac-host.js";
import {
  type MacCommandAnswer,
  type MacCommandAsk,
  macCommandAsksSchema,
} from "./mac-command-ask.js";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * task, and client-fact methods the runtime host answers, and the events it pushes. Every method answers an effect: it
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
  /** Where This Mac's `luke-host` stands; none where the host could not answer. */
  thisMacHostStanding(): Effect.Effect<ThisMacHostStanding | undefined>;
  /** This Mac's `luke-host` turned on by the member's own act; where it then stands, or none where the host could not answer. */
  turnOnThisMacHost(): Effect.Effect<ThisMacHostStanding | undefined>;
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
  /** The account a sign-in settled on, or the key of why it ended without landing. */
  beginSignIn(provider: AccountProvider): Effect.Effect<SignInAnswer>;
  /** The sign-in taken again over the session that stands: whether a new session landed. */
  signInAgain(provider: AccountProvider): Effect.Effect<boolean>;
  cancelSignIn(): Effect.Effect<void>;
  signOut(): Effect.Effect<AccountSnapshot>;
  deleteAccount(): Effect.Effect<AccountSnapshot>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Tasks tab shows: the host reads the task list and the active document now and follows both until it is paused. */
  tasksRefresh(): Effect.Effect<void>;
  /** The Mac woke, unlocked, or found its network again: the host follows the task list again from a fresh seal. */
  tasksResync(): Effect.Effect<void>;
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
  /** One block of a task added or taken away; the task's blocks as they then stand, or why they are unchanged. */
  tasksBlock(params: TasksBlockParams): Effect.Effect<TasksBlockAnswer>;
  /** The developer's edit of a task's document; saved, a conflict with the text as it stands now, or why nothing was saved. */
  tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
  /** A window of a file of a task's repository, coloured; or why it is not shown. */
  tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
  tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
  /** The skills a developer may choose of a task's repository; or why they are not read. */
  tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
  /** One pull request of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksPullRequest(params: TasksPullRequestParams): Effect.Effect<TasksPullRequestAnswer>;
  /** One issue of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksIssue(params: TasksIssueParams): Effect.Effect<TasksIssueAnswer>;
  /** The Browser tabs open in a task's agents' browsers, the oldest first; or that the service did not answer. */
  tasksBrowserTabs(params: TasksBrowserTabsParams): Effect.Effect<TasksBrowserTabsAnswer>;
  /** A Browser tab opened at an address in a task's coding agent's browser, taken over by the account; or why none opened. */
  tasksBrowserTabOpen(params: TasksBrowserTabOpenParams): Effect.Effect<TasksBrowserTabOpenAnswer>;
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
  agentModels(): Effect.Effect<AgentModelsAnswer>;
  /** The account's default model and effort for a coding agent; or why there is none. */
  agentDefaultRead(): Effect.Effect<AgentDefaultAnswer>;
  /** The default written; the choice as kept, or why it is unchanged. */
  agentDefaultWrite(choice: ModelChoice): Effect.Effect<AgentDefaultAnswer>;
  /** The account's hosts, as Settings lists them; or why there is no list. */
  hostsList(): Effect.Effect<HostsAnswerView>;
  hostsPresence(): Effect.Effect<DevicePresenceAnswerView>;
  /** One of the account's hosts removed; done, or why not. */
  hostsRemove(id: string): Effect.Effect<HostDoneAnswerView>;
  /** An install token kept by its SHA-256 alone; its id and expiry, or why not. */
  hostsKeepInstallToken(tokenHash: string): Effect.Effect<HostInstallTokenAnswerView>;
  /** One of the account's install tokens revoked; done, or why not. */
  hostsRevokeInstallToken(id: string): Effect.Effect<HostDoneAnswerView>;
  /** One task's coding agents with their status; or why there is no list. */
  agentList(params: AgentListParams): Effect.Effect<AgentListAnswer>;
  /** One workspace's coding agents, newest started first, on one repository where one is named; or why there is no list. */
  agentWorkspaceList(params: AgentWorkspaceListParams): Effect.Effect<AgentListAnswer>;
  /** An agent started on a task under the press's own key; the agent, or why none started. */
  agentStart(params: AgentStartParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent's transcript past a cursor, held by the service while the agent runs; or why there is none. */
  agentMessages(params: AgentMessagesParams): Effect.Effect<AgentMessagesAnswerView>;
  /** One agent sent a message naming how it reaches a turn under way; the agent as it then stands, or why it was not. */
  agentMessage(params: AgentMessageParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent's model and effort changed for its next step; the agent as it then stands, or why it is unchanged. */
  agentChoose(params: AgentChooseParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent renamed, or its title cleared; the agent as it then stands, or why it is unchanged. */
  agentRename(params: AgentRenameParams): Effect.Effect<AgentAgentAnswer>;
  agentServers(params: AgentServersParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent stopped; the agent as it then stands, or why it was not. */
  agentStop(params: AgentStopParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent taken back to just before one of the developer's lines, stopped first where it still works; the agent as it then stands, or why it was not. */
  agentRewind(params: AgentRewindParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  agentArchive(params: AgentArchiveParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent deleted for good, a turn it still runs stopped first; that it was, or why not. */
  agentDelete(params: AgentStopParams): Effect.Effect<AgentDeleteAnswerView>;
  agentPin(params: AgentPinParams): Effect.Effect<AgentAgentAnswer>;
  /** The account's operator in a workspace, Luke, ensured, or reset and ensured afresh: its id, or why there is none. */
  agentEnsureOperator(
    params: AgentOperatorEnsureParams,
  ): Effect.Effect<AgentOperatorEnsureAnswerView>;
  /** One agent read whole as its own page, on a task or with none; or why there is no answer. */
  agentPage(params: AgentPageParams): Effect.Effect<AgentPageAnswerView>;
  /** A workspace's open channels, each with what waits on the reader there and when they last looked; or why there are none. */
  channelsList(params: ChannelsListParams): Effect.Effect<ChannelsView>;
  /** A channel made; the workspace's channels as they then stand, or why it was not made. */
  channelsCreate(params: ChannelCreateParams): Effect.Effect<ChannelsView>;
  /** A channel's name, purpose, or both edited; the workspace's channels as they then stand, or why it was not edited. */
  channelsEdit(params: ChannelEditParams): Effect.Effect<ChannelsView>;
  /** A channel archived; the workspace's channels as they then stand, or why it stands. */
  channelsArchive(params: ChannelArchiveParams): Effect.Effect<ChannelsView>;
  /** An archived channel opened again; the workspace's channels as they then stand, or why it stays archived. */
  channelsUnarchive(params: ChannelUnarchiveParams): Effect.Effect<ChannelsView>;
  /** A workspace's archived channels, the latest archived first; or why there are none. */
  channelsArchived(params: ChannelsArchivedParams): Effect.Effect<ArchivedChannelsView>;
  /** The reader's look at a channel stamped; the workspace's channels as they then stand. */
  channelsLook(params: ChannelLookParams): Effect.Effect<ChannelsView>;
  /** A page of a channel's threads the reader may read, oldest first; or why there are none. */
  channelsThreads(params: ChannelThreadsParams): Effect.Effect<ChannelThreadsView>;
  /** A thread moved into another open channel of its workspace; the thread as it then stands, or why it did not move. */
  channelsMove(params: ChannelMoveParams): Effect.Effect<ChannelMoveView>;
  /** A workspace's channels followed from now until let go or signed out, heard through `onChannelsChanged`; following again starts over. */
  channelsFollow(params: ChannelsFollowParams): Effect.Effect<void>;
  /** A followed workspace's channels let go. */
  channelsUnfollow(params: ChannelsFollowParams): Effect.Effect<void>;
  /** Hears which of a followed workspace's channels moved, each time any does; answers the stop. */
  onChannelsChanged(listener: (changed: ChannelsChanged) => void): () => void;
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
  agentPullRequest(params: AgentPullRequestReadParams): Effect.Effect<AgentPullRequestAnswerView>;
  /** The workspace's newest chapters of one agent's pull request by its number; or why there are none. */
  pullRequestChapters(
    params: PullRequestChaptersReadParams,
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
  agentChanges(params: AgentPullRequestReadParams): Effect.Effect<AgentChangesAnswerView>;
  /** One image an agent's pull request's overview names, read by the service on the App's token; or why there is none. */
  agentGitHubImage(params: AgentGitHubImageParams): Effect.Effect<AgentGitHubImageView>;
  /** One change to an agent's pull request, made on GitHub as the account on its own GitHub sign-in; how GitHub took it, or why there is no answer. */
  agentPullRequestAction(
    params: AgentPullRequestActionParams,
  ): Effect.Effect<AgentPullRequestWriteAnswerView>;
  /** Which of one agent's pull request's files the account marked viewed on GitHub, read on its own GitHub sign-in; or why there is no answer. */
  agentPullRequestViewed(
    params: AgentPullRequestReadParams,
  ): Effect.Effect<AgentPullRequestViewedAnswerView>;
  /** One agent's pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them; or why there is none. */
  agentOverviewPullRequest(
    params: AgentPullRequestReadParams,
  ): Effect.Effect<AgentOverviewPullRequestAnswerView>;
  /** What the reviewer and label pickers of one agent's Pull request tab offer: its repository's labels, assignable users, and teams; or why there is no answer. */
  agentReviewOptions(params: AgentPullRequestParams): Effect.Effect<AgentReviewOptionsAnswerView>;
  /** Which of Luke's own tools one agent is offered and whether its `run_on_mac` would run now; or why there is no answer. */
  agentLukeTools(params: AgentPullRequestParams): Effect.Effect<AgentLukeToolsAnswerView>;
  /** The checks on one agent's pull request's head as GitHub holds them; or why there are none. */
  agentOverviewChecks(
    params: AgentPullRequestReadParams,
  ): Effect.Effect<AgentOverviewChecksAnswerView>;
  /** One agent's pull request's conversation and where its reviewers stand, as GitHub holds them; or why there is none. */
  agentOverviewConversation(
    params: AgentPullRequestReadParams,
  ): Effect.Effect<AgentOverviewConversationAnswerView>;
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
  /** The memories Luke's agents kept in a workspace; or why there are none. */
  memoriesRead(params: MemoriesReadParams): Effect.Effect<MemoriesAnswerView>;
  /** One memory forgotten for good; the workspace's memories as they then stand, or why they are unchanged. */
  memoryForget(params: MemoryForgetParams): Effect.Effect<MemoriesAnswerView>;
  /** One dictated clip, carried once; its words, or why there are none. */
  dictationTranscribe(
    params: DictationTranscribeParams,
  ): Effect.Effect<DictationTranscribeAnswerView>;
  /** One task's or agent's inbox, followed from now until let go or signed out, heard through `onInboxChanged`; following again starts over. */
  agentInboxFollow(scope: AgentInboxScope): Effect.Effect<void>;
  /** One task's or agent's inbox let go: nothing more is heard of it until it is followed again. */
  agentInboxUnfollow(scope: AgentInboxScope): Effect.Effect<void>;
  /** A followed inbox, its items whole or why there are none, each time it changes. */
  onInboxChanged(listener: (changed: AgentInboxChanged) => void): () => void;
  /** One item of a task's inbox answered; the item as it then stands and whether the answer was taken, or why there is no answer. */
  agentInboxAnswer(params: AgentInboxAnswerParams): Effect.Effect<AgentInboxAnsweredView>;
  /** One open item of a task's inbox closed without an answer; the item as it then stands and whether the close was taken, or why there is no answer. */
  agentInboxClose(params: AgentInboxCloseParams): Effect.Effect<AgentInboxAnsweredView>;
  /** One message on an item's thread, open or settled; the item as it then stands, its thread with the message on it, or why there is no answer. */
  agentInboxMessage(params: AgentInboxMessageParams): Effect.Effect<AgentInboxMessagedView>;
  /** A thread started with one agent, its subject and first message; the thread as it then stands, its message on it, or why there is no answer. */
  agentInboxStart(params: AgentInboxStartParams): Effect.Effect<AgentInboxMessagedView>;
  /** One item marked read or unread for the account; its read state, or why there is no answer. */
  agentInboxReadState(params: AgentInboxReadStateParams): Effect.Effect<AgentInboxReadStateView>;
  /** Every item of the account's Inbox marked read, in the one workspace named or in all; how many were unread, or why there is no answer. */
  agentInboxReadAll(params: AgentInboxReadAllParams): Effect.Effect<AgentInboxReadAllView>;
  /** What waits on the developer across the account, followed from now until let go or signed out, heard through `onAccountInboxChanged`; following again starts over. */
  agentAccountInboxFollow(): Effect.Effect<void>;
  /** The account inbox let go: nothing more is heard of it until it is followed again. */
  agentAccountInboxUnfollow(): Effect.Effect<void>;
  /** What waits across the followed account, or why there is none, each time it moves. */
  onAccountInboxChanged(listener: (answer: AgentAccountInboxAnswerView) => void): () => void;
  /** Every inbox item the account reaches read again at once, as Try again asks. */
  agentInboxItemsRetry(): Effect.Effect<void>;
  /** Every inbox item the account reaches, whole, each time the host's read of them for the session moves. */
  onInboxItemsChanged(listener: (read: AppHostRead<AppInboxItems>) => void): () => void;
  /** One image of an inbox item, fetched under the account; its bytes in base64 under its media type, or why there is none. */
  /** One agent's, worker's, or planning worker's transcript, followed from now until let go or signed out, its pages heard through `onTranscriptChanged`; following again starts over. */
  transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** One followed transcript let go: nothing more is heard of it until it is followed again. */
  transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** The page of a transcript below the oldest message the window holds, read at once; or why there is none. */
  transcriptOlder(params: AgentTranscriptOlderParams): Effect.Effect<AgentTranscriptOlderAnswer>;
  /** A followed transcript's next page, or why there is none, each time it moves. */
  onTranscriptChanged(listener: (changed: AgentTranscriptChanged) => void): () => void;
  agentInboxAttachment(params: AgentInboxAttachmentParams): Effect.Effect<AgentInboxAttachmentView>;
  /** One picture a tool answered an agent or one of its workers, read under the account: its bytes in base64 under its type, or why there is none. */
  agentPicture(params: AgentPictureParams): Effect.Effect<AgentInboxAttachmentView>;
  /** One part of a message of an agent's transcript or one of its workers', read whole under the account: what the page carried cut, or why there is none. */
  agentPart(params: AgentPartParams): Effect.Effect<AgentPartView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onAccountAccessChanged(listener: (access: AppAccessSlice) => void): () => void;
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
    agentId: string;
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

/**
 * The host's answer to a call, read by its schema; `unanswered` where the
 * host refused it or answered a shape its method does not document.
 */
function answerOf<Answer, Encoded, Unanswered>(
  schema: EffectSchema.Codec<Answer, Encoded>,
  unanswered: Unanswered,
) {
  return (answer: GatewayCallResult): Answer | Unanswered =>
    (answer.ok
      ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
      : undefined) ?? unanswered;
}

interface HostOperatorOptions {
  client: GatewayClient;
  report: (message: string) => void;
}

/** A Pull request tab's read as the gateway carries it: the agent, and the pull request's number where the tab names one other than the agent's own. */
function pullRequestRead(params: AgentPullRequestReadParams): AgentPullRequestReadParams {
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
const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is Luke's own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** What a coding-agent call the host could not answer is drawn as. */
/** A followed transcript as the gateway's params carry it. */
function transcriptParams(transcript: AgentTranscriptKey): WireRecord {
  const { kind, agentId, callId } = transcript;
  return callId === undefined ? { kind, agentId } : { kind, agentId, callId };
}

const AGENT_UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** An automation call that reached no answer, as every automation method answers one. */
const AUTOMATION_UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** A channel call that reached no answer, as every channel method answers one. */
const CHANNEL_UNANSWERED = { failure: CHANNEL_CALL_FAILURE.UNANSWERED } as const;

/** A task call that reached no answer, as every task method answers one. */
const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A GitHub disconnect that reached no answer. */
const GITHUB_DISCONNECT_UNANSWERED = { failure: GITHUB_DISCONNECT_FAILURE.UNANSWERED } as const;

/** An admin read that reached no answer. */
const ADMIN_READ_UNANSWERED = { refused: ADMIN_UNANSWERED } as const;

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

  /** The account an integration ask is about, as the gateway carries it: the provider, and the account and an add where the window named them. */
  const integrationTarget = (params: IntegrationProviderParams) => ({
    provider: params.provider,
    ...(params.connection !== undefined ? { connection: params.connection } : undefined),
    ...(params.add !== undefined ? { add: params.add } : undefined),
  });

  return {
    integrationsStatus: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_STATUS),
        answerOf(integrationStatusesViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, integrationTarget(params)),
        answerOf(integrationConnectViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsTools: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_TOOLS, integrationTarget(params)),
        answerOf(integrationToolsViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsCancel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_CANCEL, integrationTarget(params)),
        answerOf(integrationStatusViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_DISCONNECT, integrationTarget(params)),
        answerOf(integrationStatusViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_RENAME, {
          provider: params.provider,
          connection: params.connection,
          label: params.label,
        }),
        answerOf(integrationAccountViewSchema, INTEGRATION_UNANSWERED),
      ),
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        Option.fromUndefinedOr(answered<HostBootstrap>(record(answer))),
      ),
    macRepositories: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.MAC_REPOSITORIES_READ),
        answerOf(macRepositoriesAnswerSchema, undefined),
      ),
    setMacRepository: (entry) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MAC_REPOSITORY_SET, {
          repository: entry.repository,
          command: entry.command,
        }),
        answerOf(macRepositoriesAnswerSchema, undefined),
      ),
    thisMacHostStanding: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.THIS_MAC_HOST_READ),
        answerOf(thisMacHostStandingSchema, undefined),
      ),
    turnOnThisMacHost: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON),
        answerOf(thisMacHostStandingSchema, undefined),
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
      Effect.flatMap(
        client.call(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, { provider }),
        (answer): Effect.Effect<SignInAnswer> => {
          const failure = record(answer)?.failure;
          if (isSignInFailure(failure)) return Effect.succeed({ failure });
          return Effect.map(
            accountResult(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, Effect.succeed(answer)),
            (account) => ({ account }),
          );
        },
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
    tasksResync: () => fire(client.call(GATEWAY_METHOD.TASKS_RESYNC)),
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
        answerOf(tasksRepositoriesAnswerSchema, TASK_UNANSWERED),
      ),
    tasksFile: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_FILE, {
          ...("taskId" in params
            ? { taskId: params.taskId }
            : { workspaceId: params.workspaceId, repository: params.repository }),
          path: params.path,
          firstLine: params.firstLine,
          lastLine: params.lastLine,
          ...(params.raw === undefined ? undefined : { raw: params.raw }),
          ...(params.ref === undefined ? undefined : { ref: params.ref }),
        }),
        answerOf(tasksFileAnswerSchema, TASK_UNANSWERED),
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
        answerOf(tasksTreeAnswerSchema, TASK_UNANSWERED),
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
        answerOf(tasksSkillsAnswerSchema, TASK_UNANSWERED),
      ),
    tasksPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          number: params.number,
        }),
        answerOf(tasksPullRequestAnswerSchema, TASK_UNANSWERED),
      ),
    tasksIssue: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ISSUE, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          number: params.number,
        }),
        answerOf(tasksIssueAnswerSchema, TASK_UNANSWERED),
      ),
    tasksBrowserTabs: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS, params),
        answerOf(tasksBrowserTabsAnswerSchema, TASK_UNANSWERED),
      ),
    tasksBrowserTabOpen: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BROWSER_TAB_OPEN, {
          agentId: params.agentId,
          address: params.address,
        }),
        answerOf(tasksBrowserTabOpenAnswerSchema, TASK_UNANSWERED),
      ),
    tasksRevisions: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_REVISIONS, {
          taskId: params.taskId,
          ...(params.before === undefined ? undefined : { before: params.before }),
        }),
        answerOf(tasksRevisionsAnswerSchema, TASK_UNANSWERED),
      ),
    tasksRevision: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_REVISION, { taskId: params.taskId, seq: params.seq }),
        answerOf(tasksRevisionAnswerSchema, TASK_UNANSWERED),
      ),
    tasksComments: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENTS, {
          planId: params.planId,
          after: params.after,
        }),
        answerOf(tasksCommentsAnswerSchema, TASK_UNANSWERED),
      ),
    tasksCommentStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENT_START, {
          planId: params.planId,
          start: params.start,
        }),
        answerOf(tasksCommentAnswerSchema, TASK_UNANSWERED),
      ),
    tasksCommentAct: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_COMMENT_ACT, {
          planId: params.planId,
          threadId: params.threadId,
          action: params.action,
        }),
        answerOf(tasksCommentAnswerSchema, TASK_UNANSWERED),
      ),
    tasksPictureKeep: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PICTURE_KEEP, {
          planId: params.planId,
          picture: params.picture,
        }),
        answerOf(tasksPictureKeepAnswerSchema, TASK_UNANSWERED),
      ),
    tasksPicture: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PICTURE, {
          planId: params.planId,
          attachmentId: params.attachmentId,
        }),
        answerOf(tasksPictureAnswerSchema, TASK_UNANSWERED),
      ),
    tasksPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PAGE, {
          ...("taskId" in params ? { taskId: params.taskId } : { agentId: params.agentId }),
          pageId: params.pageId,
          version: params.version,
        }),
        answerOf(tasksPageAnswerSchema, TASK_UNANSWERED),
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
        answerOf(tasksPagesAnswerSchema, TASK_UNANSWERED),
      ),
    tasksRestore: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_RESTORE, { taskId: params.taskId, seq: params.seq }),
        (answer) => record(answer)?.restored === true,
      ),
    githubConnect: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_CONNECT),
        answerOf(tasksGitHubPageAnswerSchema, TASK_UNANSWERED),
      ),
    githubDisconnect: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_DISCONNECT),
        answerOf(tasksGitHubDisconnectAnswerSchema, GITHUB_DISCONNECT_UNANSWERED),
      ),
    adminRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.ADMIN_READ, {
          procedure: params.procedure,
          query: params.query,
        }),
        answerOf(adminReadAnswerSchema, ADMIN_READ_UNANSWERED),
      ),
    adminFavorite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.ADMIN_FAVORITE, { id: params.id, favorite: params.favorite }),
        (answer) => answer.ok && answer.result === true,
      ),
    workspaceCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: params.name }),
        answerOf(tasksWorkspaceAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_RENAME, {
          workspaceId: params.workspaceId,
          name: params.name,
        }),
        answerOf(tasksWorkspaceAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspacePhotoSet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
          workspaceId: params.workspaceId,
          photo: params.photo,
        }),
        answerOf(tasksWorkspaceAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceGitHubConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceGitHubConnectAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceGitHubDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, {
          workspaceId: params.workspaceId,
        }),
        answerOf(tasksWorkspaceAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSentry: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceSentryAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSentryInstall: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY_INSTALL, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceGitHubConnectAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSentryDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SENTRY_DISCONNECT, {
          workspaceId: params.workspaceId,
          installationId: params.installationId,
        }),
        answerOf(tasksWorkspaceSentryAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceMembers: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceMembersAnswerSchema, WORKSPACE_UNANSWERED),
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
        answerOf(tasksWorkspacePhotoAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceTokenRepositories: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES, {
          workspaceId: params.workspaceId,
        }),
        answerOf(tasksWorkspaceTokenRepositoriesAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceTokenRepositorySet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET, {
          workspaceId: params.workspaceId,
          repository: params.repository,
          added: params.added,
        }),
        answerOf(tasksWorkspaceTokenRepositoriesAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceMemberRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
          workspaceId: params.workspaceId,
          userId: params.userId,
        }),
        answerOf(tasksWorkspaceMembersAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceMemberRole: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
          workspaceId: params.workspaceId,
          userId: params.userId,
          role: params.role,
        }),
        answerOf(tasksWorkspaceMembersAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceTransfer: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_TRANSFER, {
          workspaceId: params.workspaceId,
          userId: params.userId,
        }),
        answerOf(tasksWorkspaceMembersAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceLeave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceLeaveAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceInvitations: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS, { workspaceId: params.workspaceId }),
        answerOf(tasksWorkspaceInvitationsAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceInvite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITE, {
          workspaceId: params.workspaceId,
          email: params.email,
          role: params.role,
        }),
        answerOf(tasksWorkspaceInvitationAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceInvitationCancel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL, {
          workspaceId: params.workspaceId,
          invitationId: params.invitationId,
        }),
        answerOf(tasksWorkspaceInvitationsAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    tasksSetRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_SET_REPOSITORY, {
          taskId: params.taskId,
          repository: params.repository,
        }),
        answerOf(tasksSetRepositoryAnswerSchema, TASK_UNANSWERED),
      ),
    tasksMove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_MOVE, {
          taskId: params.taskId,
          workspaceId: params.workspaceId,
        }),
        answerOf(tasksMoveAnswerSchema, TASK_UNANSWERED),
      ),
    tasksBlock: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BLOCK, { taskId: params.taskId, block: params.block }),
        answerOf(tasksBlockAnswerSchema, TASK_UNANSWERED),
      ),
    tasksEdit: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_EDIT, { taskId: params.taskId, edit: params.edit }),
        answerOf(tasksEditAnswerSchema, TASK_UNANSWERED),
      ),
    // Note that the request goes on whole, as the act port decoded it against the same schema the
    // Gateway's method reads, because a field copied by name is one a later field is left out of,
    // as Runs on was, which sent every task to the cloud.
    tasksStart: (request) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_START, request),
        answerOf(tasksStartAnswerSchema, TASK_UNANSWERED),
      ),
    agentModels: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_MODELS),
        answerOf(agentModelsAnswerSchema, AGENT_UNANSWERED),
      ),
    agentDefaultRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_DEFAULT_READ),
        answerOf(agentDefaultAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentDefaultWrite: (choice) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_DEFAULT_WRITE, {
          model: choice.model,
          effort: choice.effort,
          ...(choice.contextWindow === undefined
            ? undefined
            : { contextWindow: choice.contextWindow }),
        }),
        answerOf(agentDefaultAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsList: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_LIST),
        answerOf(hostsAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsPresence: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_PRESENCE),
        answerOf(devicePresenceAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsRemove: (id) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_REMOVE, { id }),
        answerOf(hostDoneAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsKeepInstallToken: (tokenHash) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_KEEP_INSTALL_TOKEN, { tokenHash }),
        answerOf(hostInstallTokenAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsRevokeInstallToken: (id) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_REVOKE_INSTALL_TOKEN, { id }),
        answerOf(hostDoneAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentWorkspaceList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_WORKSPACE_LIST, params),
        answerOf(agentListAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_LIST, {
          taskId: params.taskId,
          ...(params.includeArchived === undefined
            ? undefined
            : { includeArchived: params.includeArchived }),
        }),
        answerOf(agentListAnswerViewSchema, AGENT_UNANSWERED),
      ),
    // Note that the Start goes on whole, as the act port decoded it against the same schema the
    // Gateway's method reads, because a field copied by name is one a later field is left out of,
    // as an empty draft's `blank` was, which handed its agent the plan.
    agentStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_START, params),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentMessages: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_MESSAGES, {
          agentId: params.agentId,
          after: params.after,
          ...("callId" in params ? { callId: params.callId } : undefined),
        }),
        answerOf(agentMessagesAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentMessage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_MESSAGE, {
          agentId: params.agentId,
          text: params.text,
          clientKey: params.clientKey,
          ...("attachments" in params ? { attachments: params.attachments } : undefined),
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentChoose: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_CHOOSE, {
          agentId: params.agentId,
          model: params.model,
          effort: params.effort,
          ...("contextWindow" in params ? { contextWindow: params.contextWindow } : undefined),
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_RENAME, {
          agentId: params.agentId,
          title: params.title,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentServers: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_SERVERS, {
          agentId: params.agentId,
          disabledServers: params.disabledServers,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentStop: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_STOP, { agentId: params.agentId }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentRewind: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_REWIND, {
          agentId: params.agentId,
          messageId: params.messageId,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentArchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_ARCHIVE, {
          agentId: params.agentId,
          archived: params.archived,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentDelete: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_DELETE, { agentId: params.agentId }),
        answerOf(agentDeleteAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentPin: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PIN, {
          agentId: params.agentId,
          pinned: params.pinned,
          ...(params.position === undefined ? undefined : { position: params.position }),
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentEnsureOperator: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_ENSURE_OPERATOR, {
          workspaceId: params.workspaceId,
          ...(params.reset === undefined ? undefined : { reset: params.reset }),
          ...(params.restore === undefined ? undefined : { restore: params.restore }),
          ...(params.timeZone === undefined ? undefined : { timeZone: params.timeZone }),
        }),
        answerOf(agentOperatorEnsureAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PAGE, { agentId: params.agentId }),
        answerOf(agentPageAnswerViewSchema, AGENT_UNANSWERED),
      ),
    channelsList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_LIST, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_CREATE, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsEdit: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_EDIT, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsUnarchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_UNARCHIVE, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsArchived: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_ARCHIVED, params),
        answerOf(archivedChannelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsArchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_ARCHIVE, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsLook: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_LOOK, params),
        answerOf(channelsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsThreads: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_THREADS, params),
        answerOf(channelThreadsViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsMove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHANNELS_MOVE, params),
        answerOf(channelMoveViewSchema, CHANNEL_UNANSWERED),
      ),
    channelsFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.CHANNELS_FOLLOW, { workspaceId: params.workspaceId })),
    channelsUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.CHANNELS_UNFOLLOW, { workspaceId: params.workspaceId })),
    onChannelsChanged: (listener) =>
      on(
        GATEWAY_EVENT.CHANNELS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(channelsChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    automationList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_LIST, params),
        answerOf(automationListViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_CREATE, params),
        answerOf(automationViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationChange: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_CHANGE, params),
        answerOf(automationViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationDelete: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_DELETE, params),
        answerOf(automationDeletedViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationRun: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_RUN, params),
        answerOf(automationRunViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationRuns: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_RUNS, params),
        answerOf(automationRunsViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationNewWebhookSecret: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, params),
        answerOf(automationViewSchema, AUTOMATION_UNANSWERED),
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
    agentPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST, pullRequestRead(params)),
        answerOf(agentPullRequestAnswerViewSchema, AGENT_UNANSWERED),
      ),
    pullRequestChapters: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS, {
          agentId: params.agentId,
          number: params.number,
        }),
        answerOf(pullRequestChaptersAnswerViewSchema, AGENT_UNANSWERED),
      ),
    pullRequestChaptersGenerate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS_GENERATE, pullRequestChaptersRead(params)),
        answerOf(pullRequestChaptersAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chaptersModelRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHAPTERS_MODEL_READ),
        answerOf(chaptersModelAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chaptersModelWrite: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHAPTERS_MODEL_WRITE, { model: params.model }),
        answerOf(chaptersModelAnswerViewSchema, AGENT_UNANSWERED),
      ),
    installedSkillsList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_LIST, params),
        answerOf(installedSkillListViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_READ, params),
        answerOf(installedSkillContentViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsPreview: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW, params),
        answerOf(installedSkillPreviewViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsPreviewFile: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW_FILE, params),
        answerOf(installedSkillPreviewFileViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsInstall: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, params),
        answerOf(installedSkillInstallViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsSetEnabled: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, params),
        answerOf(installedSkillViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsCheckUpdate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_CHECK_UPDATE, params),
        answerOf(installedSkillUpdateCheckViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsUpdate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE, params),
        answerOf(installedSkillUpdatedViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsShare: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_SHARE, params),
        answerOf(installedSkillViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    installedSkillsRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE, params),
        answerOf(installedSkillRemovedViewSchema, INSTALLED_SKILL_UNANSWERED),
      ),
    agentChanges: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_CHANGES, pullRequestRead(params)),
        answerOf(agentChangesAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentGitHubImage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_GITHUB_IMAGE, params),
        answerOf(agentGitHubImageViewSchema, AGENT_UNANSWERED),
      ),
    agentPullRequestAction: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_ACTION, {
          ...pullRequestRead(params),
          request: params.request,
        }),
        answerOf(agentPullRequestWriteAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentPullRequestViewed: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_VIEWED, pullRequestRead(params)),
        answerOf(agentPullRequestViewedAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentOverviewPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_OVERVIEW_PULL_REQUEST, pullRequestRead(params)),
        answerOf(agentOverviewPullRequestAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentReviewOptions: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_REVIEW_OPTIONS, { agentId: params.agentId }),
        answerOf(agentReviewOptionsAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentLukeTools: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_LUKE_TOOLS, { agentId: params.agentId }),
        answerOf(agentLukeToolsAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentOverviewChecks: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_OVERVIEW_CHECKS, pullRequestRead(params)),
        answerOf(agentOverviewChecksAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentOverviewConversation: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_OVERVIEW_CONVERSATION, pullRequestRead(params)),
        answerOf(agentOverviewConversationAnswerViewSchema, AGENT_UNANSWERED),
      ),
    providerKeysRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_READ),
        answerOf(providerKeysAnswerViewSchema, AGENT_UNANSWERED),
      ),
    providerKeySave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_SAVE, {
          provider: params.provider,
          ...(params.kind === undefined ? undefined : { kind: params.kind }),
          key: params.key,
        }),
        answerOf(providerKeysAnswerViewSchema, AGENT_UNANSWERED),
      ),
    providerKeyRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_REMOVE, {
          provider: params.provider,
          ...(params.kind === undefined ? undefined : { kind: params.kind }),
        }),
        answerOf(providerKeysAnswerViewSchema, AGENT_UNANSWERED),
      ),
    providerKeyForAgents: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_FOR_AGENTS, {
          provider: params.provider,
          kind: params.kind,
          forAgents: params.forAgents,
        }),
        answerOf(providerKeysAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chatGptSignIn: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHATGPT_SIGN_IN),
        answerOf(chatGptSignInAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chatGptSignInCancel: () => fire(client.call(GATEWAY_METHOD.CHATGPT_SIGN_IN_CANCEL)),
    githubTokenRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_READ),
        answerOf(githubTokenAnswerViewSchema, AGENT_UNANSWERED),
      ),
    githubTokenSave: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_SAVE, { token: params.token }),
        answerOf(githubTokenAnswerViewSchema, AGENT_UNANSWERED),
      ),
    githubTokenRemove: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.GITHUB_TOKEN_REMOVE),
        answerOf(githubTokenAnswerViewSchema, AGENT_UNANSWERED),
      ),
    memoriesRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MEMORIES_READ, { workspaceId: params.workspaceId }),
        answerOf(memoriesAnswerViewSchema, AGENT_UNANSWERED),
      ),
    memoryForget: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MEMORIES_FORGET, {
          workspaceId: params.workspaceId,
          id: params.id,
        }),
        answerOf(memoriesAnswerViewSchema, AGENT_UNANSWERED),
      ),
    dictationTranscribe: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.DICTATION_TRANSCRIBE, {
          audio: params.audio,
          durationMs: params.durationMs,
          keywords: [...params.keywords],
        }),
        answerOf(dictationTranscribeAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, { kind: scope.kind, id: scope.id })),
    agentInboxUnfollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, {
          kind: scope.kind,
          id: scope.id,
        }),
      ),
    onInboxChanged: (listener) =>
      on(
        GATEWAY_EVENT.INBOX_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(agentInboxChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    agentInboxAnswer: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_ANSWER, {
          itemId: params.itemId,
          revision: params.revision,
          reply: params.reply,
          clientKey: params.clientKey,
        }),
        answerOf(agentInboxAnsweredViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxClose: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_CLOSE, {
          itemId: params.itemId,
          revision: params.revision,
          clientKey: params.clientKey,
        }),
        answerOf(agentInboxAnsweredViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxMessage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_MESSAGE, {
          itemId: params.itemId,
          text: params.text,
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
          clientKey: params.clientKey,
          ...(params.answers === undefined ? undefined : { answers: params.answers }),
          ...(params.revision === undefined ? undefined : { revision: params.revision }),
        }),
        answerOf(agentInboxMessagedViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_START, {
          agentId: params.agentId,
          ...(params.title === undefined ? undefined : { title: params.title }),
          text: params.text,
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
          clientKey: params.clientKey,
        }),
        answerOf(agentInboxMessagedViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxReadState: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_READ_STATE, {
          itemId: params.itemId,
          unread: params.unread,
        }),
        answerOf(agentInboxReadStateViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxReadAll: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_READ_ALL, {
          ...(params.workspaceId === undefined ? undefined : { workspaceId: params.workspaceId }),
          itemIds: params.itemIds,
        }),
        answerOf(agentInboxReadAllViewSchema, AGENT_UNANSWERED),
      ),
    agentAccountInboxFollow: () =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW, {})),
    agentAccountInboxUnfollow: () =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW, {})),
    onAccountInboxChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(agentAccountInboxAnswerViewSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    agentInboxItemsRetry: () => fire(client.call(GATEWAY_METHOD.AGENTS_INBOX_ITEMS_RETRY, {})),
    onInboxItemsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INBOX_ITEMS_CHANGED,
        // Note that the read is the host's own, handed over in this process, so it is passed on as built, as the tasks are.
        (payload) =>
          isRecord(payload) ? answered<AppHostRead<AppInboxItems>>(payload) : undefined,
        listener,
      ),
    transcriptFollow: (transcript) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, transcriptParams(transcript))),
    transcriptOlder: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_OLDER, {
          ...transcriptParams(params),
          before: params.before,
        }),
        answerOf(agentTranscriptOlderAnswerSchema, AGENT_UNANSWERED),
      ),
    transcriptUnfollow: (transcript) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, transcriptParams(transcript))),
    onTranscriptChanged: (listener) =>
      on(
        GATEWAY_EVENT.TRANSCRIPT_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(agentTranscriptChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    agentInboxAttachment: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_ATTACHMENT, {
          itemId: params.itemId,
          attachmentId: params.attachmentId,
        }),
        answerOf(agentInboxAttachmentViewSchema, AGENT_UNANSWERED),
      ),
    agentPicture: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PICTURE, params),
        answerOf(agentInboxAttachmentViewSchema, AGENT_UNANSWERED),
      ),
    agentPart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PART, params),
        answerOf(agentPartViewSchema, AGENT_UNANSWERED),
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
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_CREATE, {
          agentId: params.agentId,
          ...(params.title === undefined ? undefined : { title: params.title }),
        }),
        answerOf(terminalCreatedActAnswerSchema, undefined),
      ),
    terminalRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RENAME, {
          agentId: params.agentId,
          terminalId: params.terminalId,
          title: params.title,
        }),
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalKill: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_KILL, {
          agentId: params.agentId,
          terminalId: params.terminalId,
        }),
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalResume: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RESUME, { agentId: params.agentId }),
        answerOf(terminalResumedActAnswerSchema, undefined),
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
          agentId: params.agentId,
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
