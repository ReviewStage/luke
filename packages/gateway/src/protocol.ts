/**
 * protocol.ts -- the Gateway's vocabulary: the methods a client asks the host,
 * the events the host tells every client, the refusals a handler fails with,
 * and the parameter and result shapes the desktop reads.
 *
 * The vocabulary lives here, below every implementation, so the host that
 * answers a method and the client that calls it read the same words from one
 * contract. Nothing in this file performs anything.
 */
import type { WireValue } from "@repo/wire";
import { Effect, Schema } from "effect";

/** Every method the host answers, by the name a client calls it. */
export const GATEWAY_METHOD = {
  SHUTDOWN: "gateway.shutdown",
  /** The Mac woke or unlocked: a task list already followed is sealed and followed again now, once however many of those land together. */
  TASKS_RESYNC: "tasks.resync",
  /** The app reaches the service again (`networkConnected` turned true): every read a window holds is asked again now, and a task list already followed is sealed and followed again, whatever resync came lately. */
  TASKS_REGAINED: "tasks.regained",
  /**
   * The repositories the account reaches in one workspace, or in every one
   * where the params name none, held for a window from now until it is let
   * go, asked of the service at once and again as a window comes forward, as
   * the workspace's installations move, and as a token or a token repository
   * changes, and a while after among the reads let go lately. What it holds is
   * heard as `REPOSITORY_LISTS_CHANGED` events, on the app state every window
   * draws, never answered.
   */
  TASKS_REPOSITORIES_FOLLOW: "tasks.repositoriesFollow",
  /** One workspace's repositories let go by the window that held them. */
  TASKS_REPOSITORIES_UNFOLLOW: "tasks.repositoriesUnfollow",
  /** One workspace's held repositories asked again at once, as Try again asks; answered once the ask has landed. */
  TASKS_REPOSITORIES_RETRY: "tasks.repositoriesRetry",
  /**
   * What GitHub holds of the pull request or issue a link names, through a
   * workspace's installation, held for a window from now until it is let go
   * and asked again as a window comes forward, no oftener than the host keeps
   * a link's read, and a while after among the reads let go lately. What it
   * holds is heard as `LINK_STANDINGS_CHANGED` events, on the app state every
   * window draws, never answered.
   */
  TASKS_LINK_STANDING_FOLLOW: "tasks.linkStandingFollow",
  /** One link's standing let go by the window that held it. */
  TASKS_LINK_STANDING_UNFOLLOW: "tasks.linkStandingUnfollow",
  /** One version of one page of one plan with its HTML, read from the service for the frame that draws it; answered to the caller, never held in the view. */
  TASKS_PAGE: "tasks.page",
  /**
   * One plan's pages, or one agent's on no task, held followed for a window
   * from now until it is let go, over Neon Realtime, and a while after among
   * those let go lately: the open task's, an Inbox item's plan's, an agent's
   * page's, or a page's card's. What they hold is heard as `PAGES_CHANGED`
   * events, on the app state every window draws, never answered.
   */
  TASKS_PAGES_FOLLOW: "tasks.pagesFollow",
  /** One plan's or agent's pages let go by the window that held them: they stay among those let go lately until later ones push them out. */
  TASKS_PAGES_UNFOLLOW: "tasks.pagesUnfollow",
  /**
   * One task's description held for a window from now until it is let go, and a
   * while after among those let go lately: the task's record followed over
   * the service's held poll, and its description read again whenever its mark moves
   * past the copy held. What it holds is heard as `DESCRIPTION_DOCUMENTS_CHANGED`
   * events, on the app state every window draws, never answered.
   */
  TASKS_DOCUMENT_FOLLOW: "tasks.documentFollow",
  /** One task's description let go by the window that held it: it stays among those let go lately until later ones push it out. */
  TASKS_DOCUMENT_UNFOLLOW: "tasks.documentUnfollow",
  /** One task's held description read again at once, as Try again asks; never answered. */
  TASKS_DOCUMENT_RETRY: "tasks.documentRetry",
  /**
   * One task's description history held for a window's version history from now
   * until it is let go, and a while after among those let go lately: its
   * newest page followed over the service's held poll, and the older pages
   * read past it laid after it. What it holds is heard as
   * `HISTORIES_CHANGED` events, on the app state every window draws, never
   * answered.
   */
  TASKS_HISTORY_FOLLOW: "tasks.historyFollow",
  /** One task's history let go by the window that held it: it stays among those let go lately until later ones push it out. */
  TASKS_HISTORY_UNFOLLOW: "tasks.historyUnfollow",
  /** One task's held history read again at once, as Try again asks; never answered. */
  TASKS_HISTORY_RETRY: "tasks.historyRetry",
  /**
   * One task's cloud Browser tabs, every one of its agents', or one agent's,
   * the agent's pointer on each among them, held followed for a window's
   * side panel from now until it is let go, over Neon Realtime, and a while
   * after among those let go lately. What they hold is heard as
   * `BROWSER_TABS_CHANGED` events, on the app state every window draws,
   * never answered.
   */
  TASKS_BROWSER_TABS_FOLLOW: "tasks.browserTabsFollow",
  /** One task's or agent's Browser tabs let go by the window that held them: they stay among those let go lately until later ones push them out. */
  TASKS_BROWSER_TABS_UNFOLLOW: "tasks.browserTabsUnfollow",
  /**
   * One task's comments, its description's own threads or one page's, held followed
   * for a window from now until it is let go, over Neon Realtime, and a
   * while after among those let go lately: the open task's description's, or a page
   * tab's. What they hold is heard as `DESCRIPTION_COMMENTS_CHANGED` events, on the
   * app state every window draws, never answered.
   */
  TASKS_COMMENTS_FOLLOW: "tasks.commentsFollow",
  /** One task's description's or page's comments let go by the window that held them: they stay among those let go lately until later ones push them out. */
  TASKS_COMMENTS_UNFOLLOW: "tasks.commentsUnfollow",
  /** One held description's or page's comments read again at once, as Try again asks, where a window holds them or let them go lately. */
  TASKS_COMMENTS_RETRY: "tasks.commentsRetry",
  /** The account's workspaces read again from the service where the last read is a minute old or none stands; the view takes them. */
  WORKSPACES_REFRESH: "workspaces.refresh",
  /**
   * One workspace's own integrations, its Sentry installations and its Slack
   * bot, held followed for a window from now until it is let go, over Neon
   * Realtime, and a while after among those let go lately. What they hold is
   * heard as `WORKSPACE_INTEGRATIONS_CHANGED` events, on the app state every
   * window draws, never answered.
   */
  WORKSPACES_INTEGRATIONS_FOLLOW: "workspaces.integrationsFollow",
  /** One workspace's integrations let go by the window that held them: they stay among those let go lately until later ones push them out. */
  WORKSPACES_INTEGRATIONS_UNFOLLOW: "workspaces.integrationsUnfollow",
  /** One workspace's held integrations read again at once, as Try again asks; never answered. */
  WORKSPACES_INTEGRATIONS_RETRY: "workspaces.integrationsRetry",
  /**
   * The channels of one workspace's Slack team, as Slack lists them, held
   * for an owner's or an admin's window from now until it is let go: asked
   * as it is held, as a window comes forward, as the workspace's bot is
   * connected or disconnected, and as Try again asks. What they hold is heard
   * as `SLACK_CHANNELS_CHANGED` events, on the app state, never answered.
   */
  WORKSPACES_SLACK_CHANNELS_FOLLOW: "workspaces.slackChannelsFollow",
  /** One workspace's Slack channels let go by the window that held them. */
  WORKSPACES_SLACK_CHANNELS_UNFOLLOW: "workspaces.slackChannelsUnfollow",
  /** One workspace's held Slack channels asked again at once, as Try again asks; answered once the ask has landed. */
  WORKSPACES_SLACK_CHANNELS_RETRY: "workspaces.slackChannelsRetry",
  /**
   * One workspace's people, its members and who its work names but left,
   * held followed for a window from now until it is let go, over Neon
   * Realtime, and a while after among those let go lately. What they hold is
   * heard as `WORKSPACE_MEMBERS_CHANGED` events, on the app state every
   * window draws, never answered.
   */
  WORKSPACES_MEMBERS_FOLLOW: "workspaces.membersFollow",
  /** One workspace's people let go by the window that held them: they stay among those let go lately until later ones push them out. */
  WORKSPACES_MEMBERS_UNFOLLOW: "workspaces.membersUnfollow",
  /** One workspace's held people read again at once, as Try again asks; never answered. */
  WORKSPACES_MEMBERS_RETRY: "workspaces.membersRetry",
  /**
   * One workspace's pending invitations, held followed for an owner's or an
   * admin's window from now until it is let go, over Neon Realtime, and a
   * while after among those let go lately. What they hold is heard as
   * `WORKSPACE_INVITATIONS_CHANGED` events, on the app state every window
   * draws, never answered.
   */
  WORKSPACES_INVITATIONS_FOLLOW: "workspaces.invitationsFollow",
  /** One workspace's invitations let go by the window that held them: they stay among those let go lately until later ones push them out. */
  WORKSPACES_INVITATIONS_UNFOLLOW: "workspaces.invitationsUnfollow",
  /** One workspace's held invitations read again at once, as Try again asks; never answered. */
  WORKSPACES_INVITATIONS_RETRY: "workspaces.invitationsRetry",
  /**
   * The repositories members added to one workspace on their own GitHub
   * tokens, held for a window from now until it is let go, asked of the
   * service at once and again as a window comes forward, and a while after
   * among the reads let go lately. What it holds is heard as
   * `TOKEN_REPOSITORIES_CHANGED` events, on the app state every window
   * draws, never answered.
   */
  WORKSPACES_TOKEN_REPOSITORIES_FOLLOW: "workspaces.tokenRepositoriesFollow",
  /** One workspace's token repositories let go by the window that held them. */
  WORKSPACES_TOKEN_REPOSITORIES_UNFOLLOW: "workspaces.tokenRepositoriesUnfollow",
  /** One workspace's held token repositories asked again at once, as Try again asks; answered once the ask has landed. */
  WORKSPACES_TOKEN_REPOSITORIES_RETRY: "workspaces.tokenRepositoriesRetry",
  /**
   * The models a coding agent may run on as the account is offered them, and
   * its devices, held for a window from now until it is let go, asked of the
   * service at once, again as a window comes forward, as the account's
   * provider keys move, and every `MODEL_CATALOG_TTL`, and a while after
   * among the reads let go lately. What it holds is heard as
   * `MODELS_CHANGED` events, on the app state every window draws, never
   * answered.
   */
  AGENTS_MODELS_FOLLOW: "agents.modelsFollow",
  /** The models let go by the window that held them. */
  AGENTS_MODELS_UNFOLLOW: "agents.modelsUnfollow",
  /** The held models asked again at once, as Try again asks; answered once the ask has landed. */
  AGENTS_MODELS_RETRY: "agents.modelsRetry",
  /**
   * The account's hosts, held for a window from now until it is let go,
   * followed on the service's live read into the sync engine's pool, and a
   * while after among the reads let go lately. What it holds is heard as
   * `HOSTS_CHANGED` events, on the app state every window draws, never
   * answered.
   */
  HOSTS_FOLLOW: "hosts.follow",
  /** The account's hosts let go by the window that held them. */
  HOSTS_UNFOLLOW: "hosts.unfollow",
  /** The account's held hosts read again at once, as Try again asks. */
  HOSTS_RETRY: "hosts.retry",
  /**
   * When the account's own devices last beat, held for a window from now
   * until it is let go, asked of the service at once and again every
   * `MAC_PRESENCE.POLL_MS` while held, and a while after among the reads let
   * go lately. What it holds is heard as `DEVICE_PRESENCE_CHANGED` events, on
   * the app state every window draws, never answered.
   */
  HOSTS_PRESENCE_FOLLOW: "hosts.presenceFollow",
  /** The account's devices' beats let go by the window that held them. */
  HOSTS_PRESENCE_UNFOLLOW: "hosts.presenceUnfollow",
  /** The account's devices' beats asked again now, where a window holds them: the window came back online, or the Mac woke. */
  HOSTS_PRESENCE_REFRESH: "hosts.presenceRefresh",
  /**
   * One agent's transcript, or one of its workers', held followed for a
   * window from now until it is let go, over the service's held poll, and
   * kept a while after among those let go lately, following no longer. What
   * it holds is heard as `TRANSCRIPTS_CHANGED` events, on the app state
   * every window draws, never answered.
   */
  AGENTS_TRANSCRIPT_FOLLOW: "agents.transcriptFollow",
  /** One agent's or worker's transcript let go by the window that held it: it stops following, and its messages stay among those let go lately until later ones push them out. */
  AGENTS_TRANSCRIPT_UNFOLLOW: "agents.transcriptUnfollow",
  /** One held transcript read again at once, as Try again asks; never answered. */
  AGENTS_TRANSCRIPT_RETRY: "agents.transcriptRetry",
  /**
   * The run of an automation that started one agent, held followed for a
   * window from now until it is let go, over the service's held poll, and a
   * while after among those let go lately. What it holds is heard as
   * `AGENT_ORIGINS_CHANGED` events, on the app state every window draws,
   * never answered.
   */
  AGENTS_ORIGIN_FOLLOW: "agents.originFollow",
  /** One agent's origin let go by the window that held it: it stays among those let go lately until later ones push it out. */
  AGENTS_ORIGIN_UNFOLLOW: "agents.originUnfollow",
  /** One agent's held origin read again at once, as Try again asks; never answered. */
  AGENTS_ORIGIN_RETRY: "agents.originRetry",
  /**
   * A workspace's automations, a workspace's runs, or an automation's runs
   * held followed for the windows from now until let go, and a while after
   * among those let go lately, on the service's live read. What they hold
   * is heard as `AUTOMATIONS_CHANGED`, never answered; holding again holds
   * nothing anew.
   */
  AUTOMATIONS_FOLLOW: "automations.follow",
  /** A held list or history let go, kept followed a while among those let go lately. */
  AUTOMATIONS_UNFOLLOW: "automations.unfollow",
  /** A held list or history read again at once, as Try again asks. */
  AUTOMATIONS_RETRY: "automations.retry",
  /**
   * The skills the account sees in one workspace, the workspace's and its
   * own, held for a window from now until it is let go, followed on the
   * service's live read, and a while after among the reads let go lately.
   * What it holds is heard as `INSTALLED_SKILLS_CHANGED` events, on the app
   * state every window draws, never answered.
   */
  INSTALLED_SKILLS_FOLLOW: "installedSkills.follow",
  /** One workspace's skills let go by the window that held them. */
  INSTALLED_SKILLS_UNFOLLOW: "installedSkills.unfollow",
  /** One workspace's held skills read again at once, as Try again asks; answered once the ask has landed. */
  INSTALLED_SKILLS_RETRY: "installedSkills.retry",
  /**
   * One part of one agent's pull request as its Pull request tab draws it,
   * by the part, the agent, and the pull request's number, or no number for
   * the agent's own: the pull request itself, its checks, its conversation,
   * or what the agent published. Held for a window from now until it is let
   * go, asked of the service at once, again as a window comes forward, and
   * again with the tab's other parts as the agent ends or its listed pull
   * request moves, and a while after among the reads let go lately. What it
   * holds is heard as `PULL_REQUEST_PARTS_CHANGED` events, on the app state
   * every window draws, never answered.
   */
  AGENTS_PULL_REQUEST_PART_FOLLOW: "agents.pullRequestPartFollow",
  /** One pull request's part let go by the window that held it. */
  AGENTS_PULL_REQUEST_PART_UNFOLLOW: "agents.pullRequestPartUnfollow",
  /** One pull request's held part asked again at once, as Try again asks; answered once the ask has landed. */
  AGENTS_PULL_REQUEST_PART_RETRY: "agents.pullRequestPartRetry",
  /**
   * One agent's pull request's newest chapters, by the agent and the pull
   * request's number, held followed for a window from now until it is let
   * go, over the service's held poll, and a while after among those let go
   * lately. What they hold is heard as `CHAPTERS_CHANGED` events, on the app
   * state every window draws, never answered.
   */
  AGENTS_CHAPTERS_FOLLOW: "agents.chaptersFollow",
  /** One agent's pull request's chapters let go by the window that held them: they stay among those let go lately until later ones push them out. */
  AGENTS_CHAPTERS_UNFOLLOW: "agents.chaptersUnfollow",
  /** One agent's pull request's held chapters read again at once, as Try again asks; never answered. */
  AGENTS_CHAPTERS_RETRY: "agents.chaptersRetry",
  /**
   * Our own tools one agent is offered, held for a window from now until it
   * is let go, asked of the service at once and again as a window comes
   * forward, and a while after among the reads let go lately. What it holds
   * is heard as `WORKSPACE_TOOLS_CHANGED` events, on the app state every
   * window draws, never answered.
   */
  AGENTS_WORKSPACE_TOOLS_FOLLOW: "agents.workspaceToolsFollow",
  /** One agent's own tools let go by the window that held them. */
  AGENTS_WORKSPACE_TOOLS_UNFOLLOW: "agents.workspaceToolsUnfollow",
  /** One agent's held tools asked again at once, as Try again asks; answered once the ask has landed. */
  AGENTS_WORKSPACE_TOOLS_RETRY: "agents.workspaceToolsRetry",
  /**
   * The account's own provider keys an agent runs on, as hints and statuses
   * and never a key, held for a window from now until it is let go, asked
   * of the service at once and again as a window comes forward, and laid from
   * each save's, remove's, and plan default's own answer. What it holds is
   * heard as `PROVIDER_KEYS_CHANGED` events, on the app state every window
   * draws, never answered.
   */
  PROVIDER_KEYS_FOLLOW: "providerKeys.follow",
  /** The account's provider keys let go by the window that held them. */
  PROVIDER_KEYS_UNFOLLOW: "providerKeys.unfollow",
  /** The account's held provider keys asked again at once, as Try again asks; answered once the ask has landed. */
  PROVIDER_KEYS_RETRY: "providerKeys.retry",
  /**
   * The member's own GitHub token as its login, hint, and status, never the
   * token, held for a window from now until it is let go, asked of the
   * service at once and again as a window comes forward, and a while after
   * among the reads let go lately. What it holds is heard as
   * `GITHUB_TOKEN_CHANGED` events, on the app state every window draws,
   * never answered.
   */
  GITHUB_TOKEN_FOLLOW: "githubToken.follow",
  /** The member's GitHub token let go by the window that held it. */
  GITHUB_TOKEN_UNFOLLOW: "githubToken.unfollow",
  /** The member's held GitHub token asked again at once, as Try again asks; answered once the ask has landed. */
  GITHUB_TOKEN_RETRY: "githubToken.retry",
  /**
   * The memories our agents kept in one workspace, held for a window from
   * now until it is let go, followed on the service's live read, and a while
   * after among the reads let go lately. What it holds is heard as
   * `MEMORIES_CHANGED` events, on the app state every window draws, never
   * answered.
   */
  MEMORIES_FOLLOW: "memories.follow",
  /** One workspace's memories let go by the window that held them. */
  MEMORIES_UNFOLLOW: "memories.unfollow",
  /** One workspace's held memories read again at once, as Try again asks; answered once the ask has landed. */
  MEMORIES_RETRY: "memories.retry",
  /**
   * One plan's inbox, or one agent's, held followed for a window from now
   * until it is let go, over Neon Realtime, and a while after among the
   * holders let go lately. What it holds is heard as `HOLDER_INBOXES_CHANGED`
   * events, on the app state every window draws, never answered.
   */
  AGENTS_INBOX_FOLLOW: "agents.inboxFollow",
  /** One plan's or agent's inbox let go by the window that held it: it stays among the holders let go lately until later ones push it out. */
  AGENTS_INBOX_UNFOLLOW: "agents.inboxUnfollow",
  /** One plan's or agent's held inbox read again at once, as Try again asks; never answered. */
  AGENTS_INBOX_RETRY: "agents.inboxRetry",
  /**
   * Where every one of the account's integrations stands, held for a window
   * from now until it is let go, followed on the service's live read with
   * GitHub's standing asked beside it, and a while after among the reads let
   * go lately; while a sign-in stands pending, the host settles it on its
   * own. What it holds is heard as `INTEGRATIONS_CHANGED` events, on the app
   * state every window draws, never answered.
   */
  INTEGRATIONS_FOLLOW: "integrations.follow",
  /** The account's integrations let go by the window that held them. */
  INTEGRATIONS_UNFOLLOW: "integrations.unfollow",
  /** The account's held integrations read again at once, as Try again asks. */
  INTEGRATIONS_RETRY: "integrations.retry",
  /**
   * The tools one account's server offers the account's agents, held for a
   * window from now until it is let go, asked of the service at once and
   * again as a window comes forward, and a while after among the reads let go
   * lately. What it holds is heard as `INTEGRATION_TOOLS_CHANGED` events, on
   * the app state every window draws, never answered.
   */
  INTEGRATIONS_TOOLS_FOLLOW: "integrations.toolsFollow",
  /** One server's tools let go by the window that held them. */
  INTEGRATIONS_TOOLS_UNFOLLOW: "integrations.toolsUnfollow",
  /** One server's held tools asked again at once, as Try again asks; answered once the ask has landed. */
  INTEGRATIONS_TOOLS_RETRY: "integrations.toolsRetry",
  /**
   * The outside MCP clients the account allowed, held for the windows from
   * now until let go, under the account signed in: read from the service as
   * held, and again whenever a window comes forward. What it holds is heard
   * as `MCP_CLIENTS_CHANGED` events, on the state channel, never answered.
   */
  MCP_CLIENTS_FOLLOW: "mcpClients.follow",
  /** The outside MCP clients let go: no more asks for them until they are followed again. */
  MCP_CLIENTS_UNFOLLOW: "mcpClients.unfollow",
  /** The outside MCP clients the windows hold read again now, as Try again asks; answered once the read has landed. */
  MCP_CLIENTS_RETRY: "mcpClients.retry",
  /**
   * What waits on the developer across the account, followed from now until
   * it is let go or the account signs out: every open inbox item, heard as
   * `ACCOUNT_INBOX_CHANGED` events, never answered; following again starts
   * over. Main's own follow, which no window asks.
   */
  AGENTS_ACCOUNT_INBOX_FOLLOW: "agents.accountInboxFollow",
  /** The account inbox let go: no more `ACCOUNT_INBOX_CHANGED` events until it is followed again. */
  AGENTS_ACCOUNT_INBOX_UNFOLLOW: "agents.accountInboxUnfollow",
  /** Every inbox item the account reaches, which the host holds for the session, read again at once, as Try again asks; never answered. */
  AGENTS_INBOX_ITEMS_RETRY: "agents.inboxItemsRetry",
  /** The account's preferences row, which the host holds for the session, read again at once, as Try again asks; never answered. */
  AGENTS_PREFERENCES_RETRY: "agents.preferencesRetry",
  /**
   * A coding agent's terminals (`@repo/features/terminal-view`): its shells
   * listed, started, named, and ended, and its sandbox resumed on the
   * developer's click; and a shell attached for one panel under a
   * connection id the desktop minted, typed into, resized, acked, woken
   * after a sleep, and detached. What a shell prints is heard as
   * `TERMINAL_OUTPUT` events, never answered.
   */
  TERMINALS_LIST: "terminals.list",
  TERMINALS_CREATE: "terminals.create",
  TERMINALS_RENAME: "terminals.rename",
  TERMINALS_KILL: "terminals.kill",
  TERMINALS_RESUME: "terminals.resume",
  TERMINALS_CONNECT: "terminals.connect",
  TERMINALS_INPUT: "terminals.input",
  TERMINALS_RESIZE: "terminals.resize",
  TERMINALS_ACK: "terminals.ack",
  TERMINALS_SHOWN: "terminals.shown",
  TERMINALS_DISCONNECT: "terminals.disconnect",
  TERMINALS_WAKE: "terminals.wake",
  /**
   * A cloud Browser tab's live view (`@repo/features/browser-live-wire`),
   * opened for one panel under a connection id the desktop minted, sent on,
   * and closed. The host only carries the socket's text frames each way;
   * what the service sends is heard as `BROWSER_LIVE_MESSAGE` events, and
   * its close as `BROWSER_LIVE_CLOSED`, never answered.
   */
  BROWSER_LIVE_CONNECT: "browserLive.connect",
  BROWSER_LIVE_SEND: "browserLive.send",
  BROWSER_LIVE_DISCONNECT: "browserLive.disconnect",
  /**
   * A coding agent's cloud ports forwarded to this Mac's `127.0.0.1`
   * (`@repo/features/port-forward-acts`), for one agent at a time: how its
   * forwarding turned on or off, its standing told as
   * `PORT_FORWARDS_CHANGED`. What a forwarded connection carries never
   * crosses the Gateway.
   */
  PORT_FORWARDS_SET: "portForwards.set",
  /**
   * A cloud agent's mirror on this Mac (`@repo/host`'s `compose-mirrors.ts`),
   * made where none stands and kept in step from then on, answered with its
   * folder (`{ folder }`) once its worktree stands.
   */
  MIRRORS_ENSURE: "mirrors.ensure",
  /** Everything a window's bootstrap reads of the host, in one answer. */
  CLIENT_BOOTSTRAP: "client.bootstrap",
  SETTINGS_SNAPSHOT: "settings.snapshot",
  /** The developer's answer to one command an agent asked to run on this Mac (`@repo/host/contract`'s `MAC_COMMAND_DECISION`), by the ask's id. */
  MAC_COMMAND_ANSWER: "macCommands.answer",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ANALYTICS_RECORD: "analytics.record",
} as const;

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

