import type { WireValue } from "@repo/wire";
import { Effect, Schema } from "effect";

export const GATEWAY_METHOD = {
  SHUTDOWN: "gateway.shutdown",
  TASKS_REFRESH: "tasks.refresh",
  TASKS_RESYNC: "tasks.resync",
  TASKS_REGAINED: "tasks.regained",
  TASKS_OFFLINE_REFUSED_CLEAR: "tasks.offlineRefusedClear",
  TASKS_OPEN: "tasks.open",
  TASKS_CLOSE: "tasks.close",
  TASKS_START: "tasks.start",
  TASKS_DELETE: "tasks.delete",
  TASKS_RENAME: "tasks.rename",
  TASKS_PIN: "tasks.pin",
  TASKS_MARK_READ: "tasks.markRead",
  TASKS_PIN_REPOSITORY: "tasks.pinRepository",
  TASKS_WRITE_SECTION: "tasks.writeSection",
  TASKS_REPOSITORIES_FOLLOW: "tasks.repositoriesFollow",
  TASKS_REPOSITORIES_UNFOLLOW: "tasks.repositoriesUnfollow",
  TASKS_REPOSITORIES_RETRY: "tasks.repositoriesRetry",
  TASKS_SET_REPOSITORY: "tasks.setRepository",
  TASKS_SET_STANDING: "tasks.setStanding",
  TASKS_MOVE: "tasks.move",
  TASKS_BLOCK: "tasks.block",
  TASKS_SET_PARENT: "tasks.setParent",
  TASKS_CHANGE_RELATION: "tasks.changeRelation",
  TASKS_EDIT: "tasks.edit",
  TASKS_FILE: "tasks.file",
  TASKS_TREE: "tasks.tree",
  TASKS_SKILLS: "tasks.skills",
  TASKS_LINK_STANDING_FOLLOW: "tasks.linkStandingFollow",
  TASKS_LINK_STANDING_UNFOLLOW: "tasks.linkStandingUnfollow",
  TASKS_BROWSER_TAB_OPEN: "tasks.browserTabOpen",
  TASKS_FIND: "tasks.find",
  TASKS_REVISIONS: "tasks.revisions",
  TASKS_REVISION: "tasks.revision",
  TASKS_PAGE: "tasks.page",
  TASKS_PAGES_FOLLOW: "tasks.pagesFollow",
  TASKS_PAGES_UNFOLLOW: "tasks.pagesUnfollow",
  TASKS_DOCUMENT_FOLLOW: "tasks.documentFollow",
  TASKS_DOCUMENT_UNFOLLOW: "tasks.documentUnfollow",
  TASKS_DOCUMENT_RETRY: "tasks.documentRetry",
  TASKS_HISTORY_FOLLOW: "tasks.historyFollow",
  TASKS_HISTORY_UNFOLLOW: "tasks.historyUnfollow",
  TASKS_HISTORY_RETRY: "tasks.historyRetry",
  TASKS_BROWSER_TABS_FOLLOW: "tasks.browserTabsFollow",
  TASKS_BROWSER_TABS_UNFOLLOW: "tasks.browserTabsUnfollow",
  TASKS_PICTURE: "tasks.picture",
  TASKS_PICTURE_KEEP: "tasks.pictureKeep",
  TASKS_COMMENTS_FOLLOW: "tasks.commentsFollow",
  TASKS_COMMENTS_UNFOLLOW: "tasks.commentsUnfollow",
  TASKS_COMMENTS_RETRY: "tasks.commentsRetry",
  TASKS_COMMENT_START: "tasks.commentStart",
  TASKS_COMMENT_ACT: "tasks.commentAct",
  TASKS_RESTORE: "tasks.restore",
  WORKSPACES_REFRESH: "workspaces.refresh",
  WORKSPACES_CREATE: "workspaces.create",
  WORKSPACES_RENAME: "workspaces.rename",
  WORKSPACES_SLUG_SET: "workspaces.slugSet",
  WORKSPACES_PHOTO_SET: "workspaces.photoSet",
  WORKSPACES_GITHUB_CONNECT: "workspaces.githubConnect",
  WORKSPACES_GITHUB_DISCONNECT: "workspaces.githubDisconnect",
  WORKSPACES_SENTRY_INSTALL: "workspaces.sentryInstall",
  WORKSPACES_SENTRY_DISCONNECT: "workspaces.sentryDisconnect",
  WORKSPACES_SLACK_BOT_CONNECT: "workspaces.slackBotConnect",
  WORKSPACES_SLACK_BOT_DISCONNECT: "workspaces.slackBotDisconnect",
  WORKSPACES_SLACK_BOT_NOTIFICATIONS: "workspaces.slackBotNotifications",
  WORKSPACES_SLACK_BOT_REPOSITORY: "workspaces.slackBotRepository",
  WORKSPACES_SLACK_BOT_CHANNEL: "workspaces.slackBotChannel",
  WORKSPACES_INTEGRATIONS_FOLLOW: "workspaces.integrationsFollow",
  WORKSPACES_INTEGRATIONS_UNFOLLOW: "workspaces.integrationsUnfollow",
  WORKSPACES_INTEGRATIONS_RETRY: "workspaces.integrationsRetry",
  WORKSPACES_SLACK_CHANNELS_FOLLOW: "workspaces.slackChannelsFollow",
  WORKSPACES_SLACK_CHANNELS_UNFOLLOW: "workspaces.slackChannelsUnfollow",
  WORKSPACES_SLACK_CHANNELS_RETRY: "workspaces.slackChannelsRetry",
  WORKSPACES_MEMBERS_FOLLOW: "workspaces.membersFollow",
  WORKSPACES_MEMBERS_UNFOLLOW: "workspaces.membersUnfollow",
  WORKSPACES_MEMBERS_RETRY: "workspaces.membersRetry",
  WORKSPACES_INVITATIONS_FOLLOW: "workspaces.invitationsFollow",
  WORKSPACES_INVITATIONS_UNFOLLOW: "workspaces.invitationsUnfollow",
  WORKSPACES_INVITATIONS_RETRY: "workspaces.invitationsRetry",
  WORKSPACES_TOKEN_REPOSITORIES_FOLLOW: "workspaces.tokenRepositoriesFollow",
  WORKSPACES_TOKEN_REPOSITORIES_UNFOLLOW: "workspaces.tokenRepositoriesUnfollow",
  WORKSPACES_TOKEN_REPOSITORIES_RETRY: "workspaces.tokenRepositoriesRetry",
  WORKSPACES_TOKEN_REPOSITORY_SET: "workspaces.tokenRepositorySet",
  WORKSPACES_MEMBER_REMOVE: "workspaces.memberRemove",
  WORKSPACES_MEMBER_ROLE: "workspaces.memberRole",
  WORKSPACES_TRANSFER: "workspaces.transfer",
  WORKSPACES_LEAVE: "workspaces.leave",
  WORKSPACES_INVITE: "workspaces.invite",
  WORKSPACES_INVITATION_CANCEL: "workspaces.invitationCancel",
  GITHUB_CONNECT: "github.connect",
  GITHUB_DISCONNECT: "github.disconnect",
  ADMIN_READ: "admin.read",
  ADMIN_FAVORITE: "admin.favorite",
  AGENTS_MODELS_FOLLOW: "agents.modelsFollow",
  AGENTS_MODELS_UNFOLLOW: "agents.modelsUnfollow",
  AGENTS_MODELS_RETRY: "agents.modelsRetry",
  AGENTS_DEFAULT_WRITE: "agents.defaultWrite",
  HOSTS_FOLLOW: "hosts.follow",
  HOSTS_UNFOLLOW: "hosts.unfollow",
  HOSTS_RETRY: "hosts.retry",
  HOSTS_PRESENCE_FOLLOW: "hosts.presenceFollow",
  HOSTS_PRESENCE_UNFOLLOW: "hosts.presenceUnfollow",
  HOSTS_PRESENCE_REFRESH: "hosts.presenceRefresh",
  HOSTS_REMOVE: "hosts.remove",
  HOSTS_THIS_MAC_SET: "hosts.thisMacSet",
  HOSTS_PAIRING_READ: "hosts.pairingRead",
  HOSTS_PAIRING_APPROVE: "hosts.pairingApprove",
  HOSTS_PAIRING_DENY: "hosts.pairingDeny",
  AGENTS_LIST: "agents.list",
  AGENTS_WORKSPACE_LIST: "agents.workspaceList",
  AGENTS_START: "agents.start",
  AGENTS_MESSAGES: "agents.messages",
  AGENTS_TRANSCRIPT_FOLLOW: "agents.transcriptFollow",
  AGENTS_TRANSCRIPT_UNFOLLOW: "agents.transcriptUnfollow",
  AGENTS_TRANSCRIPT_RETRY: "agents.transcriptRetry",
  AGENTS_TRANSCRIPT_OLDER: "agents.transcriptOlder",
  AGENTS_MESSAGE: "agents.message",
  AGENTS_CHOOSE: "agents.choose",
  AGENTS_RENAME: "agents.rename",
  AGENTS_SERVERS: "agents.servers",
  AGENTS_ADD_REPOSITORY: "agents.addRepository",
  AGENTS_QUEUE: "agents.queue",
  AGENTS_STOP: "agents.stop",
  AGENTS_REWIND: "agents.rewind",
  AGENTS_ARCHIVE: "agents.archive",
  AGENTS_PIN: "agents.pin",
  AGENTS_MARK_READ: "agents.markRead",
  AGENTS_DELETE: "agents.delete",
  AGENTS_PAGE: "agents.page",
  AGENTS_ORIGIN_FOLLOW: "agents.originFollow",
  AGENTS_ORIGIN_UNFOLLOW: "agents.originUnfollow",
  AGENTS_ORIGIN_RETRY: "agents.originRetry",
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
  AUTOMATIONS_FOLLOW: "automations.follow",
  AUTOMATIONS_UNFOLLOW: "automations.unfollow",
  AUTOMATIONS_RETRY: "automations.retry",
  INSTALLED_SKILLS_FOLLOW: "installedSkills.follow",
  INSTALLED_SKILLS_UNFOLLOW: "installedSkills.unfollow",
  INSTALLED_SKILLS_RETRY: "installedSkills.retry",
  INSTALLED_SKILLS_READ: "installedSkills.read",
  INSTALLED_SKILLS_PREVIEW: "installedSkills.preview",
  INSTALLED_SKILLS_INSTALL: "installedSkills.install",
  INSTALLED_SKILLS_REMOVE: "installedSkills.remove",
  AGENTS_PULL_REQUEST_PART_FOLLOW: "agents.pullRequestPartFollow",
  AGENTS_PULL_REQUEST_PART_UNFOLLOW: "agents.pullRequestPartUnfollow",
  AGENTS_PULL_REQUEST_PART_RETRY: "agents.pullRequestPartRetry",
  AGENTS_CHANGES: "agents.changes",
  AGENTS_CHAPTERS_FOLLOW: "agents.chaptersFollow",
  AGENTS_CHAPTERS_UNFOLLOW: "agents.chaptersUnfollow",
  AGENTS_CHAPTERS_RETRY: "agents.chaptersRetry",
  AGENTS_CHAPTERS_GENERATE: "agents.chaptersGenerate",
  AGENTS_WORKSPACE_TOOLS_FOLLOW: "agents.workspaceToolsFollow",
  AGENTS_WORKSPACE_TOOLS_UNFOLLOW: "agents.workspaceToolsUnfollow",
  AGENTS_WORKSPACE_TOOLS_RETRY: "agents.workspaceToolsRetry",
  AGENTS_GITHUB_IMAGE: "agents.githubImage",
  AGENTS_PULL_REQUEST_ACTION: "agents.pullRequestAction",
  PROVIDER_KEYS_FOLLOW: "providerKeys.follow",
  PROVIDER_KEYS_UNFOLLOW: "providerKeys.unfollow",
  PROVIDER_KEYS_RETRY: "providerKeys.retry",
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  PROVIDER_KEYS_FOR_AGENTS: "providerKeys.forAgents",
  CHATGPT_DEVICE_START: "chatGpt.device.start",
  CHATGPT_DEVICE_WAIT: "chatGpt.device.wait",
  CHATGPT_DEVICE_CANCEL: "chatGpt.device.cancel",
  GITHUB_TOKEN_FOLLOW: "githubToken.follow",
  GITHUB_TOKEN_UNFOLLOW: "githubToken.unfollow",
  GITHUB_TOKEN_RETRY: "githubToken.retry",
  GITHUB_TOKEN_SAVE: "githubToken.save",
  GITHUB_TOKEN_REMOVE: "githubToken.remove",
  MEMORIES_FOLLOW: "memories.follow",
  MEMORIES_UNFOLLOW: "memories.unfollow",
  MEMORIES_RETRY: "memories.retry",
  MEMORIES_FORGET: "memories.forget",
  DICTATION_TRANSCRIBE: "dictation.transcribe",
  AGENTS_INBOX_FOLLOW: "agents.inboxFollow",
  AGENTS_INBOX_UNFOLLOW: "agents.inboxUnfollow",
  AGENTS_INBOX_RETRY: "agents.inboxRetry",
  AGENTS_INBOX_ANSWER: "agents.inboxAnswer",
  AGENTS_INBOX_CLOSE: "agents.inboxClose",
  AGENTS_INBOX_MESSAGE: "agents.inboxMessage",
  AGENTS_INBOX_START: "agents.inboxStart",
  AGENTS_INBOX_READ_STATE: "agents.inboxReadState",
  AGENTS_INBOX_REMIND: "agents.inboxSnooze",
  AGENTS_INBOX_ITEM_HOME: "agents.inboxItemHome",
  AGENTS_INBOX_READ_ALL: "agents.inboxReadAll",
  INTEGRATIONS_FOLLOW: "integrations.follow",
  INTEGRATIONS_UNFOLLOW: "integrations.unfollow",
  INTEGRATIONS_RETRY: "integrations.retry",
  INTEGRATIONS_CONNECT: "integrations.connect",
  INTEGRATIONS_TOOLS_FOLLOW: "integrations.toolsFollow",
  INTEGRATIONS_TOOLS_UNFOLLOW: "integrations.toolsUnfollow",
  INTEGRATIONS_TOOLS_RETRY: "integrations.toolsRetry",
  INTEGRATIONS_CANCEL: "integrations.cancel",
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  INTEGRATIONS_RENAME: "integrations.rename",
  MCP_CLIENTS_FOLLOW: "mcpClients.follow",
  MCP_CLIENTS_UNFOLLOW: "mcpClients.unfollow",
  MCP_CLIENTS_RETRY: "mcpClients.retry",
  MCP_CLIENTS_REVOKE: "mcpClients.revoke",
  AGENTS_ACCOUNT_INBOX_FOLLOW: "agents.accountInboxFollow",
  AGENTS_ACCOUNT_INBOX_UNFOLLOW: "agents.accountInboxUnfollow",
  AGENTS_INBOX_ITEMS_RETRY: "agents.inboxItemsRetry",
  AGENTS_PREFERENCES_RETRY: "agents.preferencesRetry",
  AGENTS_INBOX_ATTACHMENT: "agents.inboxAttachment",
  AGENTS_PICTURE: "agents.picture",
  AGENTS_PART: "agents.part",
  TERMINALS_LIST: "terminals.list",
  TERMINALS_CREATE: "terminals.create",
  TERMINALS_RENAME: "terminals.rename",
  TERMINALS_KILL: "terminals.kill",
  TERMINALS_RESUME: "terminals.resume",
  TERMINALS_CONNECT: "terminals.connect",
  TERMINALS_INPUT: "terminals.input",
  TERMINALS_RESIZE: "terminals.resize",
  TERMINALS_ACK: "terminals.ack",
  TERMINALS_DISCONNECT: "terminals.disconnect",
  TERMINALS_WAKE: "terminals.wake",
  BROWSER_LIVE_CONNECT: "browserLive.connect",
  BROWSER_LIVE_SEND: "browserLive.send",
  BROWSER_LIVE_DISCONNECT: "browserLive.disconnect",
  PORT_FORWARDS_SET: "portForwards.set",
  MIRRORS_ENSURE: "mirrors.ensure",
  CLIENT_BOOTSTRAP: "client.bootstrap",
  SETTINGS_SNAPSHOT: "settings.snapshot",
  SETTINGS_UPDATE: "settings.update",
  SETTINGS_RESET: "settings.reset",
  MAC_COMMAND_ANSWER: "macCommands.answer",
  EXPERIMENTS_SET: "experiments.set",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  ACCOUNT_SUPPORT_ACCESS: "account.supportAccess",
  ANALYTICS_RECORD: "analytics.record",
} as const;

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

