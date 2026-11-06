import type { AccountProvider, AccountSnapshot, SignInAnswer } from "@repo/credentials/snapshot";
import { WORKSPACE_CALL_FAILURE } from "@repo/features";
import type { SupportAccessAnswerWire } from "@repo/features/account-wire";
import {
  ADMIN_UNANSWERED,
  type AdminFavoriteParams,
  type AdminReadAnswer,
  type AdminReadParams,
  adminReadAnswerSchema,
} from "@repo/features/admin-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentAccountInboxAnswerView,
  type AgentAddRepositoryParams,
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
  type AgentInboxCloseParams,
  type AgentInboxItemHomeParams,
  type AgentInboxItemHomeView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxReadAllParams,
  type AgentInboxReadAllView,
  type AgentInboxReadStateParams,
  type AgentInboxReadStateView,
  type AgentInboxRemindParams,
  type AgentInboxScope,
  type AgentInboxStartParams,
  type AgentListAnswer,
  type AgentListParams,
  type AgentMarkReadParams,
  type AgentMessageParams,
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentPageAnswerView,
  type AgentPageParams,
  type AgentPartParams,
  type AgentPartView,
  type AgentPictureParams,
  type AgentPinParams,
  type AgentPullRequestActionParams,
  type AgentPullRequestParams,
  type AgentPullRequestReadParams,
  type AgentPullRequestWriteAnswerView,
  type AgentQueueAnswerView,
  type AgentQueueParams,
  type AgentRenameParams,
  type AgentRewindParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentStopParams,
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
  agentInboxItemHomeViewSchema,
  agentInboxMessagedViewSchema,
  agentInboxReadAllViewSchema,
  agentInboxReadStateViewSchema,
  agentListAnswerViewSchema,
  agentMessagesAnswerViewSchema,
  agentPageAnswerViewSchema,
  agentPartViewSchema,
  agentPullRequestWriteAnswerViewSchema,
  agentQueueAnswerViewSchema,
  agentTranscriptOlderAnswerSchema,
  type ChatGptDeviceLoginParams,
  type ChatGptDevicePollAnswerView,
  type ChatGptDeviceStartAnswerView,
  type ChatGptDeviceWaitParams,
  chatGptDevicePollAnswerViewSchema,
  chatGptDeviceStartAnswerViewSchema,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  dictationTranscribeAnswerViewSchema,
  type GitHubTokenAnswerView,
  type GitHubTokenSaveParams,
  githubTokenAnswerViewSchema,
  type HostDoneAnswerView,
  hostDoneAnswerViewSchema,
  type MemoriesAnswerView,
  type MemoriesFollowParams,
  type MemoryForgetParams,
  memoriesAnswerViewSchema,
  type ProviderKeyForAgentsParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
  type PullRequestPartParams,
  providerKeysAnswerViewSchema,
  type ThisMacHostSetParams,
} from "@repo/features/agent-view";
import type { ProductEventName, ProductEventPropertiesFor } from "@repo/features/analytics";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationFollow,
  type AutomationIdParams,
  type AutomationRunParams,
  type AutomationRunView,
  type AutomationView,
  automationDeletedViewSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@repo/features/automation-view";
import {
  type BrowserLiveClosedEvent,
  type BrowserLiveMessageEvent,
  browserLiveClosedEventSchema,
  browserLiveMessageEventSchema,
} from "@repo/features/browser-live-acts";
import {
  HOST_PAIRING_CALL_FAILURE,
  type HostPairingApproveView,
  type HostPairingDenyView,
  type HostPairingView,
  hostPairingApproveViewSchema,
  hostPairingDenyViewSchema,
  hostPairingViewSchema,
} from "@repo/features/host-pairing-view";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillFollowParams,
  type InstalledSkillIdParams,
  type InstalledSkillInstallParams,
  type InstalledSkillInstallView,
  type InstalledSkillPreviewParams,
  type InstalledSkillPreviewView,
  type InstalledSkillRemovedView,
  installedSkillContentViewSchema,
  installedSkillInstallViewSchema,
  installedSkillPreviewViewSchema,
  installedSkillRemovedViewSchema,
} from "@repo/features/installed-skill-view";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationConnectView,
  type IntegrationProviderParams,
  type IntegrationRenameParams,
  type IntegrationStatusView,
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationStatusViewSchema,
} from "@repo/features/integration-view";
import {
  MCP_CLIENTS_CALL_FAILURE,
  type McpClientRevokeParams,
  type McpClientsView,
  mcpClientsViewSchema,
} from "@repo/features/mcp-client-view";
import type { ModelChoice } from "@repo/features/models-wire";
import {
  type PortForwarding,
  type PortForwardingAnswer,
  portForwardingAnswerSchema,
  portForwardingSchema,
} from "@repo/features/port-forward-acts";
import {
  type PullRequestChaptersAnswerView,
  type PullRequestChaptersParams,
  type PullRequestChaptersReadParams,
  pullRequestChaptersAnswerViewSchema,
} from "@repo/features/pull-request-chapters-view";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TaskBrowserTabsFollow,
  type TaskDocumentFollow,
  type TaskHistoryFollow,
  type TaskPagesFollow,
  type TasksBlockAnswer,
  type TasksBlockParams,
  type TasksBrowserTabOpenAnswer,
  type TasksBrowserTabOpenParams,
  type TasksChangeRelationAnswer,
  type TasksChangeRelationParams,
  type TasksCommentActParams,
  type TasksCommentAnswer,
  type TasksCommentStartParams,
  type TasksCommentsFollow,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksFileAnswer,
  type TasksFileParams,
  type TasksFindAnswer,
  type TasksFindParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksLinkStandingParams,
  type TasksMarkReadParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPictureKeepParams,
  type TasksPictureParams,
  type TasksPinParams,
  type TasksPinRepositoryParams,
  type TasksRenameParams,
  type TasksRepositoriesParams,
  type TasksRevisionAnswer,
  type TasksRevisionParams,
  type TasksRevisionsAnswer,
  type TasksRevisionsParams,
  type TasksSetParentAnswer,
  type TasksSetParentParams,
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
  type TasksWorkspaceParams,
  type TasksWorkspacePhotoSetParams,
  type TasksWorkspaceRenameParams,
  type TasksWorkspaceSentryAnswer,
  type TasksWorkspaceSentryDisconnectParams,
  type TasksWorkspaceSlackBotAnswer,
  type TasksWorkspaceSlackBotChannelParams,
  type TasksWorkspaceSlackBotNotificationsParams,
  type TasksWorkspaceSlackBotRepositoryParams,
  type TasksWorkspaceSlugSetParams,
  type TasksWorkspaceTokenRepositoriesAnswer,
  type TasksWorkspaceTokenRepositoriesParams,
  type TasksWorkspaceTokenRepositorySetParams,
  type TasksWorkspaceTransferParams,
  type TasksWriteSectionParams,
  tasksBlockAnswerSchema,
  tasksBrowserTabOpenAnswerSchema,
  tasksChangeRelationAnswerSchema,
  tasksCommentAnswerSchema,
  tasksEditAnswerSchema,
  tasksFileAnswerSchema,
  tasksFindAnswerSchema,
  tasksGitHubDisconnectAnswerSchema,
  tasksGitHubPageAnswerSchema,
  tasksMoveAnswerSchema,
  tasksPageAnswerSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionsAnswerSchema,
  tasksSetParentAnswerSchema,
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
  tasksWorkspaceSentryAnswerSchema,
  tasksWorkspaceSlackBotAnswerSchema,
  tasksWorkspaceTokenRepositoriesAnswerSchema,
  type WorkspacePeopleFollow,
} from "@repo/features/tasks-view";
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
} from "@repo/features/terminal-view";
import { isSignInFailure } from "@repo/features/words";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  type GatewayMethod,
  gatewayEventReader,
} from "@repo/gateway";
import type {
  AppSettingField,
  AppSettingValue,
  Experiment,
  SettingsResetScope,
} from "@repo/settings";
import type { AppSettings, SettingsUpdateResult } from "@repo/settings/wire";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Effect, type Schema as EffectSchema, ErrorReporter, Option, Result } from "effect";
import { Base64 } from "effect/encoding";
import type {
  AppAccessSlice,
  AppAccountPreferences,
  AppAgentOrigins,
  AppAutomationReads,
  AppBrowserTabs,
  AppChapters,
  AppDescriptionComments,
  AppDescriptionDocuments,
  AppDevicePresences,
  AppGitHubTokens,
  AppHistories,
  AppHolderInboxes,
  AppHostRead,
  AppHosts,
  AppInboxItems,
  AppInstalledSkills,
  AppIntegrations,
  AppIntegrationTools,
  AppLinkStandings,
  AppMcpClients,
  AppMemories,
  AppModels,
  AppPages,
  AppProviderKeys,
  AppPullRequestParts,
  AppRepositoryLists,
  AppSlackChannels,
  AppThisMacHosts,
  AppTokenRepositories,
  AppTranscripts,
  AppWorkspaceIntegrations,
  AppWorkspaceInvitations,
  AppWorkspaceMembers,
  AppWorkspacePhotos,
  AppWorkspaceTools,
  SessionReplayState,
} from "./app-state.js";
import {
  type MacCommandAnswer,
  type MacCommandAsk,
  macCommandAsksSchema,
} from "./mac-command-ask.js";

