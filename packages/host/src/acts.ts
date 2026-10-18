import { ACCOUNT_PROVIDER, type AccountSnapshot } from "@luke/credentials/snapshot";
import {
  type AutomationDeletedView,
  type AutomationListView,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationView,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationDeletedViewSchema,
  automationIdParamsSchema,
  automationListParamsSchema,
  automationListViewSchema,
  automationRunParamsSchema,
  automationRunsViewSchema,
  automationRunViewSchema,
  automationViewSchema,
} from "@luke/features/automation-view";
import {
  type CodingAgentAgentAnswer,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxReadAllView,
  type CodingAgentInboxReadStateView,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  codingAgentAgentAnswerSchema,
  codingAgentAgentInboxParamsSchema,
  codingAgentArchiveParamsSchema,
  codingAgentChangesAnswerViewSchema,
  codingAgentChatAnswerViewSchema,
  codingAgentChatParamsSchema,
  codingAgentChatPostParamsSchema,
  codingAgentChatWriteAnswerViewSchema,
  codingAgentChooseParamsSchema,
  codingAgentDefaultAnswerViewSchema,
  codingAgentDefaultWriteParamsSchema,
  codingAgentGitHubImageParamsSchema,
  codingAgentGitHubImageViewSchema,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAnswerViewSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentInboxMessagedViewSchema,
  codingAgentInboxMessageParamsSchema,
  codingAgentInboxParamsSchema,
  codingAgentInboxReadAllViewSchema,
  codingAgentInboxReadStateParamsSchema,
  codingAgentInboxReadStateViewSchema,
  codingAgentListAnswerViewSchema,
  codingAgentListParamsSchema,
  codingAgentMessageParamsSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentMessagesParamsSchema,
  codingAgentModelsAnswerSchema,
  codingAgentOverviewChecksAnswerViewSchema,
  codingAgentOverviewConversationAnswerViewSchema,
  codingAgentOverviewPullRequestAnswerViewSchema,
  codingAgentPageAnswerViewSchema,
  codingAgentPageParamsSchema,
  codingAgentPictureParamsSchema,
  codingAgentPinParamsSchema,
  codingAgentPullRequestActionParamsSchema,
  codingAgentPullRequestAnswerViewSchema,
  codingAgentPullRequestParamsSchema,
  codingAgentPullRequestWriteAnswerViewSchema,
  codingAgentRenameParamsSchema,
  codingAgentServersParamsSchema,
  codingAgentStartParamsSchema,
  codingAgentStopParamsSchema,
  codingAgentWorkspaceListParamsSchema,
  type DictationTranscribeAnswerView,
  dictationTranscribeAnswerViewSchema,
  dictationTranscribeParamsSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionsAnswerView,
  type ProviderKeysAnswerView,
  planTemplateAnswerViewSchema,
  planTemplateRevisionAnswerViewSchema,
  planTemplateRevisionParamsSchema,
  planTemplateRevisionsAnswerViewSchema,
  planTemplateRevisionsParamsSchema,
  planTemplateWriteParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  providerKeysAnswerViewSchema,
} from "@luke/features/coding-agent-view";
import {
  type FactoryWorldView,
  factoryWorldParamsSchema,
  factoryWorldViewSchema,
} from "@luke/features/factory-world-view";
import {
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
} from "@luke/features/feedback";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import {
  type IntegrationAccountView,
  type IntegrationConnectView,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
  integrationStatusesViewSchema,
  integrationStatusViewSchema,
  integrationToolsViewSchema,
} from "@luke/features/integration-view";
import {
  type IssueListView,
  type IssueView,
  issueChangeParamsSchema,
  issueCreateParamsSchema,
  issueIdParamsSchema,
  issueListParamsSchema,
  issueListViewSchema,
  issueViewSchema,
} from "@luke/features/issue-view";
import { type LinearIssueSummary, linearIssueSummarySchema } from "@luke/features/linear-wire";
import {
  type MacRepositoriesAnswer,
  macRepositoriesAnswerSchema,
  macRepositorySchema,
  macTerminalKeySchema,
  macTerminalOpenParamsSchema,
} from "@luke/features/mac-terminal-wire";
import { PLAN_MARKDOWN_MAX_CHARS } from "@luke/features/plan-markdown";
import {
  type CodeLines,
  codeLinesSchema,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksIssue,
  type TasksMoveAnswer,
  type TasksPageSourceAnswer,
  type TasksPagesAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPullRequest,
  type TasksRepositoriesAnswer,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetRepositoryAnswer,
  type TasksSkillsAnswer,
  type TasksStartAnswer,
  type TasksTreeAnswer,
  type TasksWorkspacePhotoAnswer,
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksEditAnswerSchema,
  tasksEditParamsSchema,
  tasksFileAnswerSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
  tasksIssueSchema,
  tasksLinearIssuesParamsSchema,
  tasksMessagesParamsSchema,
  tasksMoveAnswerSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPageSourceAnswerSchema,
  tasksPagesAnswerSchema,
  tasksPagesParamsSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
  tasksPullRequestSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesAnswerSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsAnswerSchema,
  tasksRevisionsParamsSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSetRepositoryParamsSchema,
  tasksSkillsAnswerSchema,
  tasksSkillsParamsSchema,
  tasksStartAnswerSchema,
  tasksStartRequestSchema,
  tasksTreeAnswerSchema,
  tasksTreeParamsSchema,
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceMembersParamsSchema,
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoAnswerSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceTransferParamsSchema,
  tasksWriteSectionParamsSchema,
} from "@luke/features/tasks-view";
import {
  type TerminalCreatedActAnswer,
  type TerminalResumedActAnswer,
  type TerminalsActAnswer,
  terminalAgentParamsSchema,
  terminalAttachParamsSchema,
  terminalCreatedActAnswerSchema,
  terminalCreateParamsSchema,
  terminalRenameParamsSchema,
  terminalResumedActAnswerSchema,
  terminalShellParamsSchema,
  terminalsActAnswerSchema,
} from "@luke/features/terminal-acts";
import {
  type WorkspaceInvitation,
  workspaceInvitationSchema,
} from "@luke/features/workspace-invitation-wire";
import {
  type FormerMember,
  formerMemberSchema,
  type Workspace,
  type WorkspaceMember,
  workspaceMemberSchema,
  workspaceSchema,
} from "@luke/features/workspace-wire";
import {
  type VoiceCreateLiveSessionResult,
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
  voiceEndLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
  voiceSetVideoParamsSchema,
} from "@luke/gateway";
import type { LiveDiagnostics } from "@luke/live";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  EXPERIMENT,
  isAppSettingField,
  SETTINGS_RESET_SCOPE,
} from "@luke/settings";
import type { UpdateSnapshot } from "@luke/settings/update";
import type { SettingsUpdateResult } from "@luke/settings/wire";
import type { MicrophoneRoute, MicrophoneStatus } from "@luke/voice/audio";
import { avatarStateSchema } from "@luke/voice/avatar";
import { VOICE_COMMAND } from "@luke/voice/voice-view";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type UnparsedWireValue,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  isWireValue,
  type WireGuard,
  type WireGuardValue,
  wireResult,
} from "@luke/wire/wire-guard";
import { Schema as EffectSchema, Result } from "effect";

/**
 * Every effect a window may ask this build's main process for, named once.
 * There is no second way in: a press and a row's own control both mint one
 * of these kinds and hand it to `app:act`, whose router parses the kind's
 * payload, runs that kind's trust checks, and dispatches. Adding an effect is adding an entry here, its payload schema
 * below, its answer's guard beside it, and its one row in the router — a
 * command with no kind reaches nothing.
 *
 * A kind is what the window asks for, never what the main process does with
 * it: some are carried to the host over the operator client and some are the
 * desktop's own, and which is which is the router's business rather than the
 * vocabulary's.
 */
