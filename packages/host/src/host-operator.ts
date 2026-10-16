import type { AccountProvider, AccountSnapshot } from "@luke/credentials/snapshot";
import { WORKSPACE_CALL_FAILURE } from "@luke/features";
import {
  type AccountInboxAnswer,
  accountInboxAnswerSchema,
} from "@luke/features/account-inbox-wire";
import type { ProductEventName, ProductEventPropertiesFor } from "@luke/features/analytics";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationIdParams,
  type AutomationListParams,
  type AutomationListView,
  type AutomationRunParams,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationView,
  automationDeletedViewSchema,
  automationListViewSchema,
  automationRunsViewSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@luke/features/automation-view";
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
  codingAgentAgentAnswerSchema,
  codingAgentChangesAnswerViewSchema,
  codingAgentDefaultAnswerViewSchema,
  codingAgentGitHubImageViewSchema,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAnswerViewSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentListAnswerViewSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentModelsAnswerSchema,
  codingAgentOverviewAnswerViewSchema,
  codingAgentPageAnswerViewSchema,
  codingAgentPullRequestAnswerViewSchema,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  dictationTranscribeAnswerViewSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
  planTemplateAnswerViewSchema,
  planTemplateRevisionAnswerViewSchema,
  planTemplateRevisionsAnswerViewSchema,
  providerKeysAnswerViewSchema,
} from "@luke/features/coding-agent-view";
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
  ISSUE_CALL_FAILURE,
  type IssueChangeParams,
  type IssueCreateParams,
  type IssueIdParams,
  type IssueListParams,
  type IssueListView,
  type IssueView,
  issueListViewSchema,
  issueViewSchema,
} from "@luke/features/issue-view";
import {
  type MacRepositoriesAnswer,
  type MacRepository,
  macRepositoriesAnswerSchema,
} from "@luke/features/mac-terminal-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  planningPullRequestAnswerSchema,
  TASK_CALL_FAILURE,
  type TasksArchiveParams,
  type TasksBoardSaveParams,
  type TasksEditAnswer,
  type TasksEditParams,
  type TasksFileAnswer,
  type TasksFileParams,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksIssueParams,
  type TasksLinearIssuesAnswer,
  type TasksLinearIssuesParams,
  type TasksMessagesParams,
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
  type TasksWorkspaceTransferParams,
  tasksEditAnswerSchema,
  tasksFileAnswerSchema,
  tasksGitHubDisconnectAnswerSchema,
  tasksGitHubPageAnswerSchema,
  tasksIssueAnswerSchema,
  tasksLinearIssuesAnswerSchema,
  tasksMoveAnswerSchema,
  tasksPageAnswerSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksRepositoriesAnswerSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionsAnswerSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSkillsAnswerSchema,
  tasksStartAnswerSchema,
  tasksTreeAnswerSchema,
  tasksViewSchema,
  tasksWorkspaceAnswerSchema,
  tasksWorkspaceGitHubConnectAnswerSchema,
  tasksWorkspaceInvitationAnswerSchema,
  tasksWorkspaceInvitationsAnswerSchema,
  tasksWorkspaceLeaveAnswerSchema,
  tasksWorkspaceMembersAnswerSchema,
  tasksWorkspacePhotoAnswerSchema,
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
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, type Schema as EffectSchema, Option, Result } from "effect";
import { Base64 } from "effect/encoding";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * voice, planning, and client-fact methods the runtime host answers, and the events it pushes. Every method answers an effect: it
 * composes one request and reads its answer, and nothing here runs it — the
 * act row that asked yields it, and the router runs it once on the launch's
 * own runtime. The host is this same process, so an answer that is not the
 * shape the method documents is a defect of the build rather than a reachable
 * host state, and dies where it is read; the act router words a defect as the
 * kind's own refusal. Nothing here holds host state beyond the last settings
 * snapshot a refusal is answered with.
 */