export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessionReplay: SessionReplayState;
  access: AppAccessSlice;
}

interface HostSettingsChange {
  settings: AppSettings;
  reporter?: string;
}

export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  answerMacCommand(answer: MacCommandAnswer): Effect.Effect<boolean>;
  onThisMacHostChanged(listener: (held: AppThisMacHosts) => void): () => void;
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  resetSettings(
    scope: SettingsResetScope,
    kept: readonly AppSettingField[],
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  setExperiment(
    experiment: Experiment,
    on: boolean,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  accountSnapshot(): Effect.Effect<Option.Option<AccountSnapshot>>;
  beginSignIn(provider: AccountProvider): Effect.Effect<SignInAnswer>;
  signInAgain(provider: AccountProvider): Effect.Effect<boolean>;
  cancelSignIn(): Effect.Effect<void>;
  signOut(): Effect.Effect<AccountSnapshot>;
  deleteAccount(): Effect.Effect<AccountSnapshot>;
  supportAccess(grant: boolean): Effect.Effect<SupportAccessAnswerWire>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  tasksRefresh(): Effect.Effect<void>;
  tasksResync(): Effect.Effect<void>;
  tasksRegained(): Effect.Effect<void>;
  tasksOfflineRefusedClear(): Effect.Effect<void>;
  workspacesRefresh(): Effect.Effect<void>;
  tasksOpen(taskId: string): Effect.Effect<boolean>;
  tasksClose(): Effect.Effect<void>;
  tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
  tasksDelete(taskId: string): Effect.Effect<boolean>;
  tasksRename(params: TasksRenameParams): Effect.Effect<boolean>;
  tasksSetStanding(params: TasksSetStandingParams): Effect.Effect<boolean>;
  tasksPin(params: TasksPinParams): Effect.Effect<boolean>;
  tasksMarkRead(params: TasksMarkReadParams): Effect.Effect<boolean>;
  tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
  tasksWriteSection(params: TasksWriteSectionParams): Effect.Effect<boolean>;
  tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  tasksRepositoriesRetry(params: TasksRepositoriesParams): Effect.Effect<void>;
  onRepositoryListsChanged(listener: (held: AppRepositoryLists) => void): () => void;
  tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
  tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
  tasksBlock(params: TasksBlockParams): Effect.Effect<TasksBlockAnswer>;
  tasksSetParent(params: TasksSetParentParams): Effect.Effect<TasksSetParentAnswer>;
  tasksChangeRelation(params: TasksChangeRelationParams): Effect.Effect<TasksChangeRelationAnswer>;
  tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
  tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
  tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
  tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
  tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  onLinkStandingsChanged(listener: (held: AppLinkStandings) => void): () => void;
  tasksBrowserTabOpen(params: TasksBrowserTabOpenParams): Effect.Effect<TasksBrowserTabOpenAnswer>;
  tasksFind(params: TasksFindParams): Effect.Effect<TasksFindAnswer>;
  tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
  tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
  tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
  tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
  tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
  tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
  onPagesChanged(listener: (held: AppPages) => void): () => void;
  tasksDocumentFollow(scope: TaskDocumentFollow): Effect.Effect<void>;
  tasksDocumentUnfollow(scope: TaskDocumentFollow): Effect.Effect<void>;
  tasksDocumentRetry(scope: TaskDocumentFollow): Effect.Effect<void>;
  onDescriptionDocumentsChanged(listener: (held: AppDescriptionDocuments) => void): () => void;
  tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  onBrowserTabsChanged(listener: (held: AppBrowserTabs) => void): () => void;
  tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  tasksHistoryRetry(scope: TaskHistoryFollow): Effect.Effect<void>;
  onHistoriesChanged(listener: (held: AppHistories) => void): () => void;
  tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
  tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
  tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
  onDescriptionCommentsChanged(listener: (held: AppDescriptionComments) => void): () => void;
  tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
  tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  integrationsFollow(): Effect.Effect<void>;
  integrationsUnfollow(): Effect.Effect<void>;
  integrationsRetry(): Effect.Effect<void>;
  onIntegrationsChanged(listener: (held: AppIntegrations) => void): () => void;
  integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
  integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
  integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
  integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
  onIntegrationToolsChanged(listener: (held: AppIntegrationTools) => void): () => void;
  integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
  mcpClientsFollow(): Effect.Effect<void>;
  mcpClientsUnfollow(): Effect.Effect<void>;
  mcpClientsRetry(): Effect.Effect<void>;
  onMcpClientsChanged(listener: (held: AppMcpClients) => void): () => void;
  mcpClientsRevoke(params: McpClientRevokeParams): Effect.Effect<McpClientsView>;
  githubConnect(): Effect.Effect<TasksGitHubPageAnswer>;
  githubDisconnect(): Effect.Effect<TasksGitHubDisconnectAnswer>;
  adminRead(params: AdminReadParams): Effect.Effect<AdminReadAnswer>;
  adminFavorite(params: AdminFavoriteParams): Effect.Effect<boolean>;
  workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
  workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
  workspacePhotoSet(params: TasksWorkspacePhotoSetParams): Effect.Effect<TasksWorkspaceAnswer>;
  workspaceSlugSet(params: TasksWorkspaceSlugSetParams): Effect.Effect<TasksWorkspaceAnswer>;
  workspaceGitHubConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  workspaceGitHubDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
  workspaceSentryInstall(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  workspaceSentryDisconnect(
    params: TasksWorkspaceSentryDisconnectParams,
  ): Effect.Effect<TasksWorkspaceSentryAnswer>;
  workspaceSlackBotConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  workspaceSlackBotDisconnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  workspaceSlackBotNotifications(
    params: TasksWorkspaceSlackBotNotificationsParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  workspaceSlackBotRepository(
    params: TasksWorkspaceSlackBotRepositoryParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  workspaceSlackBotChannel(
    params: TasksWorkspaceSlackBotChannelParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  workspaceIntegrationsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  workspaceIntegrationsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  workspaceIntegrationsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
  onWorkspaceIntegrationsChanged(listener: (held: AppWorkspaceIntegrations) => void): () => void;
  workspaceSlackChannelsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  workspaceSlackChannelsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  workspaceSlackChannelsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
  onSlackChannelsChanged(listener: (held: AppSlackChannels) => void): () => void;
  workspaceMembersFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  workspaceMembersUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  workspaceMembersRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  onWorkspaceMembersChanged(listener: (held: AppWorkspaceMembers) => void): () => void;
  workspaceInvitationsFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  workspaceInvitationsUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  workspaceInvitationsRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  onWorkspaceInvitationsChanged(listener: (held: AppWorkspaceInvitations) => void): () => void;
  onWorkspacePhotosChanged(listener: (held: AppWorkspacePhotos) => void): () => void;
  workspaceTokenRepositoriesFollow(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  workspaceTokenRepositoriesUnfollow(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  workspaceTokenRepositoriesRetry(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  onTokenRepositoriesChanged(listener: (held: AppTokenRepositories) => void): () => void;
  workspaceTokenRepositorySet(
    params: TasksWorkspaceTokenRepositorySetParams,
  ): Effect.Effect<TasksWorkspaceTokenRepositoriesAnswer>;
  workspaceMemberRemove(
    params: TasksWorkspaceMemberRemoveParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  workspaceMemberRole(
    params: TasksWorkspaceMemberRoleParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  workspaceTransfer(
    params: TasksWorkspaceTransferParams,
  ): Effect.Effect<TasksWorkspaceMembersAnswer>;
  workspaceLeave(params: TasksWorkspaceLeaveParams): Effect.Effect<TasksWorkspaceLeaveAnswer>;
  workspaceInvite(
    params: TasksWorkspaceInviteParams,
  ): Effect.Effect<TasksWorkspaceInvitationAnswer>;
  workspaceInvitationCancel(
    params: TasksWorkspaceInvitationCancelParams,
  ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
  agentModelsFollow(): Effect.Effect<void>;
  agentModelsUnfollow(): Effect.Effect<void>;
  agentModelsRetry(): Effect.Effect<void>;
  onModelsChanged(listener: (held: AppModels) => void): () => void;
  agentDefaultWrite(choice: ModelChoice): Effect.Effect<AgentDefaultAnswer>;
  hostsFollow(): Effect.Effect<void>;
  hostsUnfollow(): Effect.Effect<void>;
  hostsRetry(): Effect.Effect<void>;
  onHostsChanged(listener: (held: AppHosts) => void): () => void;
  hostsPresenceFollow(): Effect.Effect<void>;
  hostsPresenceUnfollow(): Effect.Effect<void>;
  hostsPresenceRefresh(): Effect.Effect<void>;
  onDevicePresenceChanged(listener: (held: AppDevicePresences) => void): () => void;
  hostsRemove(id: string): Effect.Effect<HostDoneAnswerView>;
  hostsThisMacSet(asked: ThisMacHostSetParams): Effect.Effect<HostDoneAnswerView>;
  hostsPairingRead(code: string): Effect.Effect<HostPairingView>;
  hostsPairingApprove(code: string): Effect.Effect<HostPairingApproveView>;
  hostsPairingDeny(code: string): Effect.Effect<HostPairingDenyView>;
  agentList(params: AgentListParams): Effect.Effect<AgentListAnswer>;
  agentWorkspaceList(params: AgentWorkspaceListParams): Effect.Effect<AgentListAnswer>;
  agentStart(params: AgentStartParams): Effect.Effect<AgentAgentAnswer>;
  agentMessages(params: AgentMessagesParams): Effect.Effect<AgentMessagesAnswerView>;
  agentMessage(params: AgentMessageParams): Effect.Effect<AgentAgentAnswer>;
  agentChoose(params: AgentChooseParams): Effect.Effect<AgentAgentAnswer>;
  agentRename(params: AgentRenameParams): Effect.Effect<AgentAgentAnswer>;
  agentServers(params: AgentServersParams): Effect.Effect<AgentAgentAnswer>;
  agentAddRepository(params: AgentAddRepositoryParams): Effect.Effect<AgentAgentAnswer>;
  agentQueue(params: AgentQueueParams): Effect.Effect<AgentQueueAnswerView>;
  agentStop(params: AgentStopParams): Effect.Effect<AgentAgentAnswer>;
  agentRewind(params: AgentRewindParams): Effect.Effect<AgentAgentAnswer>;
  agentArchive(params: AgentArchiveParams): Effect.Effect<AgentAgentAnswer>;
  agentDelete(params: AgentStopParams): Effect.Effect<AgentDeleteAnswerView>;
  agentPin(params: AgentPinParams): Effect.Effect<AgentAgentAnswer>;
  agentMarkRead(params: AgentMarkReadParams): Effect.Effect<AgentAgentAnswer>;
  agentPage(params: AgentPageParams): Effect.Effect<AgentPageAnswerView>;
  agentOriginFollow(params: AgentPageParams): Effect.Effect<void>;
  agentOriginUnfollow(params: AgentPageParams): Effect.Effect<void>;
  agentOriginRetry(params: AgentPageParams): Effect.Effect<void>;
  onAgentOriginsChanged(listener: (held: AppAgentOrigins) => void): () => void;
  automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
  automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
  automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
  automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
  automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
  automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
  automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
  automationsRetry(scope: AutomationFollow): Effect.Effect<void>;
  onAutomationsChanged(listener: (held: Partial<AppAutomationReads>) => void): () => void;
  pullRequestPartFollow(params: PullRequestPartParams): Effect.Effect<void>;
  pullRequestPartUnfollow(params: PullRequestPartParams): Effect.Effect<void>;
  pullRequestPartRetry(params: PullRequestPartParams): Effect.Effect<void>;
  onPullRequestPartsChanged(listener: (held: Partial<AppPullRequestParts>) => void): () => void;
  chaptersFollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  chaptersUnfollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  chaptersRetry(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  onChaptersChanged(listener: (held: AppChapters) => void): () => void;
  pullRequestChaptersGenerate(
    params: PullRequestChaptersParams,
  ): Effect.Effect<PullRequestChaptersAnswerView>;
  installedSkillsFollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  installedSkillsUnfollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  installedSkillsRetry(params: InstalledSkillFollowParams): Effect.Effect<void>;
  onInstalledSkillsChanged(listener: (held: AppInstalledSkills) => void): () => void;
  installedSkillsRead(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillContentView>;
  installedSkillsPreview(
    params: InstalledSkillPreviewParams,
  ): Effect.Effect<InstalledSkillPreviewView>;
  installedSkillsInstall(
    params: InstalledSkillInstallParams,
  ): Effect.Effect<InstalledSkillInstallView>;
  installedSkillsRemove(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillRemovedView>;
  agentChanges(params: AgentPullRequestReadParams): Effect.Effect<AgentChangesAnswerView>;
  agentGitHubImage(params: AgentGitHubImageParams): Effect.Effect<AgentGitHubImageView>;
  agentPullRequestAction(
    params: AgentPullRequestActionParams,
  ): Effect.Effect<AgentPullRequestWriteAnswerView>;
  agentWorkspaceToolsFollow(params: AgentPullRequestParams): Effect.Effect<void>;
  agentWorkspaceToolsUnfollow(params: AgentPullRequestParams): Effect.Effect<void>;
  agentWorkspaceToolsRetry(params: AgentPullRequestParams): Effect.Effect<void>;
  onWorkspaceToolsChanged(listener: (held: AppWorkspaceTools) => void): () => void;
  providerKeysFollow(): Effect.Effect<void>;
  providerKeysUnfollow(): Effect.Effect<void>;
  providerKeysRetry(): Effect.Effect<void>;
  onProviderKeysChanged(listener: (held: AppProviderKeys) => void): () => void;
  providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
  providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
  providerKeyForAgents(params: ProviderKeyForAgentsParams): Effect.Effect<ProviderKeysAnswerView>;
  chatGptDeviceStart(): Effect.Effect<ChatGptDeviceStartAnswerView>;
  chatGptDeviceWait(params: ChatGptDeviceWaitParams): Effect.Effect<ChatGptDevicePollAnswerView>;
  chatGptDeviceCancel(params: ChatGptDeviceLoginParams): Effect.Effect<ChatGptDevicePollAnswerView>;
  githubTokenFollow(): Effect.Effect<void>;
  githubTokenUnfollow(): Effect.Effect<void>;
  githubTokenRetry(): Effect.Effect<void>;
  onGitHubTokenChanged(listener: (held: AppGitHubTokens) => void): () => void;
  githubTokenSave(params: GitHubTokenSaveParams): Effect.Effect<GitHubTokenAnswerView>;
  githubTokenRemove(): Effect.Effect<GitHubTokenAnswerView>;
  memoriesFollow(params: MemoriesFollowParams): Effect.Effect<void>;
  memoriesUnfollow(params: MemoriesFollowParams): Effect.Effect<void>;
  memoriesRetry(params: MemoriesFollowParams): Effect.Effect<void>;
  onMemoriesChanged(listener: (held: AppMemories) => void): () => void;
  memoryForget(params: MemoryForgetParams): Effect.Effect<MemoriesAnswerView>;
  dictationTranscribe(
    params: DictationTranscribeParams,
  ): Effect.Effect<DictationTranscribeAnswerView>;
  agentInboxFollow(scope: AgentInboxScope): Effect.Effect<void>;
  agentInboxUnfollow(scope: AgentInboxScope): Effect.Effect<void>;
  agentInboxRetry(scope: AgentInboxScope): Effect.Effect<void>;
  onHolderInboxesChanged(listener: (held: AppHolderInboxes) => void): () => void;
  agentInboxAnswer(params: AgentInboxAnswerParams): Effect.Effect<AgentInboxAnsweredView>;
  agentInboxClose(params: AgentInboxCloseParams): Effect.Effect<AgentInboxAnsweredView>;
  agentInboxMessage(params: AgentInboxMessageParams): Effect.Effect<AgentInboxMessagedView>;
  agentInboxStart(params: AgentInboxStartParams): Effect.Effect<AgentInboxMessagedView>;
  agentInboxReadState(params: AgentInboxReadStateParams): Effect.Effect<AgentInboxReadStateView>;
  agentInboxRemind(params: AgentInboxRemindParams): Effect.Effect<AgentInboxReadStateView>;
  agentInboxItemHome(params: AgentInboxItemHomeParams): Effect.Effect<AgentInboxItemHomeView>;
  agentInboxReadAll(params: AgentInboxReadAllParams): Effect.Effect<AgentInboxReadAllView>;
  agentAccountInboxFollow(): Effect.Effect<void>;
  agentAccountInboxUnfollow(): Effect.Effect<void>;
  onAccountInboxChanged(listener: (answer: AgentAccountInboxAnswerView) => void): () => void;
  agentInboxItemsRetry(): Effect.Effect<void>;
  onInboxItemsChanged(listener: (read: AppHostRead<AppInboxItems>) => void): () => void;
  agentPreferencesRetry(): Effect.Effect<void>;
  onAccountPreferencesChanged(listener: (held: AppAccountPreferences) => void): () => void;
  transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  transcriptRetry(transcript: AgentTranscriptKey): Effect.Effect<void>;
  transcriptOlder(params: AgentTranscriptOlderParams): Effect.Effect<AgentTranscriptOlderAnswer>;
  onTranscriptsChanged(listener: (held: AppTranscripts) => void): () => void;
  agentInboxAttachment(params: AgentInboxAttachmentParams): Effect.Effect<AgentInboxAttachmentView>;
  agentPicture(params: AgentPictureParams): Effect.Effect<AgentInboxAttachmentView>;
  agentPart(params: AgentPartParams): Effect.Effect<AgentPartView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onAccountAccessChanged(listener: (access: AppAccessSlice) => void): () => void;
  onSessionReplayChanged(listener: (replay: SessionReplayState) => void): () => void;
  onTasksChanged(listener: (view: TasksView) => void): () => void;
  onMacCommandAsksChanged(listener: (asks: readonly MacCommandAsk[]) => void): () => void;
  onOfflineRefusedChanged(listener: (count: number) => void): () => void;
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
  terminalWake(): Effect.Effect<void>;
  onTerminalOutput(
    listener: (output: { connectionId: string; data: Uint8Array }) => void,
  ): () => void;
  onTerminalState(listener: (state: TerminalStateEvent) => void): () => void;
  mirrorEnsure(params: { agentId: string }): Effect.Effect<string | undefined>;
  browserLiveConnect(params: {
    connectionId: string;
    agentId: string;
    tabId: string;
  }): Effect.Effect<boolean>;
  browserLiveSend(params: { connectionId: string; text: string }): Effect.Effect<void>;
  browserLiveDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  onBrowserLiveMessage(listener: (message: BrowserLiveMessageEvent) => void): () => void;
  onBrowserLiveClosed(listener: (closed: BrowserLiveClosedEvent) => void): () => void;
  portForwardSet(params: {
    agentId: string;
    on: boolean;
  }): Effect.Effect<PortForwardingAnswer | undefined>;
  onPortForwardingChanged(listener: (forwarding: PortForwarding) => void): () => void;
}

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

function pullRequestRead(params: AgentPullRequestReadParams): AgentPullRequestReadParams {
  return params.number === undefined
    ? { agentId: params.agentId }
    : { agentId: params.agentId, number: params.number };
}

function pullRequestPart(params: PullRequestPartParams): PullRequestPartParams {
  return { part: params.part, ...pullRequestRead(params) };
}

function pullRequestChaptersRead(params: PullRequestChaptersParams): PullRequestChaptersParams {
  return params.number === undefined
    ? { agentId: params.agentId }
    : { agentId: params.agentId, number: params.number };
}

function unanswered(method: GatewayMethod, answer: GatewayCallResult): Effect.Effect<never> {
  if (answer.ok) return Effect.die(new Error(`${method} answered a shape this client cannot read`));
  const refusal = new Error(`${method} was refused: ${answer.error.message}`);
  return Effect.die(Object.assign(refusal, { [ErrorReporter.ignore]: true }));
}

const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

function answered<Value>(value: UnparsedWireValue): Value | undefined {
  return value === undefined ? undefined : (value as unknown as Value);
}

function commentsFollowParams(scope: TasksCommentsFollow): WireRecord {
  return scope.pageId === undefined
    ? { taskId: scope.taskId }
    : { taskId: scope.taskId, pageId: scope.pageId };
}

function transcriptParams(transcript: AgentTranscriptKey): WireRecord {
  const { kind, agentId, callId } = transcript;
  return callId === undefined ? { kind, agentId } : { kind, agentId, callId };
}

const AGENT_UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

const PAIRING_UNANSWERED = { failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED } as const;

const AUTOMATION_UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

const GITHUB_DISCONNECT_UNANSWERED = { failure: GITHUB_DISCONNECT_FAILURE.UNANSWERED } as const;

const ADMIN_READ_UNANSWERED = { refused: ADMIN_UNANSWERED } as const;

const INTEGRATION_UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

const MCP_CLIENTS_UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

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

  const repositoryScope = (params: TasksRepositoriesParams) =>
    params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId };

  const wireValue = <Value>(value: Value | undefined) =>
    value !== undefined ? { value: carried(value) } : undefined;

  const integrationTarget = (params: IntegrationProviderParams) => ({
    provider: params.provider,
    ...(params.connection !== undefined ? { connection: params.connection } : undefined),
    ...(params.add !== undefined ? { add: params.add } : undefined),
  });

  return {
    integrationsFollow: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW, {})),
    integrationsUnfollow: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW, {})),
    integrationsRetry: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_RETRY, {})),
    onIntegrationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INTEGRATIONS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppIntegrations>(payload) : undefined),
        listener,
      ),
    integrationsConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, integrationTarget(params)),
        answerOf(integrationConnectViewSchema, INTEGRATION_UNANSWERED),
      ),
    integrationsToolsFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, integrationTarget(params))),
    integrationsToolsUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_UNFOLLOW, integrationTarget(params))),
    integrationsToolsRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_RETRY, integrationTarget(params))),
    onIntegrationToolsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INTEGRATION_TOOLS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppIntegrationTools>(payload) : undefined),
        listener,
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
    mcpClientsFollow: () => fire(client.call(GATEWAY_METHOD.MCP_CLIENTS_FOLLOW, {})),
    mcpClientsUnfollow: () => fire(client.call(GATEWAY_METHOD.MCP_CLIENTS_UNFOLLOW, {})),
    mcpClientsRetry: () => fire(client.call(GATEWAY_METHOD.MCP_CLIENTS_RETRY, {})),
    onMcpClientsChanged: (listener) =>
      on(
        GATEWAY_EVENT.MCP_CLIENTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppMcpClients>(payload) : undefined),
        listener,
      ),
    mcpClientsRevoke: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MCP_CLIENTS_REVOKE, { clientId: params.clientId }),
        answerOf(mcpClientsViewSchema, MCP_CLIENTS_UNANSWERED),
      ),
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        Option.fromUndefinedOr(answered<HostBootstrap>(record(answer))),
      ),
    onThisMacHostChanged: (listener) =>
      on(
        GATEWAY_EVENT.THIS_MAC_HOST_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppThisMacHosts>(payload) : undefined),
        listener,
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
    supportAccess: (grant) =>
      Effect.flatMap(client.call(GATEWAY_METHOD.ACCOUNT_SUPPORT_ACCESS, { grant }), (answer) => {
        const until = record(answer)?.supportAccessUntil;
        return until === null || isWireNumber(until)
          ? Effect.succeed({ supportAccessUntil: until })
          : unanswered(GATEWAY_METHOD.ACCOUNT_SUPPORT_ACCESS, answer);
      }),
    recordEvent: (name, properties) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        fire(
          client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
            event: { name, at, properties: carried(properties) },
          }),
        ),
      ),
    tasksRefresh: () => fire(client.call(GATEWAY_METHOD.TASKS_REFRESH)),
    tasksResync: () => fire(client.call(GATEWAY_METHOD.TASKS_RESYNC)),
    tasksRegained: () => fire(client.call(GATEWAY_METHOD.TASKS_REGAINED)),
    tasksOfflineRefusedClear: () => fire(client.call(GATEWAY_METHOD.TASKS_OFFLINE_REFUSED_CLEAR)),
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
    tasksMarkRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_MARK_READ, {
          taskId: params.taskId,
          readMark: params.readMark,
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
    tasksRepositoriesFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, repositoryScope(params))),
    tasksRepositoriesUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_UNFOLLOW, repositoryScope(params))),
    tasksRepositoriesRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_RETRY, repositoryScope(params))),
    onRepositoryListsChanged: (listener) =>
      on(
        GATEWAY_EVENT.REPOSITORY_LISTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppRepositoryLists>(payload) : undefined),
        listener,
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
    tasksLinkStandingFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, {
          workspaceId: params.workspaceId,
          address: params.address,
        }),
      ),
    tasksLinkStandingUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TASKS_LINK_STANDING_UNFOLLOW, {
          workspaceId: params.workspaceId,
          address: params.address,
        }),
      ),
    onLinkStandingsChanged: (listener) =>
      on(
        GATEWAY_EVENT.LINK_STANDINGS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppLinkStandings>(payload) : undefined),
        listener,
      ),
    tasksBrowserTabOpen: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_BROWSER_TAB_OPEN, {
          agentId: params.agentId,
          address: params.address,
        }),
        answerOf(tasksBrowserTabOpenAnswerSchema, TASK_UNANSWERED),
      ),
    tasksFind: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_FIND, {
          workspace: params.workspace,
          number: params.number,
        }),
        answerOf(tasksFindAnswerSchema, TASK_UNANSWERED),
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
    tasksCommentsFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, commentsFollowParams(scope))),
    tasksCommentsUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_COMMENTS_UNFOLLOW, commentsFollowParams(scope))),
    tasksCommentsRetry: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_COMMENTS_RETRY, commentsFollowParams(scope))),
    onDescriptionCommentsChanged: (listener) =>
      on(
        GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppDescriptionComments>(payload) : undefined),
        listener,
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
    onPagesChanged: (listener) =>
      on(
        GATEWAY_EVENT.PAGES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppPages>(payload) : undefined),
        listener,
      ),
    tasksDocumentFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW, { taskId: scope.taskId })),
    tasksDocumentUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW, { taskId: scope.taskId })),
    tasksDocumentRetry: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_DOCUMENT_RETRY, { taskId: scope.taskId })),
    onDescriptionDocumentsChanged: (listener) =>
      on(
        GATEWAY_EVENT.DESCRIPTION_DOCUMENTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppDescriptionDocuments>(payload) : undefined),
        listener,
      ),
    tasksBrowserTabsFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW, scope)),
    tasksBrowserTabsUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW, scope)),
    onBrowserTabsChanged: (listener) =>
      on(
        GATEWAY_EVENT.BROWSER_TABS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppBrowserTabs>(payload) : undefined),
        listener,
      ),
    tasksHistoryFollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: scope.taskId })),
    tasksHistoryUnfollow: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW, { taskId: scope.taskId })),
    tasksHistoryRetry: (scope) =>
      fire(client.call(GATEWAY_METHOD.TASKS_HISTORY_RETRY, { taskId: scope.taskId })),
    onHistoriesChanged: (listener) =>
      on(
        GATEWAY_EVENT.HISTORIES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppHistories>(payload) : undefined),
        listener,
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
    workspaceSlugSet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLUG_SET, {
          workspaceId: params.workspaceId,
          slug: params.slug,
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
    workspaceSlackBotConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CONNECT, {
          workspaceId: params.workspaceId,
        }),
        answerOf(tasksWorkspaceSlackBotAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSlackBotDisconnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_DISCONNECT, {
          workspaceId: params.workspaceId,
        }),
        answerOf(tasksWorkspaceSlackBotAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSlackBotNotifications: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_NOTIFICATIONS, {
          workspaceId: params.workspaceId,
          notifications: params.notifications,
        }),
        answerOf(tasksWorkspaceSlackBotAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSlackBotRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_REPOSITORY, {
          workspaceId: params.workspaceId,
          repository: params.repository,
        }),
        answerOf(tasksWorkspaceSlackBotAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceSlackBotChannel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CHANNEL, { ...params }),
        answerOf(tasksWorkspaceSlackBotAnswerSchema, WORKSPACE_UNANSWERED),
      ),
    workspaceIntegrationsFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_FOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceIntegrationsUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_UNFOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceIntegrationsRetry: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_RETRY, {
          workspaceId: params.workspaceId,
        }),
      ),
    onWorkspaceIntegrationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_INTEGRATIONS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppWorkspaceIntegrations>(payload) : undefined),
        listener,
      ),
    workspaceSlackChannelsFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_FOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceSlackChannelsUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_UNFOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceSlackChannelsRetry: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_RETRY, {
          workspaceId: params.workspaceId,
        }),
      ),
    onSlackChannelsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SLACK_CHANNELS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppSlackChannels>(payload) : undefined),
        listener,
      ),
    workspaceMembersFollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: scope.workspaceId }),
      ),
    workspaceMembersUnfollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS_UNFOLLOW, { workspaceId: scope.workspaceId }),
      ),
    workspaceMembersRetry: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS_RETRY, { workspaceId: scope.workspaceId }),
      ),
    onWorkspaceMembersChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_MEMBERS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppWorkspaceMembers>(payload) : undefined),
        listener,
      ),
    workspaceInvitationsFollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, {
          workspaceId: scope.workspaceId,
        }),
      ),
    workspaceInvitationsUnfollow: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW, {
          workspaceId: scope.workspaceId,
        }),
      ),
    workspaceInvitationsRetry: (scope) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_RETRY, {
          workspaceId: scope.workspaceId,
        }),
      ),
    onWorkspaceInvitationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppWorkspaceInvitations>(payload) : undefined),
        listener,
      ),
    onWorkspacePhotosChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppWorkspacePhotos>(payload) : undefined),
        listener,
      ),
    workspaceTokenRepositoriesFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_FOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceTokenRepositoriesUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_UNFOLLOW, {
          workspaceId: params.workspaceId,
        }),
      ),
    workspaceTokenRepositoriesRetry: (params) =>
      fire(
        client.call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_RETRY, {
          workspaceId: params.workspaceId,
        }),
      ),
    onTokenRepositoriesChanged: (listener) =>
      on(
        GATEWAY_EVENT.TOKEN_REPOSITORIES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppTokenRepositories>(payload) : undefined),
        listener,
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
    tasksSetParent: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_SET_PARENT, {
          taskId: params.taskId,
          parentTaskId: params.parentTaskId,
        }),
        answerOf(tasksSetParentAnswerSchema, TASK_UNANSWERED),
      ),
    tasksChangeRelation: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_CHANGE_RELATION, {
          taskId: params.taskId,
          relation: params.relation,
        }),
        answerOf(tasksChangeRelationAnswerSchema, TASK_UNANSWERED),
      ),
    tasksEdit: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_EDIT, { taskId: params.taskId, edit: params.edit }),
        answerOf(tasksEditAnswerSchema, TASK_UNANSWERED),
      ),
    tasksStart: (request) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_START, request),
        answerOf(tasksStartAnswerSchema, TASK_UNANSWERED),
      ),
    agentModelsFollow: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_FOLLOW, {})),
    agentModelsUnfollow: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_UNFOLLOW, {})),
    agentModelsRetry: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_RETRY, {})),
    onModelsChanged: (listener) =>
      on(
        GATEWAY_EVENT.MODELS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppModels>(payload) : undefined),
        listener,
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
    hostsFollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_FOLLOW, {})),
    hostsUnfollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_UNFOLLOW, {})),
    hostsRetry: () => fire(client.call(GATEWAY_METHOD.HOSTS_RETRY, {})),
    onHostsChanged: (listener) =>
      on(
        GATEWAY_EVENT.HOSTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppHosts>(payload) : undefined),
        listener,
      ),
    hostsPresenceFollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_FOLLOW, {})),
    hostsPresenceUnfollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_UNFOLLOW, {})),
    hostsPresenceRefresh: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_REFRESH, {})),
    onDevicePresenceChanged: (listener) =>
      on(
        GATEWAY_EVENT.DEVICE_PRESENCE_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppDevicePresences>(payload) : undefined),
        listener,
      ),
    hostsRemove: (id) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_REMOVE, { id }),
        answerOf(hostDoneAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsThisMacSet: (asked) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_THIS_MAC_SET, { ...asked }),
        answerOf(hostDoneAnswerViewSchema, AGENT_UNANSWERED),
      ),
    hostsPairingRead: (code) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_PAIRING_READ, { code }),
        answerOf(hostPairingViewSchema, PAIRING_UNANSWERED),
      ),
    hostsPairingApprove: (code) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_PAIRING_APPROVE, { code }),
        answerOf(hostPairingApproveViewSchema, PAIRING_UNANSWERED),
      ),
    hostsPairingDeny: (code) =>
      Effect.map(
        client.call(GATEWAY_METHOD.HOSTS_PAIRING_DENY, { code }),
        answerOf(hostPairingDenyViewSchema, PAIRING_UNANSWERED),
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
    agentAddRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_ADD_REPOSITORY, {
          agentId: params.agentId,
          addRepository: params.addRepository,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentQueue: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_QUEUE, {
          agentId: params.agentId,
          change: params.change,
        }),
        answerOf(agentQueueAnswerViewSchema, AGENT_UNANSWERED),
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
    agentMarkRead: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_MARK_READ, {
          agentId: params.agentId,
          readMark: params.readMark,
        }),
        answerOf(agentAgentAnswerSchema, AGENT_UNANSWERED),
      ),
    agentPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_PAGE, { agentId: params.agentId }),
        answerOf(agentPageAnswerViewSchema, AGENT_UNANSWERED),
      ),
    agentOriginFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ORIGIN_FOLLOW, { agentId: params.agentId })),
    agentOriginUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ORIGIN_UNFOLLOW, { agentId: params.agentId })),
    agentOriginRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ORIGIN_RETRY, { agentId: params.agentId })),
    onAgentOriginsChanged: (listener) =>
      on(
        GATEWAY_EVENT.AGENT_ORIGINS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppAgentOrigins>(payload) : undefined),
        listener,
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
    automationNewWebhookSecret: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, params),
        answerOf(automationViewSchema, AUTOMATION_UNANSWERED),
      ),
    automationsFollow: (scope) => fire(client.call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, scope)),
    automationsUnfollow: (scope) => fire(client.call(GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW, scope)),
    automationsRetry: (scope) => fire(client.call(GATEWAY_METHOD.AUTOMATIONS_RETRY, scope)),
    onAutomationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.AUTOMATIONS_CHANGED,
        (payload) =>
          isRecord(payload) ? answered<Partial<AppAutomationReads>>(payload) : undefined,
        listener,
      ),
    pullRequestPartFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_FOLLOW, pullRequestPart(params))),
    pullRequestPartUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_UNFOLLOW, pullRequestPart(params))),
    pullRequestPartRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_RETRY, pullRequestPart(params))),
    onPullRequestPartsChanged: (listener) =>
      on(
        GATEWAY_EVENT.PULL_REQUEST_PARTS_CHANGED,
        (payload) =>
          isRecord(payload) ? answered<Partial<AppPullRequestParts>>(payload) : undefined,
        listener,
      ),
    chaptersFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS_FOLLOW, {
          agentId: params.agentId,
          number: params.number,
        }),
      ),
    chaptersUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS_UNFOLLOW, {
          agentId: params.agentId,
          number: params.number,
        }),
      ),
    chaptersRetry: (params) =>
      fire(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS_RETRY, {
          agentId: params.agentId,
          number: params.number,
        }),
      ),
    onChaptersChanged: (listener) =>
      on(
        GATEWAY_EVENT.CHAPTERS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppChapters>(payload) : undefined),
        listener,
      ),
    pullRequestChaptersGenerate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_CHAPTERS_GENERATE, pullRequestChaptersRead(params)),
        answerOf(pullRequestChaptersAnswerViewSchema, AGENT_UNANSWERED),
      ),
    installedSkillsFollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_FOLLOW, { workspaceId: params.workspaceId }),
      ),
    installedSkillsUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_UNFOLLOW, { workspaceId: params.workspaceId }),
      ),
    installedSkillsRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.INSTALLED_SKILLS_RETRY, { workspaceId: params.workspaceId })),
    onInstalledSkillsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INSTALLED_SKILLS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppInstalledSkills>(payload) : undefined),
        listener,
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
    installedSkillsInstall: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, params),
        answerOf(installedSkillInstallViewSchema, INSTALLED_SKILL_UNANSWERED),
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
    agentWorkspaceToolsFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_FOLLOW, { agentId: params.agentId })),
    agentWorkspaceToolsUnfollow: (params) =>
      fire(
        client.call(GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_UNFOLLOW, { agentId: params.agentId }),
      ),
    agentWorkspaceToolsRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_RETRY, { agentId: params.agentId })),
    onWorkspaceToolsChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_TOOLS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppWorkspaceTools>(payload) : undefined),
        listener,
      ),
    providerKeysFollow: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_FOLLOW, {})),
    providerKeysUnfollow: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_UNFOLLOW, {})),
    providerKeysRetry: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_RETRY, {})),
    onProviderKeysChanged: (listener) =>
      on(
        GATEWAY_EVENT.PROVIDER_KEYS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppProviderKeys>(payload) : undefined),
        listener,
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
    chatGptDeviceStart: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHATGPT_DEVICE_START),
        answerOf(chatGptDeviceStartAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chatGptDeviceWait: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHATGPT_DEVICE_WAIT, {
          loginId: params.loginId,
          intervalSeconds: params.intervalSeconds,
        }),
        answerOf(chatGptDevicePollAnswerViewSchema, AGENT_UNANSWERED),
      ),
    chatGptDeviceCancel: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CHATGPT_DEVICE_CANCEL, { loginId: params.loginId }),
        answerOf(chatGptDevicePollAnswerViewSchema, AGENT_UNANSWERED),
      ),
    githubTokenFollow: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_FOLLOW, {})),
    githubTokenUnfollow: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_UNFOLLOW, {})),
    githubTokenRetry: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_RETRY, {})),
    onGitHubTokenChanged: (listener) =>
      on(
        GATEWAY_EVENT.GITHUB_TOKEN_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppGitHubTokens>(payload) : undefined),
        listener,
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
    memoriesFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.MEMORIES_FOLLOW, { workspaceId: params.workspaceId })),
    memoriesUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.MEMORIES_UNFOLLOW, { workspaceId: params.workspaceId })),
    memoriesRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.MEMORIES_RETRY, { workspaceId: params.workspaceId })),
    onMemoriesChanged: (listener) =>
      on(
        GATEWAY_EVENT.MEMORIES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppMemories>(payload) : undefined),
        listener,
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
    agentInboxRetry: (scope) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_INBOX_RETRY, { kind: scope.kind, id: scope.id })),
    onHolderInboxesChanged: (listener) =>
      on(
        GATEWAY_EVENT.HOLDER_INBOXES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppHolderInboxes>(payload) : undefined),
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
          ...(params.text === undefined ? undefined : { text: params.text }),
          ...(params.attachments === undefined ? undefined : { attachments: params.attachments }),
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
    agentInboxRemind: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_REMIND, {
          itemId: params.itemId,
          until: params.until,
        }),
        answerOf(agentInboxReadStateViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxItemHome: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_ITEM_HOME, { itemId: params.itemId }),
        answerOf(agentInboxItemHomeViewSchema, AGENT_UNANSWERED),
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
    agentPreferencesRetry: () => fire(client.call(GATEWAY_METHOD.AGENTS_PREFERENCES_RETRY, {})),
    onAccountPreferencesChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_PREFERENCES_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppAccountPreferences>(payload) : undefined),
        listener,
      ),
    onInboxItemsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INBOX_ITEMS_CHANGED,
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
    transcriptRetry: (transcript) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_RETRY, transcriptParams(transcript))),
    onTranscriptsChanged: (listener) =>
      on(
        GATEWAY_EVENT.TRANSCRIPTS_CHANGED,
        (payload) => (isRecord(payload) ? answered<AppTranscripts>(payload) : undefined),
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
                ...(isWireNumber(payload.supportAccessUntil)
                  ? { supportAccessUntil: payload.supportAccessUntil }
                  : undefined),
              }
            : undefined,
        listener,
      ),
    onOfflineRefusedChanged: (listener) =>
      on(
        GATEWAY_EVENT.OFFLINE_REFUSED_CHANGED,
        (payload) => (isRecord(payload) && isWireNumber(payload.count) ? payload.count : undefined),
        listener,
      ),
    onTasksChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_CHANGED,
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
    mirrorEnsure: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MIRRORS_ENSURE, { agentId: params.agentId }),
        (answer) => {
          const folder = record(answer)?.folder;
          return typeof folder === "string" ? folder : undefined;
        },
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
    portForwardSet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: params.agentId, on: params.on }),
        answerOf(portForwardingAnswerSchema, undefined),
      ),
    onPortForwardingChanged: (listener) =>
      on(
        GATEWAY_EVENT.PORT_FORWARDS_CHANGED,
        (payload) => {
          const read = readEither(portForwardingSchema)(payload);
          return Result.isSuccess(read) ? { forwarding: read.success } : undefined;
        },
        ({ forwarding }) => listener(forwarding),
      ),
    onSessionReplayChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSION_REPLAY_CHANGED,
        (payload): SessionReplayState | undefined =>
          isRecord(payload) && isWireBoolean(payload.permitted)
            ? {
                permitted: payload.permitted,
                ...(isWireString(payload.accountId) ? { accountId: payload.accountId } : undefined),
                ...(isWireString(payload.name) ? { name: payload.name } : undefined),
                ...(isWireString(payload.email) ? { email: payload.email } : undefined),
              }
            : undefined,
        listener,
      ),
  };
}