export const ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  /**
   * The account's integrations: where every one stands, a browser sign-in
   * to one begun and opened by the host, and one connection ended. The
   * window hears whether the browser was sent, never the address it was
   * sent to.
   */
  INTEGRATIONS_STATUS: "integrations.status",
  INTEGRATIONS_CONNECT: "integrations.connect",
  INTEGRATIONS_CANCEL: "integrations.cancel",
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  /** The tools one account's server offers the account's agents, read from the service when a list of them is shown. */
  INTEGRATIONS_TOOLS: "integrations.tools",
  /** One account at a provider named as the developer calls it. */
  INTEGRATIONS_RENAME: "integrations.rename",
  SETTING_UPDATE: "setting.update",
  SETTINGS_RESET: "settings.reset",
  /** One experiment turned on or off for the signed-in account, answering the settings as they then stand. */
  EXPERIMENT_SET: "experiment.set",
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
  /**
   * The panel's Tasks tab asking the host: the task list and the active
   * document read as the tab shows, one task made the active one, the open
   * task left, a task started on a repository, and a task renamed, given its
   * repository, pinned or unpinned, archived or brought back, or deleted. The view arrives on the document rather than as
   * an answer. The one write of a task's document from here is the
   * developer's edit of a field, `TASKS_EDIT`, which answers whether it
   * saved, conflicted with what Luke wrote meanwhile, or failed.
   */
  TASKS_REFRESH: "tasks.refresh",
  TASKS_SELECT: "tasks.select",
  TASKS_CLOSE: "tasks.close",
  TASKS_START: "tasks.start",
  TASKS_DELETE: "tasks.delete",
  TASKS_RENAME: "tasks.rename",
  TASKS_PIN: "tasks.pin",
  /** A repository pinned in the sidebar or unpinned, kept on the account; answers whether the service changed the pins. */
  TASKS_PIN_REPOSITORY: "tasks.pinRepository",
  /** One change to the sidebar's sections, kept on the account; answers whether the service took it. */
  TASKS_WRITE_SECTION: "tasks.writeSection",
  TASKS_ARCHIVE: "tasks.archive",
  /** The repository chip's read: the repositories the account reaches through the Luke GitHub App, as the service answers them now. */
  TASKS_REPOSITORIES: "tasks.repositories",
  /** A task given its repository on the service, or none; answers the repository as kept, or why it is unchanged. */
  TASKS_SET_REPOSITORY: "tasks.setRepository",
  /** A task moved on the service to another of the account's workspaces, its owner's alone; answers the workspace it now belongs to, or why it stands where it was. */
  TASKS_MOVE: "tasks.move",
  /** The developer's edit of the open task's document, saved on the service; answers saved, a conflict with the text as it stands now, or why nothing was saved. */
  TASKS_EDIT: "tasks.edit",
  /** A page of GitHub's opened in the browser: a repository, or where the Luke GitHub App is installed. No other address opens through it. */
  GITHUB_OPEN: "github.open",
  /** A web page opened in the default browser: a link a transcript's or an Inbox item's words hold, off GitHub. No address but an http or https one opens through it. */
  WEB_OPEN: "web.open",
  /** The page that connects the account's GitHub, asked of the service and opened in the browser; the connection arrives on the document once the panel comes forward again. */
  GITHUB_CONNECT: "github.connect",
  /** The account's GitHub disconnected on the service under the Mac's session; the connection arrives on the document at once. */
  GITHUB_DISCONNECT: "github.disconnect",
  /** The Tasks tab's microphone button: a call about the task the panel has open, opened, or its microphone toggled. */
  TASKS_TALK: "tasks.talk",
  /** The open task's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  TASKS_BOARD_SAVE: "tasks.boardSave",
  /** The Work tab scrolled back to its oldest turn: the open task's page of work before it, read from the service; the view arrives on the document. */
  TASKS_WORK_EARLIER: "tasks.workEarlier",
  /** The Call tab scrolled back to its oldest turn: the open task's page of conversation before it, read from the service; the view arrives on the document. */
  TASKS_CONVERSATION_EARLIER: "tasks.conversationEarlier",
  /** One page of a task's conversation, or a brain worker's under the call that started it, held open by the service while it runs; answered to the tab, never on the document. */
  TASKS_MESSAGES: "tasks.messages",
  /** A File tab's window of a file of the open task's repository, read from GitHub through the service and coloured by main; answered to the tab, never on the document. */
  TASKS_FILE: "tasks.file",
  /** A File tab's tree listing one folder of the open task's repository, read from GitHub through the service; answered to the tree, never on the document. */
  TASKS_TREE: "tasks.tree",
  /** The skills a developer may choose of a task's repository, read from GitHub through the service; answered to the asker, never on the document. */
  TASKS_SKILLS: "tasks.skills",
  /** One pull request of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_PULL_REQUEST: "tasks.pullRequest",
  /** One issue of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_ISSUE: "tasks.issue",
  /** A fenced block of a transcript's markdown, coloured by main as the File tab's lines are: the code and its fence's language go, the lines come back; answered to the block, never on the document. */
  TASKS_COLOUR_CODE: "tasks.colourCode",
  /** A page of the open plan's history for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISIONS: "tasks.revisions",
  /** A revision of the open plan beside the one before it for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISION: "tasks.revision",
  /** A revision of a plan restored as its content on the service; answers whether it was, and the document arrives as the service answered it. */
  TASKS_RESTORE: "tasks.restore",
  /** A page tab's source of one version of one of the plan's pages, read from the service as its frame's is and coloured by main as HTML; answered to the tab, never on the document. */
  TASKS_PAGE_SOURCE: "tasks.pageSource",
  /** One plan's pages, each by its newest version, read from the service for the Inbox's panel beside an item of that plan; answered to the view, never on the document. */
  TASKS_PAGES: "tasks.pages",
  /** One picture of the open plan as its bytes in base64, read from the service for the document drawing it; answered to the view, never on the document. */
  TASKS_PICTURE_READ: "tasks.pictureRead",
  /** A picture pasted, dropped, or chosen into the open plan's editor, kept on the service; answered with the id the text then names it by. */
  TASKS_PICTURE_KEEP: "tasks.pictureKeep",
  /**
   * The account's workspaces: one made under a name, answered as made, which
   * the account owns; one renamed by its owners and admins, answered under
   * its new name; one's photo set as a `data:` URL or removed with null by
   * its owners and admins, answered with the photo's new version or none;
   * one's pending invitations read, one made, answered
   * with its accept link, and one canceled, for its owners and admins; a GitHub
   * organization connected to one, the Luke GitHub App's install address the
   * service answers opened in the browser, or disconnected from it; one
   * workspace's members read; one member removed, answered with the members
   * who remain; another member given a role, or the workspace handed to one
   * of its admins, by its owner, each answered with the members as they then
   * stand; and one workspace left. Every write reads the workspaces
   * again, so they arrive on the document; a write the account's role does
   * not allow is refused in words that say so. A workspace's photo is read
   * apart, answered with its bytes in base64 under its media type or why
   * there are none, since the document never carries them.
   */
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_RENAME: "workspace.rename",
  WORKSPACE_INVITATIONS_READ: "workspace.invitationsRead",
  WORKSPACE_INVITE: "workspace.invite",
  WORKSPACE_INVITATION_CANCEL: "workspace.invitationCancel",
  WORKSPACE_GITHUB_CONNECT: "workspace.githubConnect",
  WORKSPACE_GITHUB_DISCONNECT: "workspace.githubDisconnect",
  WORKSPACE_LINEAR_CONNECT: "workspace.linearConnect",
  WORKSPACE_LINEAR_DISCONNECT: "workspace.linearDisconnect",
  WORKSPACE_LINEAR_ISSUES: "workspace.linearIssues",
  WORKSPACE_MEMBERS_READ: "workspace.membersRead",
  WORKSPACE_FORMER_MEMBERS_READ: "workspace.formerMembersRead",
  WORKSPACE_MEMBER_REMOVE: "workspace.memberRemove",
  WORKSPACE_MEMBER_ROLE: "workspace.memberRole",
  WORKSPACE_TRANSFER: "workspace.transfer",
  WORKSPACE_LEAVE: "workspace.leave",
  WORKSPACE_PHOTO_READ: "workspace.photoRead",
  WORKSPACE_PHOTO_SET: "workspace.photoSet",
  /**
   * A task's coding agents, asked of the service: the models one may run
   * on, the account's default among them read and written, the task's
   * agents with their status, one started under the press's own key, one's
   * transcript past a cursor (held open by the service while the agent
   * runs), one sent a message naming how it reaches a turn under way, one
   * given another model and effort for its next step, one renamed, one stopped, one
   * archived (a turn it still runs stopped first) or brought back, and
   * what one published: its branch and pull request as GitHub
   * holds them. The window holds what it draws; nothing here does.
   */
  CODING_AGENTS_MODELS: "codingAgents.models",
  CODING_AGENTS_DEFAULT_READ: "codingAgents.defaultRead",
  CODING_AGENTS_DEFAULT_WRITE: "codingAgents.defaultWrite",
  CODING_AGENTS_LIST: "codingAgents.list",
  /** One workspace's agents, newest started first: what an automation's Same agent is chosen from. */
  CODING_AGENTS_WORKSPACE_LIST: "codingAgents.workspaceList",
  CODING_AGENTS_START: "codingAgents.start",
  CODING_AGENTS_MESSAGES: "codingAgents.messages",
  CODING_AGENTS_MESSAGE: "codingAgents.message",
  CODING_AGENTS_CHOOSE: "codingAgents.choose",
  CODING_AGENTS_RENAME: "codingAgents.rename",
  CODING_AGENTS_SERVERS: "codingAgents.servers",
  CODING_AGENTS_STOP: "codingAgents.stop",
  CODING_AGENTS_ARCHIVE: "codingAgents.archive",
  CODING_AGENTS_PIN: "codingAgents.pin",
  /**
   * Which agent's tab the panel shows, or none, and which task's Inbox tab,
   * or none: what main's notification of an agent's end or of an inbox item
   * is held back by, and what clears an agent's tab's unseen dot.
   */
  CODING_AGENTS_SHOWN: "codingAgents.shown",
  CODING_AGENTS_PAGE: "codingAgents.page",
  CODING_AGENTS_PULL_REQUEST: "codingAgents.pullRequest",
  /** One agent's changes, its pull request's files with their patches, which its Changes tab draws. */
  CODING_AGENTS_CHANGES: "codingAgents.changes",
  /** One agent's pull request itself, its description, branches, mergeability, and people, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_PULL_REQUEST: "codingAgents.overviewPullRequest",
  /** The checks on one agent's pull request's head, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_CHECKS: "codingAgents.overviewChecks",
  /** One agent's pull request's conversation and where its reviewers stand, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_CONVERSATION: "codingAgents.overviewConversation",
  /** One image an agent's pull request's overview names, its bytes read by the service on the App's token. */
  CODING_AGENTS_GITHUB_IMAGE: "codingAgents.githubImage",
  /** One change to an agent's pull request, such as marking it ready for review, made on GitHub as the account on its own GitHub sign-in. */
  CODING_AGENTS_PULL_REQUEST_ACTION: "codingAgents.pullRequestAction",
  /** The account's automations: listed, made, changed, deleted, run now, and one's runs read. */
  AUTOMATIONS_LIST: "automations.list",
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  AUTOMATIONS_RUNS: "automations.runs",
  /** A webhook's secret minted again by the host and answered to this window alone, once, to show. */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
  /** The listed workspace's issues: listed, one read, one filed, and one changed. */
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
  /** A workspace's Factory world, read whole as it stands now, for the Factory page's worlds. */
  FACTORY_WORLD: "factory.world",
  /**
   * Settings › API keys: the account's own provider keys read as hints and
   * statuses, one saved, one removed. The save's payload is the one place a
   * key crosses from the renderer, once, on its way to the service; no
   * answer carries one back, and nothing on the way keeps it.
   */
  PROVIDER_KEYS_READ: "providerKeys.read",
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  /**
   * Settings › Plan template: the Markdown the account's new tasks start
   * from, read as the page opens, and kept as the developer pauses or reset
   * to the default with null. Each answers the template as the service then
   * keeps it. Its version history reads a page of revisions and one
   * revision at a time, and a restore answers the template as a write does.
   */
  PLAN_TEMPLATE_READ: "planTemplate.read",
  PLAN_TEMPLATE_WRITE: "planTemplate.write",
  PLAN_TEMPLATE_REVISIONS: "planTemplate.revisions",
  PLAN_TEMPLATE_REVISION: "planTemplate.revision",
  PLAN_TEMPLATE_RESTORE: "planTemplate.restore",
  /**
   * A clip dictated into a message box, carried once from the panel that
   * recorded it to the service and answered with its words. Nothing on the
   * way keeps it.
   */
  DICTATION_TRANSCRIBE: "dictation.transcribe",
  /**
   * The task's inbox of what its coding agents need of the developer: read
   * past a cursor (held open by the service while nothing changed), and one
   * item answered against the revision the panel drew, under the panel's own
   * key. The window holds what it draws; nothing here does.
   */
  CODING_AGENTS_INBOX: "codingAgents.inbox",
  CODING_AGENTS_AGENT_INBOX: "codingAgents.agentInbox",
  CODING_AGENTS_INBOX_ANSWER: "codingAgents.inboxAnswer",
  /** A message on one item's thread, open or settled, under the panel's own key; it never answers the item. */
  CODING_AGENTS_INBOX_MESSAGE: "codingAgents.inboxMessage",
  /** One item marked read or unread for the account; it changes neither what the item asks nor whether it waits. */
  CODING_AGENTS_INBOX_READ_STATE: "codingAgents.inboxReadState",
  /** Every item of the account's Inbox marked read, in one workspace or in all; the dots alone. */
  CODING_AGENTS_INBOX_READ_ALL: "codingAgents.inboxReadAll",
  /** One image of an inbox item, fetched by the host under the account, so the window holds no bearer and no address. */
  CODING_AGENTS_INBOX_ATTACHMENT: "codingAgents.inboxAttachment",
  CODING_AGENTS_PICTURE: "codingAgents.picture",
  /**
   * A coding agent's Terminal tab (`messages/terminal.ts`): its shells
   * listed, started, named, and ended, its sandbox resumed on the
   * developer's click, and a shell attached and detached. What a shell
   * prints travels on the port an attach posts to the asking panel, never on
   * an act.
   */
  TERMINAL_LIST: "terminal.list",
  TERMINAL_CREATE: "terminal.create",
  TERMINAL_RENAME: "terminal.rename",
  TERMINAL_KILL: "terminal.kill",
  TERMINAL_RESUME: "terminal.resume",
  TERMINAL_ATTACH: "terminal.attach",
  TERMINAL_DETACH: "terminal.detach",
  /**
   * A coding agent's branch opened on this Mac (`@luke/features/mac-terminal-wire`):
   * each repository's run command read and set; and a terminal of this Mac
   * opened on the agent's branch for the asking panel, and closed with its
   * tab. What the terminal prints and what is typed travel on the port an
   * open posts to that panel, never on an act.
   */
  MAC_REPOSITORIES: "macRepositories.read",
  MAC_REPOSITORY_SET: "macRepositories.set",
  MAC_TERMINAL_OPEN: "macTerminal.open",
  MAC_TERMINAL_CLOSE: "macTerminal.close",
  /**
   * The workspace's chat: read past a cursor (held open by the service
   * while nothing moved), and written to as the account's own member, a
   * post, an answer to an ask, a resolve, or how far it has read. The
   * window holds what it draws; nothing here does.
   */
  CODING_AGENTS_CHAT: "codingAgents.chat",
  CODING_AGENTS_CHAT_POST: "codingAgents.chatPost",
  VOICE_COMMAND: "voice.command",
  /** The call card's way back: Luke's window brought forward on the call's own task. */
  CALL_SHOW_TASK: "call.showTask",
  /** The panel's word on Luke's avatar: starting, live on its first frame, or ended and why. Taken from the panel alone. */
  AVATAR_REPORT: "avatar.report",
  /** The video tile's Video off, Video on, and Restart video: Luke's avatar asked for on the standing call, or taken down. Taken from the panel and the floating call window, which draw the tile, alone. */
  VOICE_SET_VIDEO: "voice.setVideo",
  /**
   * The voice window as a GPT Live peer: its SDP offer handed to the host,
   * which creates the one session and answers the SDP; the hang-up it asks
   * the host to decide; and the two reports the host reads its transport and
   * its idle from. No credential travels in any of them.
   */
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  MICROPHONE_REQUEST: "microphone.request",
  /**
   * Where the developer's voice would be captured from, read afresh: the act
   * probes the native watcher rather than answering the document, because the
   * route decides which device a press opens and macOS moves it between
   * presses.
   */
  MICROPHONE_ROUTE: "microphone.route",
  MICROPHONE_OPEN_SETTINGS: "microphone.openSettings",
  NOTIFICATIONS_OPEN_SETTINGS: "notifications.openSettings",
  /** A notification posted right away, whatever window is in front, to learn whether macOS shows Luke's. */
  NOTIFICATIONS_TEST: "notifications.test",
  /** A new message to the people who make Luke, in the system's mail app, to the address main holds. */
  CONTACT_EMAIL: "contact.email",
  WINDOW_FOCUS_PANEL: "window.focusPanel",
  WINDOW_COPY_TEXT: "window.copyText",
  WINDOW_SAVE_FILE: "window.saveFile",
  FEEDBACK_SEND: "feedback.send",
} as const;

