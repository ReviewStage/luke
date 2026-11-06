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
  type AgentInboxScope,
  type AgentPageParams,
  type AgentPullRequestParams,
  type AgentPullRequestReadParams,
  type AgentTranscriptKey,
  agentAccountInboxAnswerViewSchema,
  type MemoriesFollowParams,
  type PullRequestPartParams,
} from "@repo/features/agent-view";
import type { ProductEventName, ProductEventPropertiesFor } from "@repo/features/analytics";
import type { AutomationFollow } from "@repo/features/automation-view";
import {
  type BrowserLiveClosedEvent,
  type BrowserLiveMessageEvent,
  browserLiveClosedEventSchema,
  browserLiveMessageEventSchema,
} from "@repo/features/browser-live-acts";
import type { InstalledSkillFollowParams } from "@repo/features/installed-skill-view";
import type { IntegrationProviderParams } from "@repo/features/integration-view";
import {
  type PortForwarding,
  type PortForwardingAnswer,
  portForwardingAnswerSchema,
  portForwardingSchema,
} from "@repo/features/port-forward-acts";
import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
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
  type TasksWorkspaceExperimentSetParams,
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
  /** The Tasks tab shows: the host reads the task list and the active document now and follows both until it is paused. */
  tasksRefresh(): Effect.Effect<void>;
  /** The Mac woke or unlocked: the host follows the task list again from a fresh seal. */
  tasksResync(): Effect.Effect<void>;
  /** The app reaches the service again: the host asks every read a window holds again, and follows the task list again from a fresh seal. */
  tasksRegained(): Effect.Effect<void>;
  /** A window said the changes made offline the service refused: the host clears their count for every window. */
  tasksOfflineRefusedClear(): Effect.Effect<void>;
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
  /** The reader's own read mark of one task moved; answers whether the service took it. */
  tasksMarkRead(params: TasksMarkReadParams): Effect.Effect<boolean>;
  /** One repository pinned in the sidebar or unpinned, kept on the account; answers whether the service changed the pins. */
  tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
  tasksWriteSection(params: TasksWriteSectionParams): Effect.Effect<boolean>;
  /** The repositories the account reaches in one workspace, or in every one, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onRepositoryListsChanged`. */
  tasksRepositoriesFollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** One workspace's repositories let go by the windows. */
  tasksRepositoriesUnfollow(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** One workspace's held repositories asked again at once, as Try again asks; done once the ask has landed. */
  tasksRepositoriesRetry(params: TasksRepositoriesParams): Effect.Effect<void>;
  /** Every workspace's repositories the host holds for the windows, whole, each time any of them moves. */
  onRepositoryListsChanged(listener: (held: AppRepositoryLists) => void): () => void;
  /** One task given its repository, or none; the repository as kept, or why it is unchanged. */
  tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
  /** One task moved to another of the account's workspaces; the workspace it now belongs to, or why it stands where it was. */
  tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
  /** One block of a task added or taken away; the task's blocks as they then stand, or why they are unchanged. */
  tasksBlock(params: TasksBlockParams): Effect.Effect<TasksBlockAnswer>;
  /** One task's parent set, or cleared with null; the parent as it then stands, or why it is unchanged. */
  tasksSetParent(params: TasksSetParentParams): Effect.Effect<TasksSetParentAnswer>;
  /** One relation of a task moved to another kind in one call; the task's relations as they then stand, or why they are unchanged. */
  tasksChangeRelation(params: TasksChangeRelationParams): Effect.Effect<TasksChangeRelationAnswer>;
  /** The developer's edit of a task's document; saved, a conflict with the text as it stands now, or why nothing was saved. */
  tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
  /** A window of a file of a task's repository, colored; or why it is not shown. */
  tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
  tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
  /** The skills a developer may choose of a task's repository; or why they are not read. */
  tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
  /** What GitHub holds of the page a link names, held for the windows from now until let go and asked again as a window comes forward; what it holds is heard through `onLinkStandingsChanged`. */
  tasksLinkStandingFollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  /** One link's standing let go by the windows. */
  tasksLinkStandingUnfollow(params: TasksLinkStandingParams): Effect.Effect<void>;
  /** Every link's standing the host holds for the windows, whole, each time any of them moves. */
  onLinkStandingsChanged(listener: (held: AppLinkStandings) => void): () => void;
  /** A Browser tab opened at an address in a task's coding agent's browser, taken over by the account; or why none opened. */
  tasksBrowserTabOpen(params: TasksBrowserTabOpenParams): Effect.Effect<TasksBrowserTabOpenAnswer>;
  /** The id of the task a link names by its workspace and its number; or that none was found, or the service did not answer. */
  tasksFind(params: TasksFindParams): Effect.Effect<TasksFindAnswer>;
  /** A page of a description's history; or that the service did not answer. */
  tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
  /** One revision of a description beside the one before it; or that the service did not answer. */
  tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
  /** One revision of a description restored as its content; answers whether the service restored it. */
  tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
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
  /** One picture of one description as its bytes in base64, or why there is none. */
  tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
  /** One picture kept on one description, answering the id its text names it by, or why it was not kept. */
  tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
  /** One task's description's or page's comments held followed for the windows from now until let go, and a while after among those let go lately; what they hold is heard through `onDescriptionCommentsChanged`. */
  tasksCommentsFollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** One description's or page's comments let go by the windows: they stay followed among those let go lately until later ones push them out. */
  tasksCommentsUnfollow(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** One held description's or page's comments read again at once, as Try again asks. */
  tasksCommentsRetry(scope: TasksCommentsFollow): Effect.Effect<void>;
  /** Every description's or page's comments the host holds for the windows, whole, each time any of them moves. */
  onDescriptionCommentsChanged(listener: (held: AppDescriptionComments) => void): () => void;
  /** A comment thread started on one task's description, answered as it stands, or why not. */
  tasksCommentStart(params: TasksCommentStartParams): Effect.Effect<TasksCommentAnswer>;
  /** One thing done to one comment thread of one task's description, answered as it stands, or why not. */
  tasksCommentAct(params: TasksCommentActParams): Effect.Effect<TasksCommentAnswer>;
  /** Where every one of the account's integrations stands, held followed for the windows from now until let go, and a while after; what it holds is heard through `onIntegrationsChanged`. */
  integrationsFollow(): Effect.Effect<void>;
  /** The account's integrations let go by the windows. */
  integrationsUnfollow(): Effect.Effect<void>;
  /** The account's held integrations read again at once, as Try again asks. */
  integrationsRetry(): Effect.Effect<void>;
  /** The account's integrations the host holds for the windows, whole, each time they move. */
  onIntegrationsChanged(listener: (held: AppIntegrations) => void): () => void;
  /** The tools one server offers the account's agents, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onIntegrationToolsChanged`. */
  integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
  /** One server's tools let go by the windows. */
  integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
  /** One server's held tools asked again at once, as Try again asks; done once the ask has landed. */
  integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
  /** Every server's tools the host holds for the windows, whole, each time any of them moves. */
  onIntegrationToolsChanged(listener: (held: AppIntegrationTools) => void): () => void;
  /** The outside MCP clients the account allowed, held for the windows from now until let go and asked again as a window comes forward; what they hold is heard through `onMcpClientsChanged`. */
  mcpClientsFollow(): Effect.Effect<void>;
  /** The outside MCP clients let go by the windows. */
  mcpClientsUnfollow(): Effect.Effect<void>;
  /** The held outside MCP clients asked again at once, as Try again asks; done once the ask has landed. */
  mcpClientsRetry(): Effect.Effect<void>;
  /** The outside MCP clients the host holds for the windows, whole, each time they move. */
  onMcpClientsChanged(listener: (held: AppMcpClients) => void): () => void;
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
  /** One experiment turned on or off for everyone in a workspace by an owner or admin; the workspace with its choice, or why it was not. */
  workspaceExperimentSet(
    params: TasksWorkspaceExperimentSetParams,
  ): Effect.Effect<TasksWorkspaceAnswer>;
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
  /** One agent's origin held followed for the windows from now until let go, and a while after among those let go lately; what it holds is heard through `onAgentOriginsChanged`. */
  agentOriginFollow(params: AgentPageParams): Effect.Effect<void>;
  /** One agent's origin let go by the windows: it stays followed among those let go lately until later ones push it out. */
  agentOriginUnfollow(params: AgentPageParams): Effect.Effect<void>;
  /** One agent's held origin read again at once, as Try again asks. */
  agentOriginRetry(params: AgentPageParams): Effect.Effect<void>;
  /** Every agent's origin the host holds for the windows, whole, each time any of them moves. */
  onAgentOriginsChanged(listener: (held: AppAgentOrigins) => void): () => void;
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
  /** The skills the account sees in a workspace, the workspace's and its own, held for the windows from now until let go and followed live; what they hold is heard through `onInstalledSkillsChanged`. */
  installedSkillsFollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** A workspace's skills let go by the windows. */
  installedSkillsUnfollow(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** A workspace's held skills asked again at once, as Try again asks; done once the ask has landed. */
  installedSkillsRetry(params: InstalledSkillFollowParams): Effect.Effect<void>;
  /** Every workspace's skills the host holds for the windows, whole, each time any of them moves. */
  onInstalledSkillsChanged(listener: (held: AppInstalledSkills) => void): () => void;
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
  /** One agent's or worker's transcript held followed for the windows from now until let go, and kept a while after among those let go lately, following no longer; what it holds is heard through `onTranscriptsChanged`. */
  transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** One held transcript let go by the window that held it. */
  transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** One held transcript read again at once, as Try again asks. */
  transcriptRetry(transcript: AgentTranscriptKey): Effect.Effect<void>;
  /** Every transcript the host holds for the windows, whole, each time any of them moves. */
  onTranscriptsChanged(listener: (held: AppTranscripts) => void): () => void;
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

const _AGENT_UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** A task call that reached no answer, as every task method answers one. */
const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A GitHub disconnect that reached no answer. */
const GITHUB_DISCONNECT_UNANSWERED = { failure: GITHUB_DISCONNECT_FAILURE.UNANSWERED } as const;

/** An admin read that reached no answer. */
const ADMIN_READ_UNANSWERED = { refused: ADMIN_UNANSWERED } as const;

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
        // Note that the held lists are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held standings are the host's own, handed over in this process, so they are passed on as built, as the held inboxes are.
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
        // Note that the held comments are the host's own, handed over in this process, so they are passed on as built, as the held pages are.
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
    workspaceExperimentSet: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_EXPERIMENT_SET, {
          workspaceId: params.workspaceId,
          experiment: params.experiment,
          on: params.on,
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
    // Note that the request goes on whole, as the act port decoded it against the same schema the
    // Gateway's method reads, because a field copied by name is one a later field is left out of,
    // as Runs on was, which sent every task to the cloud.
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
        // Note that the held models are the host's own, handed over in this process, so they are passed on as built, as the held keys are.
        (payload) => (isRecord(payload) ? answered<AppModels>(payload) : undefined),
        listener,
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