export const GATEWAY_ERROR = {
  UNKNOWN_METHOD: "unknown_method",
  INVALID_PARAMS: "invalid_params",
  NOT_FOUND: "not_found",
  REFUSED: "refused",
  NODE_UNAVAILABLE: "node_unavailable",
  UNKNOWN_CAPABILITY: "unknown_capability",
  INTERNAL: "internal",
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR)[keyof typeof GATEWAY_ERROR];

export interface GatewayError {
  readonly code: GatewayErrorCode;
  readonly message: string;
}

function refusalCode<Code extends GatewayErrorCode>(code: Code) {
  return Schema.Literal(code).pipe(Schema.withConstructorDefault(Effect.succeed(code)));
}

export class UnknownMethodRefusal extends Schema.TaggedError<UnknownMethodRefusal>()(
  "UnknownMethodRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_METHOD), message: Schema.String },
) {}

export class InvalidParamsRefusal extends Schema.TaggedError<InvalidParamsRefusal>()(
  "InvalidParamsRefusal",
  { code: refusalCode(GATEWAY_ERROR.INVALID_PARAMS), message: Schema.String },
) {}

export class NotFoundRefusal extends Schema.TaggedError<NotFoundRefusal>()("NotFoundRefusal", {
  code: refusalCode(GATEWAY_ERROR.NOT_FOUND),
  message: Schema.String,
}) {}