export type ActKind = (typeof ACT_KIND)[keyof typeof ACT_KIND];

/**
 * One act payload's parser. The `s` combinators from `@luke/wire` satisfy
 * it, and every structural payload below is declared as one. It is the
 * reading alone rather than the whole `Schema` because no model is ever
 * offered an act: a JSON Schema node written here would be a second statement
 * of a rule the parser already holds, free to drift from it.
 */
interface ActSchema<Value> {
  read(value: UnparsedWireValue): SchemaRead<Value>;
}

/** One kind's whole declaration: what its payload takes, what its answer is, and what its refusal says. */
interface ActDeclaration<Payload, Result> {
  readonly payload: ActSchema<Payload>;
  readonly result: WireGuard<Result>;
  readonly refusal: string;
}

function malformed(path: SchemaPath = []): SchemaRead<never> {
  return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path };
}

/**
 * A kind that carries nothing. The schema admits absence alone, so a payload
 * sent to a kind that takes none is refused at the boundary rather than
 * silently dropped.
 */
const noPayload: ActSchema<undefined> = {
  read: (value) => (value === undefined ? { ok: true, value: undefined } : malformed()),
};

/**
 * A whole payload whose shape its own domain already parses, where restating
 * it as a field table here would be a second statement of the same rule free
 * to drift from the parser that admits the value.
 */
function guarded<Value>(admits: (value: UnparsedWireValue) => boolean): ActSchema<Value> {
  return {
    read: (value) =>
      // SAFETY: the domain parser above is what this payload's type is defined by.
      admits(value) ? { ok: true, value: value as Value } : malformed(),
  };
}

/**
 * A payload named field by field, each field admitted by the parser its own
 * domain owns. What `record` is for a payload whose fields are texts and
 * counts, for the payloads whose fields are whole domain values instead.
 */
function fields<Value>(guards: {
  readonly [key: string]: (value: UnparsedWireValue) => boolean;
}): ActSchema<Value> {
  const named = Object.keys(guards);
  return guarded<Value>((value) => {
    if (!isRecord(value)) return false;
    for (const key of Object.keys(value)) if (!named.includes(key)) return false;
    return named.every((key) => guards[key]?.(value[key]) === true);
  });
}