export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessionReplay: { permitted: boolean; accountId?: string };
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
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  resetSettings(scope: SettingsResetScope, reporter: string): Effect.Effect<SettingsUpdateResult>;
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
   * The peer's SDP offer, and the plan the call is about, answered with the
   * session the host created; a host that creates none answers nothing.
   */
  createLiveSession(
    sdp: string,
    taskId: string,
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
  /** The Plans tab shows: the host reads the plan list and the active document now and follows both until it is paused. */
  tasksRefresh(): Effect.Effect<void>;
  /** The account's workspaces read again, where the host's last read is a minute old. */
  workspacesRefresh(): Effect.Effect<void>;
  /** The Work tab scrolled back: the host reads the open plan's page of work before the oldest turn it holds, and the view takes it. */
  tasksWorkEarlier(): Effect.Effect<void>;
  /** The Call tab scrolled back: the host reads the open plan's page of conversation before the oldest turn it holds, and the view takes it. */
  tasksConversationEarlier(): Effect.Effect<void>;
  /** One page of a plan's conversation, or a planning worker's, held by the service while it runs; or why there is none. */
  tasksMessages(params: TasksMessagesParams): Effect.Effect<CodingAgentMessagesAnswerView>;
  /** The Plans tab stopped showing: the host follows nothing, and the open plan and its call stand. */
  /** One plan made the active one, replacing whichever was; answers whether the host took it. */
  tasksOpen(taskId: string): Effect.Effect<boolean>;
  /** The developer left the open plan: its call ends and no plan is active. */
  tasksClose(): Effect.Effect<void>;
  /** A named plan started on the repository it names, where it names one, and made the active one; or why none started. */
  tasksStart(request: TasksStartRequest): Effect.Effect<TasksStartAnswer>;
  /** One plan deleted; answers whether the service deleted it. */
  tasksDelete(taskId: string): Effect.Effect<boolean>;
  /** One plan renamed; answers whether the service renamed it. */
  tasksRename(params: TasksRenameParams): Effect.Effect<boolean>;
  /** One plan pinned or unpinned; answers whether the service changed it. */
  tasksPin(params: TasksPinParams): Effect.Effect<boolean>;
  /** One repository pinned in the sidebar or unpinned, kept on the account; answers whether the service changed the pins. */
  tasksPinRepository(params: TasksPinRepositoryParams): Effect.Effect<boolean>;
  /** One plan archived or brought back; answers whether the service changed it. */
  tasksArchive(params: TasksArchiveParams): Effect.Effect<boolean>;
  /** The repositories the account reaches through the Luke GitHub App, read from the service now; or why there is no list. */
  tasksRepositories(params: TasksRepositoriesParams): Effect.Effect<TasksRepositoriesAnswer>;
  /** One plan given its repository, or none; the repository as kept, or why it is unchanged. */
  tasksSetRepository(params: TasksSetRepositoryParams): Effect.Effect<TasksSetRepositoryAnswer>;
  /** One plan moved to another of the account's workspaces; the workspace it now belongs to, or why it stands where it was. */
  tasksMove(params: TasksMoveParams): Effect.Effect<TasksMoveAnswer>;
  /** The developer's edit of a plan's document; saved, a conflict with the text as it stands now, or why nothing was saved. */
  tasksEdit(params: TasksEditParams): Effect.Effect<TasksEditAnswer>;
  /** The open plan's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  tasksBoardSave(params: TasksBoardSaveParams): Effect.Effect<void>;
  /** A window of a file of a plan's repository, coloured; or why it is not shown. */
  tasksFile(params: TasksFileParams): Effect.Effect<TasksFileAnswer>;
  tasksTree(params: TasksTreeParams): Effect.Effect<TasksTreeAnswer>;
  /** The skills a developer may choose of a plan's repository; or why they are not read. */
  tasksSkills(params: TasksSkillsParams): Effect.Effect<TasksSkillsAnswer>;
  /** One pull request of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksPullRequest(params: TasksPullRequestParams): Effect.Effect<TasksPullRequestAnswer>;
  /** One issue of a repository a workspace's installation reaches, by its number; null where there is none to draw, or that the service did not answer. */
  tasksIssue(params: TasksIssueParams): Effect.Effect<TasksIssueAnswer>;
  /** A page of a plan's history; or that the service did not answer. */
  tasksRevisions(params: TasksRevisionsParams): Effect.Effect<TasksRevisionsAnswer>;
  /** One revision of a plan beside the one before it; or that the service did not answer. */
  tasksRevision(params: TasksRevisionParams): Effect.Effect<TasksRevisionAnswer>;
  /** One revision of a plan restored as its content; answers whether the service restored it. */
  tasksRestore(params: TasksRevisionParams): Effect.Effect<boolean>;
  /** One version of one page of a plan with its HTML, for the frame that draws it; or that the service did not answer. */
  tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
  /** One picture of one plan as its bytes in base64, or why there is none. */
  tasksPicture(params: TasksPictureParams): Effect.Effect<TasksPictureAnswer>;
  /** One picture kept on one plan, answering the id its text names it by, or why it was not kept. */
  tasksPictureKeep(params: TasksPictureKeepParams): Effect.Effect<TasksPictureKeepAnswer>;
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
  /** One workspace's members; or why there are none. */
  workspaceMembers(params: TasksWorkspaceMembersParams): Effect.Effect<TasksWorkspaceMembersAnswer>;
  /** One workspace's photo, its bytes in base64 under its media type; or why there is none. */
  workspacePhoto(params: TasksWorkspacePhotoParams): Effect.Effect<TasksWorkspacePhotoAnswer>;
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
  /** One plan's coding agents with their status; or why there is no list. */
  codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
  /** One workspace's coding agents, newest started first, on one repository where one is named; or why there is no list. */
  codingAgentWorkspaceList(
    params: CodingAgentWorkspaceListParams,
  ): Effect.Effect<CodingAgentListAnswer>;
  /** An agent started on a plan under the press's own key; the agent, or why none started. */
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
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  codingAgentArchive(params: CodingAgentArchiveParams): Effect.Effect<CodingAgentAgentAnswer>;
  codingAgentPin(params: CodingAgentPinParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent read whole as its own page, on a plan or with none; or why there is no answer. */
  codingAgentPage(params: CodingAgentPageParams): Effect.Effect<CodingAgentPageAnswerView>;
  /** The account's automations, or one plan's or one workspace's; or why there are none. */
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
  /** One workspace's issues, standing or archived; or why there are none. */
  issueList(params: IssueListParams): Effect.Effect<IssueListView>;
  /** One issue; or why there is none. */
  issueRead(params: IssueIdParams): Effect.Effect<IssueView>;
  /** An issue filed; the issue as the service kept it, or why it was not filed. */
  issueCreate(params: IssueCreateParams): Effect.Effect<IssueView>;
  /** One issue changed; the issue as it then stands, or why it is unchanged. */
  issueChange(params: IssueChangeParams): Effect.Effect<IssueView>;
  /** What one agent published: its branch and pull request as GitHub holds them; or why there is no answer. */
  codingAgentPullRequest(
    params: CodingAgentPullRequestParams,
  ): Effect.Effect<CodingAgentPullRequestAnswerView>;
  /** One agent's changes: its pull request's files as GitHub holds them; or why there are none. */
  codingAgentChanges(
    params: CodingAgentPullRequestParams,
  ): Effect.Effect<CodingAgentChangesAnswerView>;
  /** One image an agent's pull request's overview names, read by the service on the App's token; or why there is none. */
  codingAgentGitHubImage(
    params: CodingAgentGitHubImageParams,
  ): Effect.Effect<CodingAgentGitHubImageView>;
  /** One agent's pull request as its Pull request tab draws it: its description, checks, reviewers, and conversation as GitHub holds them; or why there is none. */
  codingAgentOverview(
    params: CodingAgentPullRequestParams,
  ): Effect.Effect<CodingAgentOverviewAnswerView>;
  /** The account's own provider keys as hints and statuses; or why there are none. */
  providerKeysRead(): Effect.Effect<ProviderKeysAnswerView>;
  /** One provider key saved, carried once; the keys as they then stand, or why nothing was kept. */
  providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
  /** One provider's key removed; the keys as they then stand. */
  providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
  /** The account's plan template and whether it wrote it; or why there is none. */
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
  /** One plan's inbox past a cursor, held by the service while nothing changed; or why there is none. */
  codingAgentInbox(params: CodingAgentInboxParams): Effect.Effect<CodingAgentInboxAnswerView>;
  /** One agent's inbox past a cursor, an agent with no plan as much as one on a plan, held as a plan's is; or why there is none. */
  codingAgentAgentInbox(
    params: CodingAgentAgentInboxParams,
  ): Effect.Effect<CodingAgentInboxAnswerView>;
  /** One item of a plan's inbox answered; the item as it then stands and whether the answer was taken, or why there is no answer. */
  codingAgentInboxAnswer(
    params: CodingAgentInboxAnswerParams,
  ): Effect.Effect<CodingAgentInboxAnsweredView>;
  /** What waits on the developer across the account, followed from now until let go or signed out, heard through `onAccountInboxChanged`; following again starts over. */
  codingAgentAccountInboxFollow(): Effect.Effect<void>;
  /** The account's inbox let go: nothing more is heard of it until it is followed again. */
  codingAgentAccountInboxUnfollow(): Effect.Effect<void>;
  /** What waits on the developer across the account, whole, each time it changes while it is followed. */
  onAccountInboxChanged(listener: (inbox: AccountInboxAnswer) => void): () => void;
  /** One image of an inbox item, fetched under the account; its bytes in base64 under its media type, or why there is none. */
  codingAgentInboxAttachment(
    params: CodingAgentInboxAttachmentParams,
  ): Effect.Effect<CodingAgentInboxAttachmentView>;
  /** One picture a tool answered an agent or one of its workers, read under the account: its bytes in base64 under its type, or why there is none. */
  codingAgentPicture(
    params: CodingAgentPictureParams,
  ): Effect.Effect<CodingAgentInboxAttachmentView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onVoiceLiveSessionChanged(listener: (change: VoiceLiveSessionChanged) => void): () => void;
  onSessionReplayChanged(listener: (replay: HostSessionReplay) => void): () => void;
  onTasksChanged(listener: (view: TasksView) => void): () => void;
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

/** The host refused a call, or answered a shape its method does not document: a defect of this build, worded by the router as the kind's refusal. */
function unanswered(method: GatewayMethod, answer: GatewayCallResult): Effect.Effect<never> {
  return Effect.die(
    new Error(
      answer.ok
        ? `${method} answered a shape this client cannot read`
        : `${method} was refused: ${answer.error.message}`,
    ),
  );
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
const CODING_AGENT_UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** An automation call that reached no answer, as every automation method answers one. */
const AUTOMATION_UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** An issue call that reached no answer, as every issue method answers one. */
const ISSUE_UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

/** What an integration call the host could not answer is drawn as. */
const INTEGRATION_UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

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

  /** An issue answer as the host's method documents it, or unanswered, on the same terms as a coding-agent answer. */
  const issueAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof ISSUE_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? ISSUE_UNANSWERED;

  /** The account an integration ask is about, as the gateway carries it: the provider, and the account and an add where the window named them. */
  const integrationTarget = (params: IntegrationProviderParams) => ({
    provider: params.provider,
    ...(params.connection !== undefined ? { connection: params.connection } : undefined),
    ...(params.add !== undefined ? { add: params.add } : undefined),
  });

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
    resetSettings: (scope, reporter) =>
      settingsResult(
        GATEWAY_METHOD.SETTINGS_RESET,
        client.call(GATEWAY_METHOD.SETTINGS_RESET, { scope, ...wireReporter(reporter) }),
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
    createLiveSession: (sdp, taskId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp, taskId }),
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
    tasksWorkEarlier: () => fire(client.call(GATEWAY_METHOD.TASKS_WORK_EARLIER)),
    tasksConversationEarlier: () => fire(client.call(GATEWAY_METHOD.TASKS_CONVERSATION_EARLIER)),
    tasksMessages: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_MESSAGES, {
          taskId: params.taskId,
          ...("after" in params ? { after: params.after } : undefined),
          ...("before" in params ? { before: params.before } : undefined),
          ...("callId" in params ? { callId: params.callId } : undefined),
        }),
        codingAgentAnswer(codingAgentMessagesAnswerViewSchema),
      ),
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
    tasksArchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_ARCHIVE, {
          taskId: params.taskId,
          archived: params.archived,
        }),
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
            : { workspaceId: params.workspaceId, repository: params.repository },
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
                readEither(planningPullRequestAnswerSchema, { excess: EXCESS_KEYS.DROP })(
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
          taskId: params.taskId,
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
    workspaceMembers: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspaceMembersAnswerSchema),
      ),
    workspacePhoto: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.WORKSPACES_PHOTO, { workspaceId: params.workspaceId }),
        workspaceAnswer(tasksWorkspacePhotoAnswerSchema),
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
          ...("planning" in request ? { planning: request.planning } : undefined),
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
          taskId: params.taskId,
          idempotencyKey: params.idempotencyKey,
          ...("model" in params ? { model: params.model } : undefined),
          ...("effort" in params ? { effort: params.effort } : undefined),
          ...("contextWindow" in params ? { contextWindow: params.contextWindow } : undefined),
          ...("prompt" in params ? { prompt: params.prompt } : undefined),
          ...("attachments" in params ? { attachments: params.attachments } : undefined),
          ...("disabledServers" in params
            ? { disabledServers: params.disabledServers }
            : undefined),
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
    codingAgentArchive: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_ARCHIVE, {
          agentId: params.agentId,
          archived: params.archived,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
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
    codingAgentPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PAGE, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentPageAnswerViewSchema),
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
    issueList: (params) =>
      Effect.map(client.call(GATEWAY_METHOD.ISSUES_LIST, params), issueAnswer(issueListViewSchema)),
    issueRead: (params) =>
      Effect.map(client.call(GATEWAY_METHOD.ISSUES_READ, params), issueAnswer(issueViewSchema)),
    issueCreate: (params) =>
      Effect.map(client.call(GATEWAY_METHOD.ISSUES_CREATE, params), issueAnswer(issueViewSchema)),
    issueChange: (params) =>
      Effect.map(client.call(GATEWAY_METHOD.ISSUES_CHANGE, params), issueAnswer(issueViewSchema)),
    codingAgentPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentPullRequestAnswerViewSchema),
      ),
    codingAgentChanges: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_CHANGES, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentChangesAnswerViewSchema),
      ),
    codingAgentGitHubImage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE, params),
        codingAgentAnswer(codingAgentGitHubImageViewSchema),
      ),
    codingAgentOverview: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentOverviewAnswerViewSchema),
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
          key: params.key,
        }),
        codingAgentAnswer(providerKeysAnswerViewSchema),
      ),
    providerKeyRemove: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PROVIDER_KEYS_REMOVE, { provider: params.provider }),
        codingAgentAnswer(providerKeysAnswerViewSchema),
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
    codingAgentInbox: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_INBOX, {
          taskId: params.taskId,
          after: params.after,
        }),
        codingAgentAnswer(codingAgentInboxAnswerViewSchema),
      ),
    codingAgentAgentInbox: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
          agentId: params.agentId,
          after: params.after,
        }),
        codingAgentAnswer(codingAgentInboxAnswerViewSchema),
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
          clientKey: params.clientKey,
        }),
        codingAgentAnswer(codingAgentInboxAnsweredViewSchema),
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
            readEither(accountInboxAnswerSchema, { excess: EXCESS_KEYS.DROP })(payload),
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
        (payload) =>
          Result.getOrUndefined(readEither(tasksViewSchema, { excess: EXCESS_KEYS.DROP })(payload)),
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