export class RefusedRefusal extends Schema.TaggedError<RefusedRefusal>()("RefusedRefusal", {
  code: refusalCode(GATEWAY_ERROR.REFUSED),
  message: Schema.String,
}) {}

export class NodeUnavailableRefusal extends Schema.TaggedError<NodeUnavailableRefusal>()(
  "NodeUnavailableRefusal",
  { code: refusalCode(GATEWAY_ERROR.NODE_UNAVAILABLE), message: Schema.String },
) {}

export class UnknownCapabilityRefusal extends Schema.TaggedError<UnknownCapabilityRefusal>()(
  "UnknownCapabilityRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_CAPABILITY), message: Schema.String },
) {}

export class InternalRefusal extends Schema.TaggedError<InternalRefusal>()("InternalRefusal", {
  code: refusalCode(GATEWAY_ERROR.INTERNAL),
  message: Schema.String,
}) {}

export type GatewayRefusal =
  | UnknownMethodRefusal
  | InvalidParamsRefusal
  | NotFoundRefusal
  | RefusedRefusal
  | NodeUnavailableRefusal
  | UnknownCapabilityRefusal
  | InternalRefusal;

export const GATEWAY_EVENT = {
  NODE_CHANGED: "node.changed",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CHANGED: "account.changed",
  ACCOUNT_ACCESS_CHANGED: "accountAccess.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
  TASKS_CHANGED: "tasks.changed",
  TERMINAL_OUTPUT: "terminal.output",
  TERMINAL_STATE: "terminal.state",
  BROWSER_LIVE_MESSAGE: "browserLive.message",
  BROWSER_LIVE_CLOSED: "browserLive.closed",
  PAGES_CHANGED: "pages.changed",
  DESCRIPTION_COMMENTS_CHANGED: "descriptionComments.changed",
  DESCRIPTION_DOCUMENTS_CHANGED: "descriptionDocuments.changed",
  HISTORIES_CHANGED: "histories.changed",
  AUTOMATIONS_CHANGED: "automations.changed",
  WORKSPACE_MEMBERS_CHANGED: "workspaceMembers.changed",
  WORKSPACE_INTEGRATIONS_CHANGED: "workspaceIntegrations.changed",
  SLACK_CHANNELS_CHANGED: "slackChannels.changed",
  WORKSPACE_PHOTOS_CHANGED: "workspacePhotos.changed",
  WORKSPACE_INVITATIONS_CHANGED: "workspaceInvitations.changed",
  AGENT_ORIGINS_CHANGED: "agentOrigins.changed",
  TRANSCRIPTS_CHANGED: "transcripts.changed",
  HOLDER_INBOXES_CHANGED: "holderInboxes.changed",
  LINK_STANDINGS_CHANGED: "linkStandings.changed",
  CHAPTERS_CHANGED: "chapters.changed",
  PULL_REQUEST_PARTS_CHANGED: "pullRequestParts.changed",
  ACCOUNT_INBOX_CHANGED: "accountInbox.changed",
  INBOX_ITEMS_CHANGED: "inboxItems.changed",
  ACCOUNT_PREFERENCES_CHANGED: "accountPreferences.changed",
  BROWSER_TABS_CHANGED: "browserTabs.changed",
  INSTALLED_SKILLS_CHANGED: "installedSkills.changed",
  INTEGRATIONS_CHANGED: "integrations.changed",
  DEVICE_PRESENCE_CHANGED: "devicePresence.changed",
  HOSTS_CHANGED: "hosts.changed",
  THIS_MAC_HOST_CHANGED: "thisMacHost.changed",
  WORKSPACE_TOOLS_CHANGED: "workspaceTools.changed",
  MCP_CLIENTS_CHANGED: "mcpClients.changed",
  PORT_FORWARDS_CHANGED: "portForwards.changed",
  OFFLINE_REFUSED_CHANGED: "offlineRefused.changed",
  INTEGRATION_TOOLS_CHANGED: "integrationTools.changed",
  MEMORIES_CHANGED: "memories.changed",
  PROVIDER_KEYS_CHANGED: "providerKeys.changed",
  MODELS_CHANGED: "models.changed",
  GITHUB_TOKEN_CHANGED: "githubToken.changed",
  TOKEN_REPOSITORIES_CHANGED: "tokenRepositories.changed",
  MAC_COMMAND_ASKS_CHANGED: "macCommandAsks.changed",
  REPOSITORY_LISTS_CHANGED: "repositoryLists.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

export const GATEWAY_CLIENT_ROLE = {
  OPERATOR: "operator",
  NODE: "node",
} as const;

export type GatewayClientRole = (typeof GATEWAY_CLIENT_ROLE)[keyof typeof GATEWAY_CLIENT_ROLE];

export interface GatewayClientIdentity {
  clientId: string;
  role: GatewayClientRole;
}

export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
  UNKNOWN: "unknown",
} as const;

export type NodeCapabilityResult =
  | { readonly status: typeof NODE_CAPABILITY_STATUS.OK; readonly value: WireValue | undefined }
  | {
      readonly status:
        | typeof NODE_CAPABILITY_STATUS.UNAVAILABLE
        | typeof NODE_CAPABILITY_STATUS.FAILED
        | typeof NODE_CAPABILITY_STATUS.UNKNOWN;
      readonly capability: string;
      readonly reason: string;
    };