/** An `ActSchema` read through an Effect `Schema`, so `.read()` answers the same word and path `readEither` does. */
function actSchema<Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>): ActSchema<Value> {
  const read = readEither(schema);
  return {
    read: (value) =>
      Result.match(read(value), {
        onFailure: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onSuccess: (value) => ({ ok: true, value }),
      }),
  };
}

/**
 * What a workspace act whose role does not allow it is refused with, in place
 * of its kind's own sentence: a member renaming the workspace, setting its
 * photo, or removing someone, or an owner removed or leaving.
 */
export const WORKSPACE_NOT_PERMITTED_REFUSAL =
  "Your role in this workspace does not allow that." as const;

const workspaceMembersSchema = EffectSchema.Array(workspaceMemberSchema);
const formerMembersSchema = EffectSchema.Array(formerMemberSchema);

const linearIssuesSchema = EffectSchema.Array(linearIssueSummarySchema);

const workspaceInvitationsSchema = EffectSchema.Array(workspaceInvitationSchema);

/** What a GitHub disconnect is refused with where GitHub is the account's only way to sign in. */
export const GITHUB_LAST_SIGN_IN_REFUSAL =
  "GitHub is the only way you sign in to this Luke account, so it cannot be disconnected." as const;

/** What a Linear read is refused with where the workspace's Linear could not be read. */
export const LINEAR_UNAVAILABLE_REFUSAL =
  "Linear is not connected to this workspace, or it stopped answering. An owner or admin can connect it." as const;

/** What an invitation is refused with where the address is already in the workspace or already invited. */
export const ALREADY_INVITED_REFUSAL =
  "That address is already in this workspace or invited." as const;

/**
 * Whether a value reads under a schema at all, for a result the payload's own
 * row only checks admits. Every schema read here is a Gateway answer, so a key
 * a newer host added is dropped rather than refused: which keys a read tolerates
 * is the read's to say now that a declaration carries no parse options of its own.
 */
const isReadable =
  <Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>) =>
  (value: UnparsedWireValue): boolean =>
    Result.isSuccess(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));

/** A payload's field table as a struct, refusing a key it did not name. */
function record<Fields extends EffectSchema.Struct.Fields>(
  fields: Fields,
): ActSchema<EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>> {
  type Value = EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>;
  const struct = EffectSchema.Struct(fields);
  return actSchema(EffectSchema.make<EffectSchema.Codec<Value, UnparsedWireValue>>(struct.ast));
}

/** An identifier's ends, admitted as written rather than trimmed, and refused when it carries nothing. */
function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/** An identifier's ends, admitted as written and admitting nothing at all. */
function exactTextAllowingEmpty(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(EffectSchema.isMaxLength(max));
}

/**
 * An identifier that has to match the one it names elsewhere — a task or an
 * account — so its ends are admitted as written rather than trimmed into a
 * value the host would not hold.
 */
const exactId = exactText(512);

/**
 * The Chat the panel has on screen: a workspace's whole Chat, where the
 * plan is none, or one task's Chat tab, which shows only its plan's channel.
 */
const chatShownSchema = EffectSchema.Struct({
  workspaceId: exactId,
  planId: EffectSchema.NullOr(exactId),
});

export type ChatShown = typeof chatShownSchema.Type;

/**
 * The longest fenced block a transcript asks main to colour. Note that a
 * longer one is drawn plain rather than cut, because colouring costs main
 * a pass over every character and a block that long is a log, not a snippet.
 */
export const COLOURED_CODE_MAX_CHARS = 20_000;

/**
 * The longest text a File tab copies or saves of its file: the service
 * reads a file of a megabyte at most, and its text, a character to a byte
 * at least, is no longer.
 */
const FILE_TEXT_MAX_CHARS = 1024 * 1024;

/** A file's name as a save offers it: one name, no folder, so the dialog alone says where it goes. */
const savedFileName = exactText(255).check(EffectSchema.isPattern(/^[^/\\]+$/u));

/** The longest language name a fence may give for its block to be coloured. */
export const FENCE_LANGUAGE_MAX_CHARS = 32;

/** The one host the browser is sent to from a task: a repository's page, or the App's installation page. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** An address on GitHub, and nowhere else: what a repository link, the installation link, or Luke's own issues open. */
const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

/** Whether `github.open` takes an address, so a link drawn as a press is one the act will open. */
export const isGitHubAddress: (address: string) => boolean = EffectSchema.is(githubAddress);

/** An absolute web address's scheme, which is all `web.open` lets through to the browser. */
const WEB_ADDRESS = /^https?:\/\//iu;

/**
 * An address on the web, wherever it is: an absolute http or https address
 * the URL parser reads. Note that the scheme is the whole of the check,
 * because the browser is the one thing it opens in, and a `file:`,
 * `javascript:`, or another app's scheme would hand the address to
 * something else.
 */
const webAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(WEB_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

/** Whether `web.open` takes an address, so a link drawn as a press is one the act will open. */
export const isWebAddress: (address: string) => boolean = EffectSchema.is(webAddress);

/** A setting and a value already parsed for it, which is the pair its field types. */
export type SettingUpdatePayload = {
  [Field in AppSettingField]: {
    field: Field;
    value: AppSettingValue<Field>;
  };
}[AppSettingField];

/**
 * The one payload whose value is parsed by the field beside it. The parsed
 * value is what the payload carries, so the router's row receives the value
 * its field's own schema admitted rather than the one that arrived — there is
 * no second guard to disagree with this one.
 */
const settingUpdatePayload: ActSchema<SettingUpdatePayload> = {
  read: (raw) => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "field" && key !== "value")) {
      return malformed();
    }
    const value = raw;
    const field = value.field;
    if (!isWireString(field) || !isAppSettingField(field)) return malformed(["field"]);
    const parsed = APP_SETTING_SCHEMA[field].guard(value.value);
    if (!parsed.valid) return malformed(["value"]);
    // SAFETY: the field's own schema guard admitted this value for this field.
    return { ok: true, value: { field, value: parsed.value } as SettingUpdatePayload };
  },
};

const answersNothing = wireResult<void>();
const answersSettings = wireResult<SettingsUpdateResult>();
const answersAccount = wireResult<AccountSnapshot>();

/**
 * A press: a kind that carries nothing and answers nothing, which is what
 * most of them are. The sentence is the only thing such a row has to say.
 */
const press = (refusal: string): ActDeclaration<undefined, void> => ({
  payload: noPayload,
  result: answersNothing,
  refusal,
});

/** Connect GitHub and Disconnect, which open one page of the service's and are refused alike. */
const GITHUB_PAGE_PRESS = press("Could not open GitHub's connection page on this system.");

/**
 * Every act, one row per kind, and everything this build says about a kind in
 * that one row: the parser its payload has to pass, the guard its answer has
 * to pass, and the sentence its refusal carries. One row rather than three
 * tables, so a kind is read and added in one place and a kind missing any of
 * the three does not build.
 *
 * The payload's parser is the whole of what the boundary admits: it runs in
 * the main process before the act is dispatched and again in the router, so a
 * caller inside the main process cannot reach a row with a payload the window
 * could not have sent. The answer's guard is checked where the answer is
 * read — in the router before the outcome is minted, and in the window that
 * asked before its caller sees a value — and a kind whose answer has a domain
 * reader of its own names it, while the rest carry the structured-clone shape
 * alone, which is all a `void` or a snapshot the host composed needs. The
 * refusal is fixed by the build, so what reaches the window is something its
 * row can draw rather than whatever message an exception happened to carry.
 */