/** Every way a call can be refused: the dispatcher's own two, and the codes a handler fails with. */
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

/** A refused call as the client reads it: the code, and a sentence for a person. */
export interface GatewayError {
  readonly code: GatewayErrorCode;
  readonly message: string;
}

/** One refusal's code, fixed by its class: the constructor takes the message alone. */
function refusalCode<Code extends GatewayErrorCode>(code: Code) {
  return Schema.Literal(code).pipe(Schema.withConstructorDefault(Effect.succeed(code)));
}

/**
 * Every error code as its own tagged error, so a handler that refuses has a
 * typed failure to fail with rather than a bare code. Each class's `code` is
 * the exact string `GATEWAY_ERROR` already names, and the dispatcher hands a
 * client the `{ code, message }` of whichever one a handler failed with.
 */
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

/** Every refusal a handler may fail with, one per error code. */
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
  /** What the signed-in account may open in the app (whether it is an admin), whenever a read or the account moved it. */
  ACCOUNT_ACCESS_CHANGED: "accountAccess.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
  /** The panel's tasks and active task, whole, whenever a read moved them. */
  TASKS_CHANGED: "tasks.changed",
  /** What an attached shell printed, named by its connection, for the one panel that connection's port reaches. */
  TERMINAL_OUTPUT: "terminal.output",
  /** How an attached shell's connection stands, named by its connection. */
  TERMINAL_STATE: "terminal.state",
  /** One text frame a cloud Browser tab's live view sent, named by its connection, for the one panel that connection's port reaches. */
  BROWSER_LIVE_MESSAGE: "browserLive.message",
  /** A cloud Browser tab's live view closed, with its close code, named by its connection. */
  BROWSER_LIVE_CLOSED: "browserLive.closed",
  /** Every plan's or agent's pages the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  PAGES_CHANGED: "pages.changed",
  /** Every description's or page's comments the host holds for the windows, whole, as its reads of them stand with the windows' writes laid over them, each time any of them moves. */
  DESCRIPTION_COMMENTS_CHANGED: "descriptionComments.changed",
  /** Every task's description the host holds for the windows, whole, as its reads of them and the writes since stand, each time any of them moves. */
  DESCRIPTION_DOCUMENTS_CHANGED: "descriptionDocuments.changed",
  /** Every task's description history the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  HISTORIES_CHANGED: "histories.changed",
  /** One of the automations' held reads, every workspace's or automation's the host holds for the windows, whole, by the read's name, as its reads stand, each time any of them moves. */
  AUTOMATIONS_CHANGED: "automations.changed",
  /** Every workspace's people the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  WORKSPACE_MEMBERS_CHANGED: "workspaceMembers.changed",
  /** Every workspace's own integrations the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  WORKSPACE_INTEGRATIONS_CHANGED: "workspaceIntegrations.changed",
  /** Every workspace's Slack channels the host holds for the windows, whole, as its asks of them stand, each time any of them moves. */
  SLACK_CHANNELS_CHANGED: "slackChannels.changed",
  /** Every listed workspace's photo the host holds, whole, each time one is fetched or let go. */
  WORKSPACE_PHOTOS_CHANGED: "workspacePhotos.changed",
  /** Every workspace's pending invitations the host holds for the windows, whole, as its reads of them stand, each time any of them moves or expires. */
  WORKSPACE_INVITATIONS_CHANGED: "workspaceInvitations.changed",
  /** Every agent's origin the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  AGENT_ORIGINS_CHANGED: "agentOrigins.changed",
  /** Every agent's or worker's transcript the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  TRANSCRIPTS_CHANGED: "transcripts.changed",
  /** Every plan's or agent's inbox the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  HOLDER_INBOXES_CHANGED: "holderInboxes.changed",
  /** Every link's standing the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  LINK_STANDINGS_CHANGED: "linkStandings.changed",
  /** Every agent's pull request's chapters the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  CHAPTERS_CHANGED: "chapters.changed",
  /** One of the Pull request tabs' held parts, every agent's pull request's the host holds for the windows, whole, by the read's name, as its reads stand, each time any of them moves. */
  PULL_REQUEST_PARTS_CHANGED: "pullRequestParts.changed",
  /** What waits across the followed account, whole or why there is none, each time it moves while it is followed. */
  ACCOUNT_INBOX_CHANGED: "accountInbox.changed",
  /** Every inbox item the account reaches, whole, as the host's read of them for the session stands, each time it moves. */
  INBOX_ITEMS_CHANGED: "inboxItems.changed",
  /** The account's preferences row, whole, as the host's read of it for the session stands with every write drawn over it, each time it moves. */
  ACCOUNT_PREFERENCES_CHANGED: "accountPreferences.changed",
  /** Every task's or agent's cloud Browser tabs the host holds for the windows, whole, as its reads of them stand, each time one moves or a takeover lapses. */
  BROWSER_TABS_CHANGED: "browserTabs.changed",
  /** The skills of every workspace the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  INSTALLED_SKILLS_CHANGED: "installedSkills.changed",
  /** The account's integrations the host holds for the windows, whole, as its read of them stands, each time it moves. */
  INTEGRATIONS_CHANGED: "integrations.changed",
  /** The account's devices' beats the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  DEVICE_PRESENCE_CHANGED: "devicePresence.changed",
  /** The account's hosts the host holds for the windows, whole, as its read of them stands, each time it moves. */
  HOSTS_CHANGED: "hosts.changed",
  /** Which machine This Mac is and the device its host's record names, under the account signed in, whole, as the host reads it at its start and every few seconds after, each time it moves. */
  THIS_MAC_HOST_CHANGED: "thisMacHost.changed",
  /** Every agent's own tools the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  WORKSPACE_TOOLS_CHANGED: "workspaceTools.changed",
  /** The outside MCP clients the host holds for the windows, whole, as its read of them stands, each time it moves. */
  MCP_CLIENTS_CHANGED: "mcpClients.changed",
  /** The one agent whose cloud ports are forwarded to this Mac and how its forwarding stands, or none, each time it moves. */
  PORT_FORWARDS_CHANGED: "portForwards.changed",
  /** How many changes made offline the service refused as they were sent again, since the windows last cleared the count, each time it moves. */
  OFFLINE_REFUSED_CHANGED: "offlineRefused.changed",
  /** Every integration server's tools the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  INTEGRATION_TOOLS_CHANGED: "integrationTools.changed",
  /** Every workspace's memories the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  MEMORIES_CHANGED: "memories.changed",
  /** The account's provider keys the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  PROVIDER_KEYS_CHANGED: "providerKeys.changed",
  /** The models the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  MODELS_CHANGED: "models.changed",
  /** The member's GitHub token the host holds for the windows, whole, as its reads of it stand, each time it moves. */
  GITHUB_TOKEN_CHANGED: "githubToken.changed",
  /** Every workspace's token repositories the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  TOKEN_REPOSITORIES_CHANGED: "tokenRepositories.changed",
  /** The commands agents asked to run on this Mac that wait on the developer's answer, whole, each time one is asked or answered. */
  MAC_COMMAND_ASKS_CHANGED: "macCommandAsks.changed",
  /** Every workspace's repositories the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
  REPOSITORY_LISTS_CHANGED: "repositoryLists.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

/** Who is asking: the one operator client, or a node offering capabilities. */
export const GATEWAY_CLIENT_ROLE = {
  OPERATOR: "operator",
  NODE: "node",
} as const;

export type GatewayClientRole = (typeof GATEWAY_CLIENT_ROLE)[keyof typeof GATEWAY_CLIENT_ROLE];

export interface GatewayClientIdentity {
  clientId: string;
  role: GatewayClientRole;
}

/**
 * What a node capability's invocation answers. Unavailable is a typed answer,
 * never a thrown error and never a success: a required node that is not
 * connected leaves the action undone and says so, so nothing records it as done.
 * Unknown is the other typed answer an absent node can give, and it is not
 * unavailable: the ask reached the node and no answer came back, so the
 * effect may have happened. What reads an unknown must record the action as
 * uncertain, never as failed and never as safe to repeat.
 */
export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  /** Never dispatched: no connected node offered the capability. */
  UNAVAILABLE: "unavailable",
  /** The node performed and reported a failure. */
  FAILED: "failed",
  /** Dispatched, and the answer lost; the effect is uncertain. */
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
