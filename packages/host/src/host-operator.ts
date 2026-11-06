import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
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
import { type PortForwarding, portForwardingSchema } from "@repo/features/port-forward-acts";
import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
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
  type TasksWorkspaceParams,
  type TasksWorkspaceTokenRepositoriesParams,
  tasksPageAnswerSchema,
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
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  gatewayEventReader,
} from "@repo/gateway";
import type { AppSettings } from "@repo/settings/wire";
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
import { Clock, Effect, type Schema as EffectSchema, Option, Result } from "effect";
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
import { type MacCommandAsk, macCommandAsksSchema } from "./mac-command-ask.js";

/** Everything a window's bootstrap reads of the host, in one answer. */
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

/**
 * The client's door to the host over the Gateway for what is not a declared
 * act, which the act port answers from the composers directly
 * (`act-port/declared-acts.ts`): the events the host pushes, each read by
 * its `on*Changed` reader; the snapshots a window boots from; the live
 * reads' follows, unfollows, and retries; and the calls the rest of the
 * client makes of its own accord. Those callers are the client's state and
 * notices (`client/operator-client.ts`, `client/client-notices.ts`), the
 * desktop's window service and network watch, the web tab's host
 * (`web-host.ts`), the desktop's mirror ensure (`register-desktop-ipc.ts`),
 * and the terminal and browser-live procedures, whose platform work is
 * their own.
 *
 * Every method answers an effect: it composes one request and reads its
 * answer, and nothing here runs it; whoever asked yields it. The host is
 * this same process, so an answer that is not the shape the method
 * documents is a defect of the build rather than a reachable host state.
 * Nothing here holds host state.
 */
export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  /** Which machine This Mac is and the device its host's record names, held by the host for the session, whole, each time it moves; never on a platform with no This Mac. */
  onThisMacHostChanged(listener: (held: AppThisMacHosts) => void): () => void;
  accountSnapshot(): Effect.Effect<Option.Option<AccountSnapshot>>;
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
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the act, whose own answer guard is checked in the router and
 * again in the window that asked.
 */
function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is our own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** The comments a window holds, as the gateway names them: the task, and the page where it holds one's. */
function commentsFollowParams(scope: TasksCommentsFollow): WireRecord {
  return scope.pageId === undefined
    ? { taskId: scope.taskId }
    : { taskId: scope.taskId, pageId: scope.pageId };
}

/** A followed transcript as the gateway's params carry it. */
function transcriptParams(transcript: AgentTranscriptKey): WireRecord {
  const { kind, agentId, callId } = transcript;
  return callId === undefined ? { kind, agentId } : { kind, agentId, callId };
}

/** A task call that reached no answer, as every task method answers one. */
const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const fire = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<void> =>
    Effect.asVoid(result);

  const on = gatewayEventReader(client);

  /** A repository list's scope as the gateway carries it: its workspace, or nothing for every one. */
  const repositoryScope = (params: TasksRepositoriesParams) =>
    params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId };

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
    settingsSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AppSettings>(record(answer)?.settings)),
      ),
    accountSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AccountSnapshot>(record(answer)?.account)),
      ),
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