export const ACT = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: {
    payload: record({
      provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
    }),
    result: answersAccount,
    refusal: "Could not start signing in on this system.",
  },
  [ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: {
    payload: record({
      provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
    }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Sign-in didn't finish.",
  },
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: press("Could not cancel that sign-in on this system."),
  [ACT_KIND.ACCOUNT_SIGN_OUT]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not sign out on this system.",
  },
  [ACT_KIND.ACCOUNT_DELETE]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not delete that account on this system.",
  },
  [ACT_KIND.SETTING_UPDATE]: {
    payload: settingUpdatePayload,
    result: answersSettings,
    refusal: "Could not save that setting on this system.",
  },
  [ACT_KIND.SETTINGS_RESET]: {
    payload: record({
      scope: EffectSchema.Literals(Object.values(SETTINGS_RESET_SCOPE)),
    }),
    result: answersSettings,
    refusal: "Could not reset those settings on this system.",
  },
  [ACT_KIND.EXPERIMENT_SET]: {
    payload: record({
      experiment: EffectSchema.Literals(Object.values(EXPERIMENT)),
      on: EffectSchema.Boolean,
    }),
    result: answersSettings,
    refusal: "Could not change that experiment on this system.",
  },
  [ACT_KIND.UPDATE_CHECK]: {
    payload: noPayload,
    result: wireResult<UpdateSnapshot>(),
    refusal: "Could not check for updates on this system.",
  },
  [ACT_KIND.UPDATE_INSTALL]: press("Could not install that update on this system."),
  [ACT_KIND.UPDATE_OPEN_RELEASE]: press("Could not open the releases page."),
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: press("Could not open the changelog."),
  [ACT_KIND.TASKS_REFRESH]: press("Could not read your tasks on this system."),
  [ACT_KIND.TASKS_SELECT]: {
    payload: record({ taskId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not open that task on this system.",
  },
  [ACT_KIND.TASKS_CLOSE]: press("Could not leave that task on this system."),
  [ACT_KIND.TASKS_START]: {
    payload: actSchema(tasksStartRequestSchema),
    result: wireResult<TasksStartAnswer>(isReadable(tasksStartAnswerSchema)),
    refusal: "Could not start that task on this system.",
  },
  [ACT_KIND.TASKS_DELETE]: {
    payload: record({ taskId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not delete that task on this system.",
  },
  [ACT_KIND.TASKS_RENAME]: {
    payload: actSchema(tasksRenameParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not rename that task on this system.",
  },
  [ACT_KIND.TASKS_PIN]: {
    payload: actSchema(tasksPinParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not pin that task on this system.",
  },
  [ACT_KIND.TASKS_PIN_REPOSITORY]: {
    payload: actSchema(tasksPinRepositoryParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not pin that repository on this system.",
  },
  [ACT_KIND.TASKS_WRITE_SECTION]: {
    payload: actSchema(tasksWriteSectionParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not change that section on this system.",
  },
  [ACT_KIND.TASKS_ARCHIVE]: {
    payload: actSchema(tasksArchiveParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not archive that task on this system.",
  },
  [ACT_KIND.TASKS_REPOSITORIES]: {
    payload: actSchema(tasksRepositoriesParamsSchema),
    result: wireResult<TasksRepositoriesAnswer>(isReadable(tasksRepositoriesAnswerSchema)),
    refusal: "Could not read your GitHub repositories on this system.",
  },
  [ACT_KIND.TASKS_SET_REPOSITORY]: {
    payload: actSchema(tasksSetRepositoryParamsSchema),
    result: wireResult<TasksSetRepositoryAnswer>(isReadable(tasksSetRepositoryAnswerSchema)),
    refusal: "Could not change that task's repository on this system.",
  },
  [ACT_KIND.TASKS_MOVE]: {
    payload: actSchema(tasksMoveParamsSchema),
    result: wireResult<TasksMoveAnswer>(isReadable(tasksMoveAnswerSchema)),
    refusal: "Could not move that task on this system.",
  },
  [ACT_KIND.TASKS_EDIT]: {
    payload: actSchema(tasksEditParamsSchema),
    result: wireResult<TasksEditAnswer>(isReadable(tasksEditAnswerSchema)),
    refusal: "Could not save that edit on this system.",
  },
  [ACT_KIND.GITHUB_OPEN]: {
    payload: record({ url: githubAddress }),
    result: answersNothing,
    refusal: "Could not open GitHub on this system.",
  },
  [ACT_KIND.WEB_OPEN]: {
    payload: record({ url: webAddress }),
    result: answersNothing,
    refusal: "Could not open that link on this system.",
  },
  [ACT_KIND.GITHUB_CONNECT]: GITHUB_PAGE_PRESS,
  [ACT_KIND.GITHUB_DISCONNECT]: press("Could not disconnect GitHub on this system."),
  [ACT_KIND.TASKS_TALK]: press("Could not talk about that task on this system."),
  [ACT_KIND.WORKSPACE_CREATE]: {
    payload: actSchema(tasksWorkspaceCreateParamsSchema),
    result: wireResult<Workspace>(isReadable(workspaceSchema)),
    refusal: "Could not make that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_RENAME]: {
    payload: actSchema(tasksWorkspaceRenameParamsSchema),
    result: wireResult<Workspace>(isReadable(workspaceSchema)),
    refusal: "Could not rename that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_INVITATIONS_READ]: {
    payload: actSchema(tasksWorkspaceParamsSchema),
    result: wireResult<readonly WorkspaceInvitation[]>(isReadable(workspaceInvitationsSchema)),
    refusal: "Could not read invitations on this system.",
  },
  [ACT_KIND.WORKSPACE_INVITE]: {
    payload: actSchema(tasksWorkspaceInviteParamsSchema),
    result: wireResult<WorkspaceInvitation>(isReadable(workspaceInvitationSchema)),
    refusal: "Could not invite that address on this system.",
  },
  [ACT_KIND.WORKSPACE_INVITATION_CANCEL]: {
    payload: actSchema(tasksWorkspaceInvitationCancelParamsSchema),
    result: wireResult<readonly WorkspaceInvitation[]>(isReadable(workspaceInvitationsSchema)),
    refusal: "Could not cancel that invitation on this system.",
  },
  [ACT_KIND.WORKSPACE_GITHUB_CONNECT]: {
    payload: actSchema(tasksWorkspaceParamsSchema),
    result: answersNothing,
    refusal: "Could not connect GitHub to that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]: {
    payload: actSchema(tasksWorkspaceParamsSchema),
    result: answersNothing,
    refusal: "Could not disconnect GitHub from that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_LINEAR_CONNECT]: {
    payload: actSchema(tasksWorkspaceParamsSchema),
    result: answersNothing,
    refusal: "Could not connect Linear to that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_LINEAR_DISCONNECT]: {
    payload: actSchema(tasksWorkspaceParamsSchema),
    result: answersNothing,
    refusal: "Could not disconnect Linear from that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_LINEAR_ISSUES]: {
    payload: actSchema(tasksLinearIssuesParamsSchema),
    result: wireResult<readonly LinearIssueSummary[]>(isReadable(linearIssuesSchema)),
    refusal: "Could not read that workspace's Linear issues on this system.",
  },
  [ACT_KIND.WORKSPACE_MEMBERS_READ]: {
    payload: actSchema(tasksWorkspaceMembersParamsSchema),
    result: wireResult<readonly WorkspaceMember[]>(isReadable(workspaceMembersSchema)),
    refusal: "Could not read that workspace's members on this system.",
  },
  [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: {
    payload: actSchema(tasksWorkspaceMembersParamsSchema),
    result: wireResult<readonly FormerMember[]>(isReadable(formerMembersSchema)),
    refusal: "Could not read who left that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_MEMBER_REMOVE]: {
    payload: actSchema(tasksWorkspaceMemberRemoveParamsSchema),
    result: wireResult<readonly WorkspaceMember[]>(isReadable(workspaceMembersSchema)),
    refusal: "Could not remove that member on this system.",
  },
  [ACT_KIND.WORKSPACE_MEMBER_ROLE]: {
    payload: actSchema(tasksWorkspaceMemberRoleParamsSchema),
    result: wireResult<readonly WorkspaceMember[]>(isReadable(workspaceMembersSchema)),
    refusal: "Could not change that member's role on this system.",
  },
  [ACT_KIND.WORKSPACE_TRANSFER]: {
    payload: actSchema(tasksWorkspaceTransferParamsSchema),
    result: wireResult<readonly WorkspaceMember[]>(isReadable(workspaceMembersSchema)),
    refusal: "Could not transfer that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_LEAVE]: {
    payload: actSchema(tasksWorkspaceLeaveParamsSchema),
    result: answersNothing,
    refusal: "Could not leave that workspace on this system.",
  },
  [ACT_KIND.WORKSPACE_PHOTO_READ]: {
    payload: actSchema(tasksWorkspacePhotoParamsSchema),
    result: wireResult<TasksWorkspacePhotoAnswer>(isReadable(tasksWorkspacePhotoAnswerSchema)),
    refusal: "Could not read that workspace's photo on this system.",
  },
  [ACT_KIND.WORKSPACE_PHOTO_SET]: {
    payload: actSchema(tasksWorkspacePhotoSetParamsSchema),
    result: wireResult<Workspace>(isReadable(workspaceSchema)),
    refusal: "Could not change that workspace's photo on this system.",
  },
  [ACT_KIND.TASKS_BOARD_SAVE]: {
    payload: actSchema(tasksBoardSaveParamsSchema),
    result: answersNothing,
    refusal: "Could not save the board on this system.",
  },
  [ACT_KIND.TASKS_FILE]: {
    payload: actSchema(tasksFileParamsSchema),
    result: wireResult<TasksFileAnswer>(isReadable(tasksFileAnswerSchema)),
    refusal: "Could not read that file on this system.",
  },
  [ACT_KIND.TASKS_TREE]: {
    payload: actSchema(tasksTreeParamsSchema),
    result: wireResult<TasksTreeAnswer>(isReadable(tasksTreeAnswerSchema)),
    refusal: "Could not list that folder on this system.",
  },
  [ACT_KIND.TASKS_SKILLS]: {
    payload: actSchema(tasksSkillsParamsSchema),
    result: wireResult<TasksSkillsAnswer>(isReadable(tasksSkillsAnswerSchema)),
    refusal: "Could not read this repository's skills on this system.",
  },
  [ACT_KIND.TASKS_PULL_REQUEST]: {
    payload: actSchema(tasksPullRequestParamsSchema),
    result: wireResult<TasksPullRequest>(isReadable(tasksPullRequestSchema)),
    refusal: "Could not read that pull request on this system.",
  },
  [ACT_KIND.TASKS_ISSUE]: {
    payload: actSchema(tasksIssueParamsSchema),
    result: wireResult<TasksIssue>(isReadable(tasksIssueSchema)),
    refusal: "Could not read that issue on this system.",
  },
  [ACT_KIND.TASKS_COLOUR_CODE]: {
    payload: record({
      language: exactText(FENCE_LANGUAGE_MAX_CHARS),
      code: exactText(COLOURED_CODE_MAX_CHARS),
    }),
    result: wireResult<CodeLines>(isReadable(codeLinesSchema)),
    refusal: "Could not colour that code on this system.",
  },
  [ACT_KIND.TASKS_REVISIONS]: {
    payload: actSchema(tasksRevisionsParamsSchema),
    result: wireResult<TasksRevisionsAnswer>(isReadable(tasksRevisionsAnswerSchema)),
    refusal: "Could not read that plan's history on this system.",
  },
  [ACT_KIND.TASKS_REVISION]: {
    payload: actSchema(tasksRevisionParamsSchema),
    result: wireResult<TasksRevisionAnswer>(isReadable(tasksRevisionAnswerSchema)),
    refusal: "Could not read that version on this system.",
  },
  [ACT_KIND.TASKS_RESTORE]: {
    payload: actSchema(tasksRevisionParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not restore that version on this system.",
  },
  [ACT_KIND.TASKS_PICTURE_READ]: {
    payload: actSchema(tasksPictureParamsSchema),
    result: wireResult<TasksPictureAnswer>(isReadable(tasksPictureAnswerSchema)),
    refusal: "Could not read that picture on this system.",
  },
  [ACT_KIND.TASKS_PICTURE_KEEP]: {
    payload: actSchema(tasksPictureKeepParamsSchema),
    result: wireResult<TasksPictureKeepAnswer>(isReadable(tasksPictureKeepAnswerSchema)),
    refusal: "Could not keep that picture on this system.",
  },
  [ACT_KIND.TASKS_PAGE_SOURCE]: {
    payload: actSchema(tasksPageParamsSchema),
    result: wireResult<TasksPageSourceAnswer>(isReadable(tasksPageSourceAnswerSchema)),
    refusal: "Could not read that page's source on this system.",
  },
  [ACT_KIND.TASKS_PAGES]: {
    payload: actSchema(tasksPagesParamsSchema),
    result: wireResult<TasksPagesAnswer>(isReadable(tasksPagesAnswerSchema)),
    refusal: "Could not read that plan's pages on this system.",
  },
  [ACT_KIND.TASKS_WORK_EARLIER]: press("Could not read that task's earlier work on this system."),
  [ACT_KIND.TASKS_CONVERSATION_EARLIER]: press(
    "Could not read that task's earlier conversation on this system.",
  ),
  [ACT_KIND.TASKS_MESSAGES]: {
    payload: actSchema(tasksMessagesParamsSchema),
    result: wireResult<CodingAgentMessagesAnswerView>(
      isReadable(codingAgentMessagesAnswerViewSchema),
    ),
    refusal: "Could not read that task's conversation on this system.",
  },
  [ACT_KIND.INTEGRATIONS_STATUS]: {
    payload: noPayload,
    result: wireResult<IntegrationStatusesView>(isReadable(integrationStatusesViewSchema)),
    refusal: "Could not read your integrations on this system.",
  },
  [ACT_KIND.INTEGRATIONS_CONNECT]: {
    payload: actSchema(integrationProviderParamsSchema),
    result: wireResult<IntegrationConnectView>(isReadable(integrationConnectViewSchema)),
    refusal: "Could not connect that integration on this system.",
  },
  [ACT_KIND.INTEGRATIONS_TOOLS]: {
    payload: actSchema(integrationProviderParamsSchema),
    result: wireResult<IntegrationToolsView>(isReadable(integrationToolsViewSchema)),
    refusal: "Could not read that integration's tools on this system.",
  },
  [ACT_KIND.INTEGRATIONS_CANCEL]: {
    payload: actSchema(integrationProviderParamsSchema),
    result: wireResult<IntegrationStatusView>(isReadable(integrationStatusViewSchema)),
    refusal: "Could not cancel connecting that integration on this system.",
  },
  [ACT_KIND.INTEGRATIONS_DISCONNECT]: {
    payload: actSchema(integrationProviderParamsSchema),
    result: wireResult<IntegrationStatusView>(isReadable(integrationStatusViewSchema)),
    refusal: "Could not disconnect that integration on this system.",
  },
  [ACT_KIND.INTEGRATIONS_RENAME]: {
    payload: actSchema(integrationRenameParamsSchema),
    result: wireResult<IntegrationAccountView>(isReadable(integrationAccountViewSchema)),
    refusal: "Could not rename that account on this system.",
  },
  [ACT_KIND.CODING_AGENTS_MODELS]: {
    payload: noPayload,
    result: wireResult<CodingAgentModelsAnswer>(isReadable(codingAgentModelsAnswerSchema)),
    refusal: "Could not read the models on this system.",
  },
  [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: {
    payload: noPayload,
    result: wireResult<CodingAgentDefaultAnswer>(isReadable(codingAgentDefaultAnswerViewSchema)),
    refusal: "Could not read the default model on this system.",
  },
  [ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: {
    payload: actSchema(codingAgentDefaultWriteParamsSchema),
    result: wireResult<CodingAgentDefaultAnswer>(isReadable(codingAgentDefaultAnswerViewSchema)),
    refusal: "Could not change the default model on this system.",
  },
  [ACT_KIND.CODING_AGENTS_LIST]: {
    payload: actSchema(codingAgentListParamsSchema),
    result: wireResult<CodingAgentListAnswer>(isReadable(codingAgentListAnswerViewSchema)),
    refusal: "Could not read the task's agents on this system.",
  },
  [ACT_KIND.CODING_AGENTS_WORKSPACE_LIST]: {
    payload: actSchema(codingAgentWorkspaceListParamsSchema),
    result: wireResult<CodingAgentListAnswer>(isReadable(codingAgentListAnswerViewSchema)),
    refusal: "Could not read the workspace's agents on this system.",
  },
  [ACT_KIND.CODING_AGENTS_START]: {
    payload: actSchema(codingAgentStartParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not start an agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_MESSAGES]: {
    payload: actSchema(codingAgentMessagesParamsSchema),
    result: wireResult<CodingAgentMessagesAnswerView>(
      isReadable(codingAgentMessagesAnswerViewSchema),
    ),
    refusal: "Could not read the agent's transcript on this system.",
  },
  [ACT_KIND.CODING_AGENTS_MESSAGE]: {
    payload: actSchema(codingAgentMessageParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not message the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_CHOOSE]: {
    payload: actSchema(codingAgentChooseParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not change the agent's model on this system.",
  },
  [ACT_KIND.CODING_AGENTS_RENAME]: {
    payload: actSchema(codingAgentRenameParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not rename the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_SERVERS]: {
    payload: actSchema(codingAgentServersParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not switch the agent's MCP servers on this system.",
  },
  [ACT_KIND.CODING_AGENTS_STOP]: {
    payload: actSchema(codingAgentStopParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not stop the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_ARCHIVE]: {
    payload: actSchema(codingAgentArchiveParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not archive the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PIN]: {
    payload: actSchema(codingAgentPinParamsSchema),
    result: wireResult<CodingAgentAgentAnswer>(isReadable(codingAgentAgentAnswerSchema)),
    refusal: "Could not pin the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_SHOWN]: {
    payload: record({
      agentId: EffectSchema.NullOr(exactId),
      inboxTaskId: EffectSchema.NullOr(exactId),
      /** The Chat on screen: a workspace's whole Chat, the plan none, or a task's Chat tab on its plan's channel; none where no Chat is. */
      chatShown: EffectSchema.optionalKey(EffectSchema.NullOr(chatShownSchema)),
    }),
    result: answersNothing,
    refusal: "Could not note which agent is shown on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PAGE]: {
    payload: actSchema(codingAgentPageParamsSchema),
    result: wireResult<CodingAgentPageAnswerView>(isReadable(codingAgentPageAnswerViewSchema)),
    refusal: "Could not read the agent on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: {
    payload: actSchema(codingAgentPullRequestParamsSchema),
    result: wireResult<CodingAgentPullRequestAnswerView>(
      isReadable(codingAgentPullRequestAnswerViewSchema),
    ),
    refusal: "Could not read the agent's pull request on this system.",
  },
  [ACT_KIND.CODING_AGENTS_CHANGES]: {
    payload: actSchema(codingAgentPullRequestParamsSchema),
    result: wireResult<CodingAgentChangesAnswerView>(
      isReadable(codingAgentChangesAnswerViewSchema),
    ),
    refusal: "Could not read the agent's changes on this system.",
  },
  [ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: {
    payload: actSchema(codingAgentPullRequestParamsSchema),
    result: wireResult<CodingAgentOverviewPullRequestAnswerView>(
      isReadable(codingAgentOverviewPullRequestAnswerViewSchema),
    ),
    refusal: "Could not read the agent's pull request on this system.",
  },
  [ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: {
    payload: actSchema(codingAgentPullRequestParamsSchema),
    result: wireResult<CodingAgentOverviewChecksAnswerView>(
      isReadable(codingAgentOverviewChecksAnswerViewSchema),
    ),
    refusal: "Could not read the pull request's checks on this system.",
  },
  [ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: {
    payload: actSchema(codingAgentPullRequestParamsSchema),
    result: wireResult<CodingAgentOverviewConversationAnswerView>(
      isReadable(codingAgentOverviewConversationAnswerViewSchema),
    ),
    refusal: "Could not read the pull request's conversation on this system.",
  },
  [ACT_KIND.CODING_AGENTS_GITHUB_IMAGE]: {
    payload: actSchema(codingAgentGitHubImageParamsSchema),
    result: wireResult<CodingAgentGitHubImageView>(isReadable(codingAgentGitHubImageViewSchema)),
    refusal: "Could not read the pull request's image on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: {
    payload: actSchema(codingAgentPullRequestActionParamsSchema),
    result: wireResult<CodingAgentPullRequestWriteAnswerView>(
      isReadable(codingAgentPullRequestWriteAnswerViewSchema),
    ),
    refusal: "Could not change the pull request on this system.",
  },
  [ACT_KIND.AUTOMATIONS_LIST]: {
    payload: actSchema(automationListParamsSchema),
    result: wireResult<AutomationListView>(isReadable(automationListViewSchema)),
    refusal: "Could not read the automations on this system.",
  },
  [ACT_KIND.AUTOMATIONS_CREATE]: {
    payload: actSchema(automationCreateParamsSchema),
    result: wireResult<AutomationView>(isReadable(automationViewSchema)),
    refusal: "Could not make the automation on this system.",
  },
  [ACT_KIND.AUTOMATIONS_CHANGE]: {
    payload: actSchema(automationChangeParamsSchema),
    result: wireResult<AutomationView>(isReadable(automationViewSchema)),
    refusal: "Could not change the automation on this system.",
  },
  [ACT_KIND.AUTOMATIONS_DELETE]: {
    payload: actSchema(automationIdParamsSchema),
    result: wireResult<AutomationDeletedView>(isReadable(automationDeletedViewSchema)),
    refusal: "Could not delete the automation on this system.",
  },
  [ACT_KIND.AUTOMATIONS_RUN]: {
    payload: actSchema(automationRunParamsSchema),
    result: wireResult<AutomationRunView>(isReadable(automationRunViewSchema)),
    refusal: "Could not run the automation on this system.",
  },
  [ACT_KIND.AUTOMATIONS_RUNS]: {
    payload: actSchema(automationIdParamsSchema),
    result: wireResult<AutomationRunsView>(isReadable(automationRunsViewSchema)),
    refusal: "Could not read the automation's runs on this system.",
  },
  [ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: {
    payload: actSchema(automationIdParamsSchema),
    result: wireResult<AutomationView>(isReadable(automationViewSchema)),
    refusal: "Could not make a new webhook secret on this system.",
  },
  [ACT_KIND.ISSUES_LIST]: {
    payload: actSchema(issueListParamsSchema),
    result: wireResult<IssueListView>(isReadable(issueListViewSchema)),
    refusal: "Could not read the issues on this system.",
  },
  [ACT_KIND.ISSUES_READ]: {
    payload: actSchema(issueIdParamsSchema),
    result: wireResult<IssueView>(isReadable(issueViewSchema)),
    refusal: "Could not read the issue on this system.",
  },
  [ACT_KIND.ISSUES_CREATE]: {
    payload: actSchema(issueCreateParamsSchema),
    result: wireResult<IssueView>(isReadable(issueViewSchema)),
    refusal: "Could not create the issue on this system.",
  },
  [ACT_KIND.ISSUES_CHANGE]: {
    payload: actSchema(issueChangeParamsSchema),
    result: wireResult<IssueView>(isReadable(issueViewSchema)),
    refusal: "Could not change the issue on this system.",
  },
  [ACT_KIND.FACTORY_WORLD]: {
    payload: actSchema(factoryWorldParamsSchema),
    result: wireResult<FactoryWorldView>(isReadable(factoryWorldViewSchema)),
    refusal: "Could not read the workspace's world on this system.",
  },
  [ACT_KIND.PROVIDER_KEYS_READ]: {
    payload: noPayload,
    result: wireResult<ProviderKeysAnswerView>(isReadable(providerKeysAnswerViewSchema)),
    refusal: "Could not read your API keys on this system.",
  },
  [ACT_KIND.PROVIDER_KEYS_SAVE]: {
    payload: actSchema(providerKeySaveParamsSchema),
    result: wireResult<ProviderKeysAnswerView>(isReadable(providerKeysAnswerViewSchema)),
    refusal: "Could not save your API key on this system.",
  },
  [ACT_KIND.PROVIDER_KEYS_REMOVE]: {
    payload: actSchema(providerKeyRemoveParamsSchema),
    result: wireResult<ProviderKeysAnswerView>(isReadable(providerKeysAnswerViewSchema)),
    refusal: "Could not remove your API key on this system.",
  },
  [ACT_KIND.PLAN_TEMPLATE_READ]: {
    payload: noPayload,
    result: wireResult<PlanTemplateAnswerView>(isReadable(planTemplateAnswerViewSchema)),
    refusal: "Could not read your plan template on this system.",
  },
  [ACT_KIND.PLAN_TEMPLATE_WRITE]: {
    payload: actSchema(planTemplateWriteParamsSchema),
    result: wireResult<PlanTemplateAnswerView>(isReadable(planTemplateAnswerViewSchema)),
    refusal: "Could not save your plan template on this system.",
  },
  [ACT_KIND.PLAN_TEMPLATE_REVISIONS]: {
    payload: actSchema(planTemplateRevisionsParamsSchema),
    result: wireResult<PlanTemplateRevisionsAnswerView>(
      isReadable(planTemplateRevisionsAnswerViewSchema),
    ),
    refusal: "Could not read your plan template's history on this system.",
  },
  [ACT_KIND.PLAN_TEMPLATE_REVISION]: {
    payload: actSchema(planTemplateRevisionParamsSchema),
    result: wireResult<PlanTemplateRevisionAnswerView>(
      isReadable(planTemplateRevisionAnswerViewSchema),
    ),
    refusal: "Could not read that version on this system.",
  },
  [ACT_KIND.PLAN_TEMPLATE_RESTORE]: {
    payload: actSchema(planTemplateRevisionParamsSchema),
    result: wireResult<PlanTemplateAnswerView>(isReadable(planTemplateAnswerViewSchema)),
    refusal: "Could not restore that version on this system.",
  },
  [ACT_KIND.DICTATION_TRANSCRIBE]: {
    payload: actSchema(dictationTranscribeParamsSchema),
    result: wireResult<DictationTranscribeAnswerView>(
      isReadable(dictationTranscribeAnswerViewSchema),
    ),
    refusal: "Could not transcribe the recording on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX]: {
    payload: actSchema(codingAgentInboxParamsSchema),
    result: wireResult<CodingAgentInboxAnswerView>(isReadable(codingAgentInboxAnswerViewSchema)),
    refusal: "Could not read the task's inbox on this system.",
  },
  [ACT_KIND.CODING_AGENTS_AGENT_INBOX]: {
    payload: actSchema(codingAgentAgentInboxParamsSchema),
    result: wireResult<CodingAgentInboxAnswerView>(isReadable(codingAgentInboxAnswerViewSchema)),
    refusal: "Could not read the agent's inbox on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: {
    payload: actSchema(codingAgentInboxAnswerParamsSchema),
    result: wireResult<CodingAgentInboxAnsweredView>(
      isReadable(codingAgentInboxAnsweredViewSchema),
    ),
    refusal: "Could not answer the inbox item on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: {
    payload: actSchema(codingAgentInboxMessageParamsSchema),
    result: wireResult<CodingAgentInboxMessagedView>(
      isReadable(codingAgentInboxMessagedViewSchema),
    ),
    refusal: "Could not send the message on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: {
    payload: actSchema(codingAgentInboxReadStateParamsSchema),
    result: wireResult<CodingAgentInboxReadStateView>(
      isReadable(codingAgentInboxReadStateViewSchema),
    ),
    refusal: "Could not mark the inbox item on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: {
    payload: actSchema(inboxReadAllRequestSchema),
    result: wireResult<CodingAgentInboxReadAllView>(isReadable(codingAgentInboxReadAllViewSchema)),
    refusal: "Could not mark the inbox read on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: {
    payload: actSchema(codingAgentInboxAttachmentParamsSchema),
    result: wireResult<CodingAgentInboxAttachmentView>(
      isReadable(codingAgentInboxAttachmentViewSchema),
    ),
    refusal: "Could not read the inbox item's image on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PICTURE]: {
    payload: actSchema(codingAgentPictureParamsSchema),
    result: wireResult<CodingAgentInboxAttachmentView>(
      isReadable(codingAgentInboxAttachmentViewSchema),
    ),
    refusal: "Could not read the agent's picture on this system.",
  },
  [ACT_KIND.TERMINAL_LIST]: {
    payload: actSchema(terminalAgentParamsSchema),
    result: wireResult<TerminalsActAnswer>(isReadable(terminalsActAnswerSchema)),
    refusal: "Could not reach this agent's sandbox.",
  },
  [ACT_KIND.TERMINAL_CREATE]: {
    payload: actSchema(terminalCreateParamsSchema),
    result: wireResult<TerminalCreatedActAnswer>(isReadable(terminalCreatedActAnswerSchema)),
    refusal: "Could not start a shell in this agent's sandbox.",
  },
  [ACT_KIND.TERMINAL_RENAME]: {
    payload: actSchema(terminalRenameParamsSchema),
    result: wireResult<TerminalsActAnswer>(isReadable(terminalsActAnswerSchema)),
    refusal: "Could not rename that shell.",
  },
  [ACT_KIND.TERMINAL_KILL]: {
    payload: actSchema(terminalShellParamsSchema),
    result: wireResult<TerminalsActAnswer>(isReadable(terminalsActAnswerSchema)),
    refusal: "Could not end that shell.",
  },
  [ACT_KIND.TERMINAL_RESUME]: {
    payload: actSchema(terminalAgentParamsSchema),
    result: wireResult<TerminalResumedActAnswer>(isReadable(terminalResumedActAnswerSchema)),
    refusal: "Could not resume this agent's sandbox.",
  },
  [ACT_KIND.TERMINAL_ATTACH]: {
    payload: actSchema(terminalAttachParamsSchema),
    result: answersNothing,
    refusal: "Could not open that shell.",
  },
  [ACT_KIND.MAC_REPOSITORIES]: {
    payload: noPayload,
    result: wireResult<MacRepositoriesAnswer>(isReadable(macRepositoriesAnswerSchema)),
    refusal: "Could not read the run commands set on this Mac.",
  },
  [ACT_KIND.MAC_REPOSITORY_SET]: {
    payload: actSchema(macRepositorySchema),
    result: answersNothing,
    refusal: "Could not save the repository's run command on this Mac.",
  },
  [ACT_KIND.MAC_TERMINAL_OPEN]: {
    payload: actSchema(macTerminalOpenParamsSchema),
    result: answersNothing,
    refusal: "Could not open a terminal on this Mac.",
  },
  [ACT_KIND.MAC_TERMINAL_CLOSE]: {
    payload: actSchema(macTerminalKeySchema),
    result: answersNothing,
    refusal: "Could not close the terminal.",
  },
  [ACT_KIND.TERMINAL_DETACH]: {
    payload: actSchema(terminalShellParamsSchema),
    result: answersNothing,
    refusal: "Could not close that shell.",
  },
  [ACT_KIND.CODING_AGENTS_CHAT]: {
    payload: actSchema(codingAgentChatParamsSchema),
    result: wireResult<CodingAgentChatAnswerView>(isReadable(codingAgentChatAnswerViewSchema)),
    refusal: "Could not read the workspace's chat on this system.",
  },
  [ACT_KIND.CODING_AGENTS_CHAT_POST]: {
    payload: actSchema(codingAgentChatPostParamsSchema),
    result: wireResult<CodingAgentChatWriteAnswerView>(
      isReadable(codingAgentChatWriteAnswerViewSchema),
    ),
    refusal: "Could not write to the workspace's chat on this system.",
  },
  [ACT_KIND.VOICE_COMMAND]: {
    payload: record({
      command: EffectSchema.Literals(Object.values(VOICE_COMMAND)),
    }),
    result: answersNothing,
    refusal: "Could not carry that command on this system.",
  },
  [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: {
    payload: actSchema(voiceCreateLiveSessionParamsSchema),
    result: wireResult<VoiceCreateLiveSessionResult | undefined>(
      (value) => value === undefined || isReadable(voiceCreateLiveSessionResultSchema)(value),
    ),
    refusal: "Could not open a voice session on this system.",
  },
  [ACT_KIND.VOICE_END_LIVE_SESSION]: {
    payload: actSchema(voiceEndLiveSessionParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not end the voice session on this system.",
  },
  [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: {
    payload: actSchema(voiceReportLiveTransportParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice transport on this system.",
  },
  [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: {
    payload: actSchema(voiceReportLiveActivityParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice activity on this system.",
  },
  [ACT_KIND.VOICE_STOP_SPEAKING]: {
    payload: noPayload,
    result: wireResult<boolean>((value) =>
      Result.isSuccess(readEither(EffectSchema.Boolean)(value)),
    ),
    refusal: "Could not tell Luke to stop speaking on this system.",
  },
  [ACT_KIND.VOICE_DIAGNOSTICS]: {
    payload: noPayload,
    result: wireResult<LiveDiagnostics | undefined>(),
    refusal: "Could not read the voice diagnostics on this system.",
  },
  [ACT_KIND.MICROPHONE_REQUEST]: {
    payload: noPayload,
    result: wireResult<MicrophoneStatus>(),
    refusal: "Could not ask for the microphone on this system.",
  },
  [ACT_KIND.MICROPHONE_ROUTE]: {
    payload: noPayload,
    result: wireResult<MicrophoneRoute | undefined>(),
    refusal: "Could not read the microphone route on this system.",
  },
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: press("Could not open the microphone privacy settings."),
  [ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: press("Could not open the notification settings."),
  [ACT_KIND.NOTIFICATIONS_TEST]: press("Could not post a notification on this system."),
  [ACT_KIND.CONTACT_EMAIL]: press("Could not open a new email on this system."),
  [ACT_KIND.WINDOW_FOCUS_PANEL]: press("Could not focus the panel on this system."),
  [ACT_KIND.CALL_SHOW_TASK]: press("Could not bring the call's task forward on this system."),
  [ACT_KIND.AVATAR_REPORT]: {
    payload: actSchema(avatarStateSchema),
    result: answersNothing,
    refusal: "Could not report the video on this system.",
  },
  [ACT_KIND.VOICE_SET_VIDEO]: {
    payload: actSchema(voiceSetVideoParamsSchema),
    result: answersNothing,
    refusal: "Could not turn the video on or off on this system.",
  },
  [ACT_KIND.WINDOW_COPY_TEXT]: {
    // A task's whole document and a File tab's whole file are copied
    // through this act, so it admits the longer of the two the service
    // holds, and an empty document copies as the empty text it is.
    payload: record({
      words: exactTextAllowingEmpty(Math.max(PLAN_MARKDOWN_MAX_CHARS, FILE_TEXT_MAX_CHARS)),
    }),
    result: answersNothing,
    refusal: "Could not copy that to the clipboard on this system.",
  },
  [ACT_KIND.WINDOW_SAVE_FILE]: {
    // A File tab's file, saved where the developer chooses in the system's
    // save dialog; answers whether it was saved rather than the dialog cancelled.
    payload: record({ name: savedFileName, text: exactTextAllowingEmpty(FILE_TEXT_MAX_CHARS) }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not save that file on this system.",
  },
  [ACT_KIND.FEEDBACK_SEND]: {
    payload: fields<{ submission: FeedbackSubmission }>({
      submission: (value) => feedbackSubmission(value) !== undefined,
    }),
    result: wireResult<FeedbackResult>(),
    refusal: "Could not send that on this system.",
  },
} as const satisfies Record<ActKind, ActDeclaration<unknown, unknown>>;

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT)[Kind]["payload"]>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT)[Kind]["result"]>;

/**
 * One command as it crosses: the kind, and the payload its kind takes. A kind
 * that carries nothing has no `payload` key at all, so a payload sent to one
 * is a shape this type cannot describe and the boundary refuses.
 */
export type Act = {
  [Kind in ActKind]: ActPayload<Kind> extends undefined
    ? { readonly kind: Kind }
    : { readonly kind: Kind; readonly payload: ActPayload<Kind> };
}[ActKind];

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

const ACT_KINDS: readonly string[] = Object.values(ACT_KIND);

function isActKind(value: UnparsedWireValue): value is ActKind {
  return isWireString(value) && ACT_KINDS.includes(value);
}

/**
 * One act as its kind's own schema admits it, or nothing. The whole envelope
 * is read: an unnamed kind, a key beside `kind` and `payload`, a payload a
 * kind takes none of, and a payload its schema refuses are each refused here.
 */
export function parsedAct(value: UnparsedWireValue): Act | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (key !== "kind" && key !== "payload") return undefined;
  const kind = value.kind;
  if (!isActKind(kind)) return undefined;
  const read = ACT[kind].payload.read(value.payload);
  if (!read.ok) return undefined;
  // SAFETY: the kind's own schema admitted this payload, which is the pairing Act declares.
  return (read.value === undefined ? { kind } : { kind, payload: read.value }) as Act;
}

/** Whether an answer is one of the three outcomes, whatever its kind's own value is. */
export function isActOutcome(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) return Object.keys(value).length === 1;
  if (value.status === ACT_OUTCOME_STATUS.REFUSED) {
    return Object.keys(value).length === 2 && isWireString(value.reason);
  }
  if (value.status !== ACT_OUTCOME_STATUS.DONE) return false;
  for (const key of Object.keys(value)) if (key !== "status" && key !== "value") return false;
  return isWireValue(value.value);
}
