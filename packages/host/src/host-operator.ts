import type { AccountProvider, AccountSnapshot, SignInAnswer } from "@repo/credentials/snapshot";
import { WORKSPACE_CALL_FAILURE } from "@repo/features";
import type { SupportAccessAnswerWire } from "@repo/features/account-wire";
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
  type AgentInboxCloseReleasedView,
  type AgentInboxCloseReleaseParams,
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
  agentInboxCloseReleasedViewSchema,
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
  type HostDoneAnswerView,
  hostDoneAnswerViewSchema,
  type MemoriesFollowParams,
  type PullRequestPartParams,
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
  TASK_CALL_FAILURE,
  type TaskBrowserTabsFollow,
  type TaskDocumentFollow,
  type TaskHistoryFollow,
  type TaskPagesFollow,
  type TasksCommentsFollow,
  type TasksLinkStandingParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksRepositoriesParams,
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
  tasksPageAnswerSchema,
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
  sessionReplay: SessionReplayState;
  /** What the signed-in account may open in the app, as the host last read it. */
  access: AppAccessSlice;
}

interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  /** The developer's answer to one command an agent asked to run on this Mac; whether the ask still waited. */
  answerMacCommand(answer: MacCommandAnswer): Effect.Effect<boolean>;
  /** Which machine This Mac is and the device its host's record names, held by the host for the session, whole, each time it moves; never on a platform with no This Mac. */
  onThisMacHostChanged(listener: (held: AppThisMacHosts) => void): () => void;
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
  /** The member's grant of support access granted for seven days, or revoked: when it then runs out, or null. */
  supportAccess(grant: boolean): Effect.Effect<SupportAccessAnswerWire>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Mac woke or unlocked: the host follows the task list again from a fresh seal. */
  tasksResync(): Effect.Effect<void>;
  /** The app reaches the service again: the host asks every read a window holds again, and follows the task list again from a fresh seal. */
  tasksRegained(): Effect.Effect<void>;
  /** The account's workspaces read again, where the host's last read is a minute old. */
  workspacesRefresh(): Effect.Effect<void>;
  /** The repositories the account reaches in one workspace, or in every one, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onRepositoryListsChanged`. */
  tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** One workspace's repositories let go by the windows. */
  tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** One workspace's held repositories asked again at once, as Try again asks; done once the ask has landed. */
  tasksRepositoriesRetry(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** Every workspace's repositories the host holds for the windows, whole, each time any of them moves. */
  onRepositoryListsChanged(listener: (held: AppRepositoryLists) => void): () => void;
  /** What GitHub holds of the page a link names, held for the windows from now until let go and asked again as a window comes forward; what it holds is heard through `onLinkStandingsChanged`. */
  tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  /** One link's standing let go by the windows. */
  tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  /** Every link's standing the host holds for the windows, whole, each time any of them moves. */
  onLinkStandingsChanged(listener: (held: AppLinkStandings) => void): () => void;
  /** One version of one page of a task with its HTML, for the frame that draws it; or that the service did not answer. */
  tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
  /** One plan's or agent's pages held followed for the windows from now until let go, and a while after among those let go lately, the open task's among them; what they hold is heard through `onPagesChanged`. */
  tasksPagesFollow(scope: TaskPagesFollow): Effect.Effect<void>;
  /** One plan's or agent's pages let go by the windows: they stay followed among those let go lately until later ones push them out. */
  tasksPagesUnfollow(scope: TaskPagesFollow): Effect.Effect<void>;
  /** Every plan's or agent's pages the host holds for the windows, whole, each time any of them moves. */
  onPagesChanged(listener: (held: AppPages) => void): () => void;
  /** One task's description held followed for the windows from now until let go, and a while after among those let go lately; what it holds is heard through `onDescriptionDocumentsChanged`. */
  tasksDocumentFollow(scope: TaskDocumentFollow): Effect.Effect<void>;
  /** One task's description let go by the windows: it stays followed among those let go lately until later ones push it out. */
  tasksDocumentUnfollow(scope: TaskDocumentFollow): Effect.Effect<void>;
  /** One task's held description read again at once, as Try again asks. */
  tasksDocumentRetry(scope: TaskDocumentFollow): Effect.Effect<void>;
  /** Every task's description the host holds for the windows, whole, each time any of them moves. */
  onDescriptionDocumentsChanged(listener: (held: AppDescriptionDocuments) => void): () => void;
  /** One task's or agent's cloud Browser tabs held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onBrowserTabsChanged`. */
  tasksBrowserTabsFollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  /** One task's or agent's Browser tabs let go by the windows: they stay followed among those let go lately until later ones push them out. */
  tasksBrowserTabsUnfollow(scope: TaskBrowserTabsFollow): Effect.Effect<void>;
  /** Every task's or agent's Browser tabs the host holds for the windows, whole, each time one moves or a takeover lapses. */
  onBrowserTabsChanged(listener: (held: AppBrowserTabs) => void): () => void;
  /** One task's description history held followed for the windows from now until let go, and a while after among those let go lately; what it holds is heard through `onHistoriesChanged`. */
  tasksHistoryFollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  /** One task's history let go by the windows: it stays followed among those let go lately until later ones push it out. */
  tasksHistoryUnfollow(scope: TaskHistoryFollow): Effect.Effect<void>;
  /** One task's held history read again at once, as Try again asks. */
  tasksHistoryRetry(scope: TaskHistoryFollow): Effect.Effect<void>;
  /** Every task's description history the host holds for the windows, whole, each time any of them moves. */
  onHistoriesChanged(listener: (held: AppHistories) => void): () => void;
  /** One task's description's or page's comments held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onDescriptionCommentsChanged`. */
  tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** One description's or page's comments let go by the windows: they stay followed among those let go lately until later ones push them out. */
  tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** One held description's or page's comments read again at once, as Try again asks. */
  tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** Every description's or page's comments the host holds for the windows, whole, each time any of them moves. */
  onDescriptionCommentsChanged(listener: (held: AppDescriptionComments) => void): () => void;
  /** Where every one of the account's integrations stands, held followed for the windows from now until let go, and a while after; what it holds is heard through `onIntegrationsChanged`. */
  integrationsFollow(): Effect.Effect<void>;
  /** The account's integrations let go by the windows. */
  integrationsUnfollow(): Effect.Effect<void>;
  /** The account's held integrations read again at once, as Try again asks. */
  integrationsRetry(): Effect.Effect<void>;
  /** The account's integrations the host holds for the windows, whole, each time they move. */
  onIntegrationsChanged(listener: (held: AppIntegrations) => void): () => void;
  /** A sign-in to one provider begun and opened in the browser by the host; whether it was, never the address. */
  integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
  /** The tools one server offers the account's agents, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onIntegrationToolsChanged`. */
  integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
  /** One server's tools let go by the windows. */
  integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
  /** One server's held tools asked again at once, as Try again asks; done once the ask has landed. */
  integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
  /** Every server's tools the host holds for the windows, whole, each time any of them moves. */
  onIntegrationToolsChanged(listener: (held: AppIntegrationTools) => void): () => void;
  /** The account's sign-in to one provider under way ended, revoking nothing; where it then stands, or why there is no answer. */
  integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  /** The account's connection to one account at a provider ended; where it then stands, or why there is no answer. */
  integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
  /** One account at a provider named as the developer calls it; the account as it then stands, or why there is no answer. */
  integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
  /** The outside MCP clients the account allowed, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onMcpClientsChanged`. */
  mcpClientsFollow(): Effect.Effect<void>;
  /** The outside MCP clients let go by the windows. */
  mcpClientsUnfollow(): Effect.Effect<void>;
  /** The held outside MCP clients asked again at once, as Try again asks; done once the ask has landed. */
  mcpClientsRetry(): Effect.Effect<void>;
  /** The outside MCP clients the host holds for the windows, whole, each time they move. */
  onMcpClientsChanged(listener: (held: AppMcpClients) => void): () => void;
  /** One outside MCP client revoked under the Mac's session; the clients as they then stand, or why the revoke did not finish. */
  mcpClientsRevoke(params: McpClientRevokeParams): Effect.Effect<McpClientsView>;
  /** A workspace made under a name, owned by the account; the workspace, or why none was. */
  workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace renamed by an owner or admin; the workspace under its new name, or why it was not. */
  workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's photo set or removed by an owner or admin; the workspace with its photo's new version or none, or why it was not. */
  workspacePhotoSet(params: TasksWorkspacePhotoSetParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's slug changed by its owner; the workspace under its new slug, or why it was not. */
  workspaceSlugSet(params: TasksWorkspaceSlugSetParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's GitHub organization connection begun; the install address to open, or why there is none. */
  workspaceGitHubConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  /** A workspace's GitHub organization disconnected; the workspace as it then stands, or why it is not. */
  workspaceGitHubDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
  /** A workspace's Sentry install begun; Sentry's install address to open, or why there is none. */
  workspaceSentryInstall(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
  /** One of a workspace's Sentry installations disconnected, drawn gone at once over the workspace's held integrations; the workspace's Sentry as it then stands, or why it is not. */
  workspaceSentryDisconnect(
    params: TasksWorkspaceSentryDisconnectParams,
  ): Effect.Effect<TasksWorkspaceSentryAnswer>;
  /** A workspace's Slack bot connected; the bot as it then stands, or why it is not. */
  workspaceSlackBotConnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  /** A workspace's Slack bot disconnected; the bot as it then stands, or why it is not. */
  workspaceSlackBotDisconnect(
    params: TasksWorkspaceParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  /** The reader's own Slack notifications turned on or off; the bot as it then stands, or why it is not. */
  workspaceSlackBotNotifications(
    params: TasksWorkspaceSlackBotNotificationsParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  /** The workspace's default repository for Slack starts named or cleared; the bot as it then stands, or why it is not. */
  workspaceSlackBotRepository(
    params: TasksWorkspaceSlackBotRepositoryParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  /** One channel's bot membership or default repository changed; the bot as it then stands, or why it is not. */
  workspaceSlackBotChannel(
    params: TasksWorkspaceSlackBotChannelParams,
  ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
  /** One workspace's own integrations held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onWorkspaceIntegrationsChanged`. */
  workspaceIntegrationsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** One workspace's integrations let go by the windows. */
  workspaceIntegrationsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** One workspace's held integrations read again at once, as Try again asks. */
  workspaceIntegrationsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** Every workspace's own integrations the host holds for the windows, whole, each time any of them moves. */
  onWorkspaceIntegrationsChanged(listener: (held: AppWorkspaceIntegrations) => void): () => void;
  /** One workspace's Slack channels held for an owner's or an admin's windows from now until let go; what Slack lists is heard through `onSlackChannelsChanged`. */
  workspaceSlackChannelsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** One workspace's Slack channels let go by the windows. */
  workspaceSlackChannelsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** One workspace's held Slack channels asked again at once, as Try again asks; done once the ask has landed. */
  workspaceSlackChannelsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
  /** Every workspace's Slack channels the host holds for the windows, whole, each time any of them moves. */
  onSlackChannelsChanged(listener: (held: AppSlackChannels) => void): () => void;
  /** One workspace's people held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onWorkspaceMembersChanged`. */
  workspaceMembersFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** One workspace's people let go by the windows: they stay followed among those let go lately until later ones push them out. */
  workspaceMembersUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** One workspace's held people read again at once, as Try again asks. */
  workspaceMembersRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** Every workspace's people the host holds for the windows, whole, each time any of them moves. */
  onWorkspaceMembersChanged(listener: (held: AppWorkspaceMembers) => void): () => void;
  /** One workspace's pending invitations held followed for an owner's or an admin's windows from now until let go, and a while after among those let go lately; what they hold is heard through `onWorkspaceInvitationsChanged`. */
  workspaceInvitationsFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** One workspace's invitations let go by the windows: they stay followed among those let go lately until later ones push them out. */
  workspaceInvitationsUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** One workspace's held invitations read again at once, as Try again asks. */
  workspaceInvitationsRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
  /** Every workspace's pending invitations the host holds for the windows, whole, each time any of them moves or expires. */
  onWorkspaceInvitationsChanged(listener: (held: AppWorkspaceInvitations) => void): () => void;
  /** Every listed workspace's photo the host holds, whole, each time one is fetched or let go. */
  onWorkspacePhotosChanged(listener: (held: AppWorkspacePhotos) => void): () => void;
  /** The repositories members added to a workspace on their own GitHub tokens, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onTokenRepositoriesChanged`. */
  workspaceTokenRepositoriesFollow(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  /** One workspace's token repositories let go by the windows. */
  workspaceTokenRepositoriesUnfollow(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  /** One workspace's held token repositories asked again at once, as Try again asks; done once the ask has landed. */
  workspaceTokenRepositoriesRetry(
    params: TasksWorkspaceTokenRepositoriesParams,
  ): Effect.Effect<void>;
  /** Every workspace's token repositories the host holds for the windows, whole, each time any of them moves. */
  onTokenRepositoriesChanged(listener: (held: AppTokenRepositories) => void): () => void;
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
  /** An invitation made; it with its accept link, or why none was. */
  workspaceInvite(
    params: TasksWorkspaceInviteParams,
  ): Effect.Effect<TasksWorkspaceInvitationAnswer>;
  /** A pending invitation canceled; those still pending, or why it was not. */
  workspaceInvitationCancel(
    params: TasksWorkspaceInvitationCancelParams,
  ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
  /** The models a coding agent may run on as the account is offered them, and its devices, held for the windows from now until let go, asked again as a window comes forward, as the provider keys move, and every `MODEL_CATALOG_TTL`; what they hold is heard through `onModelsChanged`. */
  agentModelsFollow(): Effect.Effect<void>;
  /** The models let go by the windows. */
  agentModelsUnfollow(): Effect.Effect<void>;
  /** The held models asked again at once, as Try again asks. */
  agentModelsRetry(): Effect.Effect<void>;
  /** The models the host holds for the windows, whole, each time any of them moves. */
  onModelsChanged(listener: (held: AppModels) => void): () => void;
  /** The default drawn over the account's preferences at once and written; the choice as kept, or why it is unchanged. */
  agentDefaultWrite(choice: ModelChoice): Effect.Effect<AgentDefaultAnswer>;
  /** The account's hosts held for the windows from now until let go, followed live; what they hold is heard through `onHostsChanged`. */
  hostsFollow(): Effect.Effect<void>;
  /** The account's hosts let go by the windows. */
  hostsUnfollow(): Effect.Effect<void>;
  /** The account's held hosts read again at once, as Try again asks. */
  hostsRetry(): Effect.Effect<void>;
  /** The account's hosts the host holds for the windows, whole, each time they move. */
  onHostsChanged(listener: (held: AppHosts) => void): () => void;
  /** The account's devices' beats held for the windows from now until let go, asked again every `MAC_PRESENCE.POLL_MS` while held; what they hold is heard through `onDevicePresenceChanged`. */
  hostsPresenceFollow(): Effect.Effect<void>;
  /** The account's devices' beats let go by the windows. */
  hostsPresenceUnfollow(): Effect.Effect<void>;
  /** The account's devices' beats asked again now, where a window holds them: the window came back online, or the Mac woke. */
  hostsPresenceRefresh(): Effect.Effect<void>;
  /** The account's devices' beats the host holds for the windows, whole, each time any of them moves. */
  onDevicePresenceChanged(listener: (held: AppDevicePresences) => void): () => void;
  /** One of the account's hosts removed; done, or why not. */
  hostsRemove(id: string): Effect.Effect<HostDoneAnswerView>;
  /** Run agents on this Mac turned on or off; done, or why not. Only the desktop's host answers it. */
  hostsThisMacSet(asked: ThisMacHostSetParams): Effect.Effect<HostDoneAnswerView>;
  /** A box's pending pairing read by the code its link named; the box, or why not. */
  hostsPairingRead(code: string): Effect.Effect<HostPairingView>;
  /** A box's pending pairing approved by its code; the host it made, or why not. */
  hostsPairingApprove(code: string): Effect.Effect<HostPairingApproveView>;
  /** A box's pending pairing denied by its code; done, or why not. */
  hostsPairingDeny(code: string): Effect.Effect<HostPairingDenyView>;
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
  /** A repository added to one agent beside the ones it works in; the agent as it then stands, or why it was not added. */
  agentAddRepository(params: AgentAddRepositoryParams): Effect.Effect<AgentAgentAnswer>;
  agentQueue(params: AgentQueueParams): Effect.Effect<AgentQueueAnswerView>;
  /** One agent stopped; the agent as it then stands, or why it was not. */
  agentStop(params: AgentStopParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent taken back to just before one of the developer's lines, stopped first where it still works; the agent as it then stands, or why it was not. */
  agentRewind(params: AgentRewindParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  agentArchive(params: AgentArchiveParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent deleted for good, a turn it still runs stopped first; that it was, or why not. */
  agentDelete(params: AgentStopParams): Effect.Effect<AgentDeleteAnswerView>;
  agentPin(params: AgentPinParams): Effect.Effect<AgentAgentAnswer>;
  /** The reader's own read mark of one agent moved; the agent as it then stands, or why it is unchanged. */
  agentMarkRead(params: AgentMarkReadParams): Effect.Effect<AgentAgentAnswer>;
  /** One agent read whole as its own page, on a task or with none; or why there is no answer. */
  agentPage(params: AgentPageParams): Effect.Effect<AgentPageAnswerView>;
  /** One agent's origin held followed for the windows from now until let go, and a while after among those let go lately; what it holds is heard through `onAgentOriginsChanged`. */
  agentOriginFollow(params: AgentPageParams): Effect.Effect<void>;
  /** One agent's origin let go by the windows: it stays followed among those let go lately until later ones push it out. */
  agentOriginUnfollow(params: AgentPageParams): Effect.Effect<void>;
  /** One agent's held origin read again at once, as Try again asks. */
  agentOriginRetry(params: AgentPageParams): Effect.Effect<void>;
  /** Every agent's origin the host holds for the windows, whole, each time any of them moves. */
  onAgentOriginsChanged(listener: (held: AppAgentOrigins) => void): () => void;
  /** An automation made; the automation as the service kept it, or why it was not made. */
  automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
  /** One automation changed; the automation as it then stands, or why it is unchanged. */
  automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
  /** One automation deleted with its history; or why it stands. */
  automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
  /** One automation run now under the window's key; the run as it came out, or why there is none. */
  automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
  /** A webhook's secret minted again; the automation and the new secret, for the asking window alone to show once, or why there is none. */
  automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
  /** A workspace's automations, a workspace's runs, or an automation's runs held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onAutomationsChanged`. */
  automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
  /** A held list or history let go, kept followed a while among those let go lately. */
  automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
  /** A held list or history read again at once, as Try again asks. */
  automationsRetry(scope: AutomationFollow): Effect.Effect<void>;
  /** One of the automations' held reads, whole, by its name, each time any of its keys moves. */
  onAutomationsChanged(listener: (held: Partial<AppAutomationReads>) => void): () => void;
  /** One part of one agent's pull request held for the windows' Pull request tabs from now until let go, asked again as a window comes forward and as the pull request moves; what it holds is heard through `onPullRequestPartsChanged`. */
  pullRequestPartFollow(params: PullRequestPartParams): Effect.Effect<void>;
  /** One pull request's part let go by the windows, kept a while among those let go lately. */
  pullRequestPartUnfollow(params: PullRequestPartParams): Effect.Effect<void>;
  /** One pull request's held part asked again at once, as Try again asks; done once the ask has landed. */
  pullRequestPartRetry(params: PullRequestPartParams): Effect.Effect<void>;
  /** One of the Pull request tabs' held parts, whole, by its read's name, each time any of its keys moves. */
  onPullRequestPartsChanged(listener: (held: Partial<AppPullRequestParts>) => void): () => void;
  /** One agent's pull request's newest chapters held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onChaptersChanged`. */
  chaptersFollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  /** One agent's pull request's chapters let go by the windows: they stay followed among those let go lately until later ones push them out. */
  chaptersUnfollow(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  /** One agent's pull request's held chapters read again at once, as Try again asks. */
  chaptersRetry(params: PullRequestChaptersReadParams): Effect.Effect<void>;
  /** Every agent's pull request's chapters the host holds for the windows, whole, each time any of them moves. */
  onChaptersChanged(listener: (held: AppChapters) => void): () => void;
  /** One agent's pull request's chapters generated for its head, or the generation already under way; the chapters as they then stand, or why there are none. */
  pullRequestChaptersGenerate(
    params: PullRequestChaptersParams,
  ): Effect.Effect<PullRequestChaptersAnswerView>;
  /** The skills the account sees in a workspace, the workspace's and its own, held for the windows from now until let go and followed live; what they hold is heard through `onInstalledSkillsChanged`. */
  installedSkillsFollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** A workspace's skills let go by the windows. */
  installedSkillsUnfollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** A workspace's held skills asked again at once, as Try again asks; done once the ask has landed. */
  installedSkillsRetry(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** Every workspace's skills the host holds for the windows, whole, each time any of them moves. */
  onInstalledSkillsChanged(listener: (held: AppInstalledSkills) => void): () => void;
  /** One installed skill read whole, its `SKILL.md` and every file's path and size; or why it was not. */
  installedSkillsRead(params: InstalledSkillIdParams): Effect.Effect<InstalledSkillContentView>;
  /** What a paste would install, read by the service; or why it did not say. */
  installedSkillsPreview(
    params: InstalledSkillPreviewParams,
  ): Effect.Effect<InstalledSkillPreviewView>;
  /** The skills a paste makes, installed all or none; or why none were. */
  installedSkillsInstall(
    params: InstalledSkillInstallParams,
  ): Effect.Effect<InstalledSkillInstallView>;
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
  /** Which of our own tools one agent is offered and whether its `run_on_mac` would run now, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onWorkspaceToolsChanged`. */
  agentWorkspaceToolsFollow(params: AgentPullRequestParams): Effect.Effect<void>;
  /** One agent's own tools let go by the windows. */
  agentWorkspaceToolsUnfollow(params: AgentPullRequestParams): Effect.Effect<void>;
  /** One agent's held tools asked again at once, as Try again asks; done once the ask has landed. */
  agentWorkspaceToolsRetry(params: AgentPullRequestParams): Effect.Effect<void>;
  /** Every agent's own tools the host holds for the windows, whole, each time any of them moves. */
  onWorkspaceToolsChanged(listener: (held: AppWorkspaceTools) => void): () => void;
  /** The account's own provider keys as hints and statuses, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onProviderKeysChanged`. */
  providerKeysFollow(): Effect.Effect<void>;
  /** The account's provider keys let go by the windows. */
  providerKeysUnfollow(): Effect.Effect<void>;
  /** The account's held provider keys asked again at once, as Try again asks; done once the ask has landed. */
  providerKeysRetry(): Effect.Effect<void>;
  /** The account's provider keys the host holds for the windows, whole, each time any of them moves. */
  onProviderKeysChanged(listener: (held: AppProviderKeys) => void): () => void;
  /** The member's own GitHub token as its login, hint, and status, never the token, held for the windows from now until let go and asked again as a window comes forward; what it holds is heard through `onGitHubTokenChanged`. */
  githubTokenFollow(): Effect.Effect<void>;
  /** The member's GitHub token let go by the windows. */
  githubTokenUnfollow(): Effect.Effect<void>;
  /** The member's held GitHub token asked again at once, as Try again asks; done once the ask has landed. */
  githubTokenRetry(): Effect.Effect<void>;
  /** The member's GitHub token the host holds for the windows, whole, each time it moves. */
  onGitHubTokenChanged(listener: (held: AppGitHubTokens) => void): () => void;
  /** The memories our agents kept in a workspace, held for the windows from now until let go and followed live; what they hold is heard through `onMemoriesChanged`. */
  memoriesFollow(params: MemoriesFollowParams): Effect.Effect<void>;
  /** A workspace's memories let go by the windows. */
  memoriesUnfollow(params: MemoriesFollowParams): Effect.Effect<void>;
  /** A workspace's held memories asked again at once, as Try again asks; done once the ask has landed. */
  memoriesRetry(params: MemoriesFollowParams): Effect.Effect<void>;
  /** Every workspace's memories the host holds for the windows, whole, each time any of them moves. */
  onMemoriesChanged(listener: (held: AppMemories) => void): () => void;
  /** One task's or agent's inbox held followed for the windows from now until let go, and a while after among those let go lately; what it holds is heard through `onHolderInboxesChanged`. */
  agentInboxFollow(scope: AgentInboxScope): Effect.Effect<void>;
  /** One task's or agent's inbox let go by the windows: it stays followed among those let go lately until later ones push it out. */
  agentInboxUnfollow(scope: AgentInboxScope): Effect.Effect<void>;
  /** One held task's or agent's inbox read again at once, as Try again asks. */
  agentInboxRetry(scope: AgentInboxScope): Effect.Effect<void>;
  /** Every task's or agent's inbox the host holds for the windows, whole, each time any of them moves. */
  onHolderInboxesChanged(listener: (held: AppHolderInboxes) => void): () => void;
  /** One item of a task's inbox answered; the item as it then stands and whether the answer was taken, or why there is no answer. */
  agentInboxAnswer(params: AgentInboxAnswerParams): Effect.Effect<AgentInboxAnsweredView>;
  /** One open item of a task's inbox closed without an answer; the item as it then stands and whether the close was taken, or why there is no answer. */
  agentInboxClose(params: AgentInboxCloseParams): Effect.Effect<AgentInboxAnsweredView>;
  /** A held close let go by its key, sent or taken back as its Undo asks; whether it was still held, or not where there is no answer. */
  agentInboxCloseRelease(
    params: AgentInboxCloseReleaseParams,
  ): Effect.Effect<AgentInboxCloseReleasedView>;
  /** One message on an item's thread, open or settled; the item as it then stands, its thread with the message on it, or why there is no answer. */
  agentInboxMessage(params: AgentInboxMessageParams): Effect.Effect<AgentInboxMessagedView>;
  /** A thread started with one agent, its subject and first message; the thread as it then stands, its message on it, or why there is no answer. */
  agentInboxStart(params: AgentInboxStartParams): Effect.Effect<AgentInboxMessagedView>;
  /** One item marked read or unread for the account; its read state, or why there is no answer. */
  agentInboxReadState(params: AgentInboxReadStateParams): Effect.Effect<AgentInboxReadStateView>;
  agentInboxRemind(params: AgentInboxRemindParams): Effect.Effect<AgentInboxReadStateView>;
  /** Where one item the account may read stands, its agent, task, and workspace; or why there is no answer. */
  agentInboxItemHome(params: AgentInboxItemHomeParams): Effect.Effect<AgentInboxItemHomeView>;
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
  /** The account's preferences row read again at once, as Try again asks. */
  agentPreferencesRetry(): Effect.Effect<void>;
  /** The account's preferences row, whole, each time the host's read of it for the session moves or a write is drawn over it. */
  onAccountPreferencesChanged(listener: (held: AppAccountPreferences) => void): () => void;
  /** One image of an inbox item, fetched under the account; its bytes in base64 under its media type, or why there is none. */
  /** One agent's or worker's transcript held followed for the windows from now until let go, and kept a while after among those let go lately, following no longer; what it holds is heard through `onTranscriptsChanged`. */
  transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** One held transcript let go by the window that held it. */
  transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** One held transcript read again at once, as Try again asks. */
  transcriptRetry(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** The page of a held transcript below the oldest message it holds, read at once and laid before them: whether it landed, or why it was not read. */
  transcriptOlder(params: AgentTranscriptOlderParams): Effect.Effect<AgentTranscriptOlderAnswer>;
  /** Every transcript the host holds for the windows, whole, each time any of them moves. */
  onTranscriptsChanged(listener: (held: AppTranscripts) => void): () => void;
  agentInboxAttachment(params: AgentInboxAttachmentParams): Effect.Effect<AgentInboxAttachmentView>;
  /** One picture a tool answered an agent or one of its workers, read under the account: its bytes in base64 under its type, or why there is none. */
  agentPicture(params: AgentPictureParams): Effect.Effect<AgentInboxAttachmentView>;
  /** One part of a message of an agent's transcript or one of its workers', read whole under the account: what the page carried cut, or why there is none. */
  agentPart(params: AgentPartParams): Effect.Effect<AgentPartView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onAccountAccessChanged(listener: (access: AppAccessSlice) => void): () => void;
  onSessionReplayChanged(listener: (replay: SessionReplayState) => void): () => void;
  onTasksChanged(listener: (view: TasksView) => void): () => void;
  /** The commands agents asked to run on this Mac that wait on the developer, whole, each time one is asked or answered. */
  onMacCommandAsksChanged(listener: (asks: readonly MacCommandAsk[]) => void): () => void;
  /** How many changes made offline the service refused as they were sent again, each time the count moves. */
  onOfflineRefusedChanged(listener: (count: number) => void): () => void;
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
  /** The connection's tab is shown in the window the developer is using, which moves its idle bound on. */
  terminalShown(params: { connectionId: string }): Effect.Effect<void>;
  terminalDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  /** Every waiting connection opened again now, as after the Mac woke. */
  terminalWake(): Effect.Effect<void>;
  /** What an attached shell printed, by its connection. */
  onTerminalOutput(
    listener: (output: { connectionId: string; data: Uint8Array }) => void,
  ): () => void;
  /** How an attached shell's connection stands, by its connection. */
  onTerminalState(listener: (state: TerminalStateEvent) => void): () => void;
  /** A cloud agent's mirror on this Mac made where none stands, answered with its folder; none where the host could not. */
  mirrorEnsure(params: { agentId: string }): Effect.Effect<string | undefined>;
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
  /** An agent's forwarding turned on or off, answering how it then stands; nothing where the host refused. */
  portForwardSet(params: {
    agentId: string;
    on: boolean;
  }): Effect.Effect<PortForwardingAnswer | undefined>;
  /** The one agent forwarded to this Mac's localhost and how its forwarding stands, or none, each time it moves. */
  onPortForwardingChanged(listener: (forwarding: PortForwarding) => void): () => void;
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

/** One part of a pull request held as the gateway carries it: the part, the agent, and the number where the tab names one. */
function pullRequestPart(params: PullRequestPartParams): PullRequestPartParams {
  return { part: params.part, ...pullRequestRead(params) };
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
  // SAFETY: the host is our own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** What a coding-agent call the host could not answer is drawn as. */
/** A followed transcript as the gateway's params carry it. */
/** The comments a window holds, as the gateway names them: the task, and the page where it holds one's. */
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

/** A pairing's read, approve, or deny that reached no answer, as each of them answers one. */
const PAIRING_UNANSWERED = { failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED } as const;

/** An automation call that reached no answer, as every automation method answers one. */
const AUTOMATION_UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** A task call that reached no answer, as every task method answers one. */
const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** What an integration call the host could not answer is drawn as. */
const INTEGRATION_UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

/** An outside MCP clients call that reached no answer. */
const MCP_CLIENTS_UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

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

  /** A repository list's scope as the gateway carries it: its workspace, or nothing for every one. */
  const repositoryScope = (params: TasksRepositoriesParams) =>
    params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId };

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
    integrationsFollow: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW, {})),
    integrationsUnfollow: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW, {})),
    integrationsRetry: () => fire(client.call(GATEWAY_METHOD.INTEGRATIONS_RETRY, {})),
    onIntegrationsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INTEGRATIONS_CHANGED,
        // Note that the held integrations are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held tools are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held clients are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that This Mac is the host's own, handed over in this process, so it is passed on as built, as the held beats are.
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
            // The host reads the event against the allowlist again before it is queued.
            event: { name, at, properties: carried(properties) },
          }),
        ),
      ),
    tasksResync: () => fire(client.call(GATEWAY_METHOD.TASKS_RESYNC)),
    tasksRegained: () => fire(client.call(GATEWAY_METHOD.TASKS_REGAINED)),
    workspacesRefresh: () => fire(client.call(GATEWAY_METHOD.WORKSPACES_REFRESH)),
    tasksRepositoriesFollow: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, repositoryScope(params))),
    tasksRepositoriesUnfollow: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_UNFOLLOW, repositoryScope(params))),
    tasksRepositoriesRetry: (params) =>
      fire(client.call(GATEWAY_METHOD.TASKS_REPOSITORIES_RETRY, repositoryScope(params))),
    onRepositoryListsChanged: (listener) =>
      on(
        GATEWAY_EVENT.REPOSITORY_LISTS_CHANGED,
        // Note that the held lists are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
        (payload) => (isRecord(payload) ? answered<AppRepositoryLists>(payload) : undefined),
        listener,
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
        // Note that the held standings are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
        (payload) => (isRecord(payload) ? answered<AppLinkStandings>(payload) : undefined),
        listener,
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
        // Note that the held comments are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
        (payload) => (isRecord(payload) ? answered<AppDescriptionComments>(payload) : undefined),
        listener,
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
        // Note that the held pages are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held descriptions are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
        // Note that the held tabs are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
        // Note that the held histories are the host's own, handed over in this process, so they are passed on as built, as the held descriptions are.
        (payload) => (isRecord(payload) ? answered<AppHistories>(payload) : undefined),
        listener,
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
        // Note that the held integrations are the host's own, handed over in this process, so they are passed on as built, as the held people are.
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
        // Note that the held channels are the host's own, handed over in this process, so they are passed on as built.
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
        // Note that the held people are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
        // Note that the held invitations are the host's own, handed over in this process, so they are passed on as built, as the held people are.
        (payload) => (isRecord(payload) ? answered<AppWorkspaceInvitations>(payload) : undefined),
        listener,
      ),
    onWorkspacePhotosChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED,
        // Note that the held photos are the host's own, handed over in this process, so they are passed on as built, as the held people are.
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
        // Note that the held repositories are the host's own, handed over in this process, so they are passed on as built, as the held people are.
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
    agentModelsFollow: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_FOLLOW, {})),
    agentModelsUnfollow: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_UNFOLLOW, {})),
    agentModelsRetry: () => fire(client.call(GATEWAY_METHOD.AGENTS_MODELS_RETRY, {})),
    onModelsChanged: (listener) =>
      on(
        GATEWAY_EVENT.MODELS_CHANGED,
        // Note that the held models are the host's own, handed over in this process, so they are passed on as built, as the held keys are.
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
        // Note that the held hosts are the host's own, handed over in this process, so they are passed on as built, as the held beats are.
        (payload) => (isRecord(payload) ? answered<AppHosts>(payload) : undefined),
        listener,
      ),
    hostsPresenceFollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_FOLLOW, {})),
    hostsPresenceUnfollow: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_UNFOLLOW, {})),
    hostsPresenceRefresh: () => fire(client.call(GATEWAY_METHOD.HOSTS_PRESENCE_REFRESH, {})),
    onDevicePresenceChanged: (listener) =>
      on(
        GATEWAY_EVENT.DEVICE_PRESENCE_CHANGED,
        // Note that the held beats are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
    // Note that the Start goes on whole, as the act port decoded it against the same schema the
    // Gateway's method reads, because a field copied by name is one a later field is left out of,
    // as an empty draft's `blank` was, which handed its agent the description.
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
        // Note that the held origins are the host's own, handed over in this process, so they are passed on as built, as the held chapters are.
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
        // Note that the held reads are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
        // Note that the held parts are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
        // Note that the held chapters are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held skills are the host's own, handed over in this process, so they are passed on as built, as the held memories are.
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
        // Note that the held tools are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
        (payload) => (isRecord(payload) ? answered<AppWorkspaceTools>(payload) : undefined),
        listener,
      ),
    providerKeysFollow: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_FOLLOW, {})),
    providerKeysUnfollow: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_UNFOLLOW, {})),
    providerKeysRetry: () => fire(client.call(GATEWAY_METHOD.PROVIDER_KEYS_RETRY, {})),
    onProviderKeysChanged: (listener) =>
      on(
        GATEWAY_EVENT.PROVIDER_KEYS_CHANGED,
        // Note that the held keys are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
        (payload) => (isRecord(payload) ? answered<AppProviderKeys>(payload) : undefined),
        listener,
      ),
    githubTokenFollow: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_FOLLOW, {})),
    githubTokenUnfollow: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_UNFOLLOW, {})),
    githubTokenRetry: () => fire(client.call(GATEWAY_METHOD.GITHUB_TOKEN_RETRY, {})),
    onGitHubTokenChanged: (listener) =>
      on(
        GATEWAY_EVENT.GITHUB_TOKEN_CHANGED,
        // Note that the held token is the host's own, handed over in this process, so it is passed on as built, as the held keys are.
        (payload) => (isRecord(payload) ? answered<AppGitHubTokens>(payload) : undefined),
        listener,
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
        // Note that the held memories are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
        (payload) => (isRecord(payload) ? answered<AppMemories>(payload) : undefined),
        listener,
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
        // Note that the held inboxes are the host's own, handed over in this process, so they are passed on as built, as the account's items are.
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
          ...(params.held === undefined ? undefined : { held: params.held }),
        }),
        answerOf(agentInboxAnsweredViewSchema, AGENT_UNANSWERED),
      ),
    agentInboxCloseRelease: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.AGENTS_INBOX_CLOSE_RELEASE, {
          clientKey: params.clientKey,
          send: params.send,
        }),
        answerOf(agentInboxCloseReleasedViewSchema, { held: false }),
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
        // Note that the read is the host's own, handed over in this process, so it is passed on as built, as the inbox items are.
        (payload) => (isRecord(payload) ? answered<AppAccountPreferences>(payload) : undefined),
        listener,
      ),
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
    transcriptRetry: (transcript) =>
      fire(client.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_RETRY, transcriptParams(transcript))),
    onTranscriptsChanged: (listener) =>
      on(
        GATEWAY_EVENT.TRANSCRIPTS_CHANGED,
        // Note that the held transcripts are the host's own, handed over in this process, so they are passed on as built, as the held origins are.
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
    terminalShown: (params) =>
      fire(client.call(GATEWAY_METHOD.TERMINALS_SHOWN, { connectionId: params.connectionId })),
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
