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
  /** The panel's Tasks tab shows: the task list read now, and the active task's document with it. */
  TASKS_REFRESH: "tasks.refresh",
  /** The Mac woke or unlocked: a task list already followed is sealed and followed again now, once however many of those land together. */
  TASKS_RESYNC: "tasks.resync",
  /** The app reaches the service again (`networkConnected` turned true): every read a window holds is asked again now, and a task list already followed is sealed and followed again, whatever resync came lately. */
  TASKS_REGAINED: "tasks.regained",
  /** The windows have said that the changes made offline the service refused when they were sent again are seen: their count is cleared. */
  TASKS_OFFLINE_REFUSED_CLEAR: "tasks.offlineRefusedClear",
  /** One task made the active one and its saved document read, replacing whichever was active. */
  TASKS_OPEN: "tasks.open",
  /** The developer left the open task, and no task is active. */
  TASKS_CLOSE: "tasks.close",
  /** A named task started on the service, on the repository it names where it names one, and made the active one. */
  TASKS_START: "tasks.start",
  /** One task deleted on the service; deleting the open task leaves no task active. */
  TASKS_DELETE: "tasks.delete",
  /** One task renamed on the service; the list and the open document take the name it answered without reading either again. */
  TASKS_RENAME: "tasks.rename",
  /** One task pinned or unpinned on the service; the list and the open document take the task it answered without reading either again. */
  TASKS_PIN: "tasks.pin",
  /** The reader's own read mark of one task moved on the service; the list takes the mark at once. */
  TASKS_MARK_READ: "tasks.markRead",
  TASKS_PIN_REPOSITORY: "tasks.pinRepository",
  /** One change to the account's sidebar sections on the service; the view takes the sections it answered. */
  TASKS_WRITE_SECTION: "tasks.writeSection",
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
  /** One task given its repository on the service, or none; the list and the open document take what it answered without reading either again. */
  TASKS_SET_REPOSITORY: "tasks.setRepository",
  /** One task's status, priority, or both set on the service; the list and the open document take the task it answered without reading either again. */
  TASKS_SET_STANDING: "tasks.setStanding",
  /** One task moved to another of the account's workspaces on the service; the list and the open document take the task it answered without reading either again. */
  TASKS_MOVE: "tasks.move",
  /** One block of a task added or taken away on the service; the open document takes the task it answered without reading it again. */
  TASKS_BLOCK: "tasks.block",
  /** One task's parent set or cleared on the service; the list and the open document take the task it answered without reading either again. */
  TASKS_SET_PARENT: "tasks.setParent",
  /** One relation of a task moved to another kind on the service, in one call; the list and the open document take the task it answered without reading either again. */
  TASKS_CHANGE_RELATION: "tasks.changeRelation",
  /** The developer's edit of a task's document saved on the service; the open document takes the task it answered, and a conflict leaves it unchanged. */
  TASKS_EDIT: "tasks.edit",
  /** A window of a file of one task's repository, read from GitHub through the service as it stands now and colored here; answered to the caller, never held in the view. */
  TASKS_FILE: "tasks.file",
  /** One folder of one task's repository, listed from GitHub through the service as it stands now; answered to the caller, never held in the view. */
  TASKS_TREE: "tasks.tree",
  /** The skills a developer may choose of one task's repository, read from GitHub through the service as it stands now; answered to the caller, never held in the view. */
  TASKS_SKILLS: "tasks.skills",
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
  /** A Browser tab opened at an address in a task's coding agent's browser on the service, taken over by the account at once; answered to the panel that asked, held nowhere. */
  TASKS_BROWSER_TAB_OPEN: "tasks.browserTabOpen",
  /** The id of the task a link names by its workspace and its number, found by the service; answered to the caller, never held in the view. */
  TASKS_FIND: "tasks.find",
  /** A page of one plan's history, read from the service; answered to the caller, never held in the view. */
  TASKS_REVISIONS: "tasks.revisions",
  /** One revision of one plan beside the one before it, read from the service; answered to the caller, never held in the view. */
  TASKS_REVISION: "tasks.revision",
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
   * One task's plan held for a window from now until it is let go, and a
   * while after among those let go lately: the task's record followed over
   * the service's held poll, and its plan read again whenever its mark moves
   * past the copy held. What it holds is heard as `DESCRIPTION_DOCUMENTS_CHANGED`
   * events, on the app state every window draws, never answered.
   */
  TASKS_DOCUMENT_FOLLOW: "tasks.documentFollow",
  /** One task's plan let go by the window that held it: it stays among those let go lately until later ones push it out. */
  TASKS_DOCUMENT_UNFOLLOW: "tasks.documentUnfollow",
  /** One task's held plan read again at once, as Try again asks; never answered. */
  TASKS_DOCUMENT_RETRY: "tasks.documentRetry",
  /**
   * One task's plan history held for a window's version history from now
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
  /** One picture of one plan, read from the service now as its bytes in base64; answered to the caller, never held in the view. */
  TASKS_PICTURE: "tasks.picture",
  /** One picture kept on one plan on the service, sent as a `data:` URL, answered with the id its text names it by; never held in the view. */
  TASKS_PICTURE_KEEP: "tasks.pictureKeep",
  /**
   * One task's comments, its plan's own threads or one page's, held followed
   * for a window from now until it is let go, over Neon Realtime, and a
   * while after among those let go lately: the open task's plan's, or a page
   * tab's. What they hold is heard as `DESCRIPTION_COMMENTS_CHANGED` events, on the
   * app state every window draws, never answered.
   */
  TASKS_COMMENTS_FOLLOW: "tasks.commentsFollow",
  /** One task's plan's or page's comments let go by the window that held them: they stay among those let go lately until later ones push them out. */
  TASKS_COMMENTS_UNFOLLOW: "tasks.commentsUnfollow",
  /** One held plan's or page's comments read again at once, as Try again asks, where a window holds them or let them go lately. */
  TASKS_COMMENTS_RETRY: "tasks.commentsRetry",
  /** A comment thread started on one task's plan, answered with the thread as it stands. */
  TASKS_COMMENT_START: "tasks.commentStart",
  /** One thing done to one comment thread of one task's plan, answered with the thread as it stands. */
  TASKS_COMMENT_ACT: "tasks.commentAct",
  /** One revision of one plan put back as its content on the service; the view takes the task as the service answered it. */
  TASKS_RESTORE: "tasks.restore",
  /** The account's workspaces read again from the service where the last read is a minute old or none stands; the view takes them. */
  WORKSPACES_REFRESH: "workspaces.refresh",
  /** A workspace made on the service under a name, owned by the account; the view's workspaces are read again. */
  WORKSPACES_CREATE: "workspaces.create",
  /** A workspace renamed on the service by an owner or admin; the view's workspaces are read again. */
  WORKSPACES_RENAME: "workspaces.rename",
  /** A workspace's slug changed on the service by its owner; the view's workspaces are read again. */
  WORKSPACES_SLUG_SET: "workspaces.slugSet",
  /** A workspace's photo set or removed on the service by an owner or admin; the view's workspaces are read again. */
  WORKSPACES_PHOTO_SET: "workspaces.photoSet",
  /** A GitHub organization's connection to a workspace begun on the service: our GitHub App's install address, for the caller to open. */
  WORKSPACES_GITHUB_CONNECT: "workspaces.githubConnect",
  /** A workspace's GitHub organization disconnected on the service; the view's workspaces are read again. */
  WORKSPACES_GITHUB_DISCONNECT: "workspaces.githubDisconnect",
  /** A workspace's Sentry install begun on the service by an owner or admin: Sentry's install address, for the caller to open. */
  WORKSPACES_SENTRY_INSTALL: "workspaces.sentryInstall",
  /** One of a workspace's Sentry installations disconnected on the service, drawn gone at once over the workspace's held integrations; the workspace's Sentry as it then stands. */
  WORKSPACES_SENTRY_DISCONNECT: "workspaces.sentryDisconnect",
  /** A workspace's Slack bot connected on the service by an owner or admin, answered with the bot as it then stands once the workspace's held integrations carry it. */
  WORKSPACES_SLACK_BOT_CONNECT: "workspaces.slackBotConnect",
  /** A workspace's Slack bot disconnected on the service by an owner or admin, drawn gone at once over the workspace's held integrations; the bot as it then stands. */
  WORKSPACES_SLACK_BOT_DISCONNECT: "workspaces.slackBotDisconnect",
  /** The reader's own Slack notifications turned on or off on the service, answered with the bot as it then stands. */
  WORKSPACES_SLACK_BOT_NOTIFICATIONS: "workspaces.slackBotNotifications",
  /** A workspace's default repository for Slack starts named or cleared on the service by an owner or admin, drawn at once over the workspace's held integrations; the bot as it then stands. */
  WORKSPACES_SLACK_BOT_REPOSITORY: "workspaces.slackBotRepository",
  /** One channel's bot membership or default repository changed on the service by an owner or admin, its repository drawn at once over the workspace's held integrations and its membership laid on the held channels as answered; the bot as it then stands. */
  WORKSPACES_SLACK_BOT_CHANNEL: "workspaces.slackBotChannel",
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
  /** A repository added to a workspace on the account's own GitHub token, or removed from it, on the service; answered to the caller with the workspace's token repositories as they then stand, which are laid on its held read too. */
  WORKSPACES_TOKEN_REPOSITORY_SET: "workspaces.tokenRepositorySet",
  /** One member removed from a workspace on the service, answered with the members who remain; the view's workspaces are read again. */
  WORKSPACES_MEMBER_REMOVE: "workspaces.memberRemove",
  /** Another member made an admin or an admin a member on the service by the owner, answered with the members as they then stand; the view's workspaces are read again. */
  WORKSPACES_MEMBER_ROLE: "workspaces.memberRole",
  /** A workspace handed by its owner to one of its admins on the service, the owner becoming an admin, answered with the members as they then stand; the view's workspaces are read again, the account's role in it among them. */
  WORKSPACES_TRANSFER: "workspaces.transfer",
  /** The account left one workspace on the service; the view's workspaces and tasks are read again. */
  WORKSPACES_LEAVE: "workspaces.leave",
  /** An invitation to a workspace made on the service, answered with its accept link; the held invitations draw it until their read carries it. */
  WORKSPACES_INVITE: "workspaces.invite",
  /** A pending invitation canceled on the service, answered with those still pending; the held invitations draw it gone until their read carries it. */
  WORKSPACES_INVITATION_CANCEL: "workspaces.invitationCancel",
  /** The page that connects the account's GitHub, asked of the service now and used once; the next workspaces read is owed at once. */
  GITHUB_CONNECT: "github.connect",
  /** The account's GitHub disconnected on the service under the Mac's session; the view takes the connection, and the next workspaces read is owed at once. */
  GITHUB_DISCONNECT: "github.disconnect",
  /** One admin dashboard read, asked of the service now under the account's session and answered to the caller as it came, or why not; never held in the view. */
  ADMIN_READ: "admin.read",
  /** The admin dashboard's star set or taken back on one account under the account's session; whether it landed. */
  ADMIN_FAVORITE: "admin.favorite",
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
  /** The account's default model and effort for a coding agent, drawn over the account's preferences at once and written to the service; the default as kept, or why it is unchanged. */
  AGENTS_DEFAULT_WRITE: "agents.defaultWrite",
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
  /** One of the account's hosts removed; done, or why not. */
  HOSTS_REMOVE: "hosts.remove",
  /** Run agents on this Mac turned on, This Mac enrolled, or off, its host removed; done, or why not. */
  HOSTS_THIS_MAC_SET: "hosts.thisMacSet",
  /** A box's pending pairing read by the code its link named; the box and where its start came from, or why not. */
  HOSTS_PAIRING_READ: "hosts.pairingRead",
  /** A box's pending pairing approved by its code, which makes the account's host; its id, or why not. */
  HOSTS_PAIRING_APPROVE: "hosts.pairingApprove",
  /** A box's pending pairing denied by its code; done, or why not. */
  HOSTS_PAIRING_DENY: "hosts.pairingDeny",
  /** One task's coding agents with their status, read from the service now. */
  AGENTS_LIST: "agents.list",
  /** A workspace's coding agents, newest started first, narrowed to one repository where one is named. */
  AGENTS_WORKSPACE_LIST: "agents.workspaceList",
  /** A coding agent started on one task under the panel's own key; the agent, or why none started. */
  AGENTS_START: "agents.start",
  /** One agent's transcript past a cursor, held open by the service while the agent runs. */
  AGENTS_MESSAGES: "agents.messages",
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
  /** The page of a held transcript below the oldest message it holds, read at once and laid before them while they still begin where it was asked: whether it landed, or why it was not read. */
  AGENTS_TRANSCRIPT_OLDER: "agents.transcriptOlder",
  /** One agent sent a message, naming how it reaches a turn under way; the agent as it then stands, or why it was not. */
  AGENTS_MESSAGE: "agents.message",
  /** One agent's model and effort changed for its next step; the agent as it then stands, or why it is unchanged. */
  AGENTS_CHOOSE: "agents.choose",
  /** One agent renamed, or its title cleared; the agent as it then stands, or why it is unchanged. */
  AGENTS_RENAME: "agents.rename",
  /** One agent's MCP servers switched, the whole list of those off, for its next turn on; the agent as it then stands, or why it is unchanged. */
  AGENTS_SERVERS: "agents.servers",
  /** A repository added to one agent beside the ones it works in, checked out and told to it; the agent as it then stands, or why it was not added. */
  AGENTS_ADD_REPOSITORY: "agents.addRepository",
  AGENTS_QUEUE: "agents.queue",
  /** One agent stopped; the agent as it then stands, or why it was not. */
  AGENTS_STOP: "agents.stop",
  /** One agent taken back to just before one of the developer's lines, stopped first where it still works; the agent as it then stands, or why it was not. */
  AGENTS_REWIND: "agents.rewind",
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  AGENTS_ARCHIVE: "agents.archive",
  /** One agent pinned for the account alone, or unpinned; the agent as it then stands, or why it is unchanged. */
  AGENTS_PIN: "agents.pin",
  /** The reader's own read mark of one agent moved on the service; the agent as it then stands, or why it is unchanged. */
  AGENTS_MARK_READ: "agents.markRead",
  /** One agent deleted for good, a turn it still runs stopped first; that it was, or why not. */
  AGENTS_DELETE: "agents.delete",
  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  AGENTS_PAGE: "agents.page",
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
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  /** A webhook trigger's secret minted again by the host, its hash sent to the service, and the secret answered once to the window that asked (root AGENTS.md's carve-out). */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
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
  /** One installed skill read whole, its `SKILL.md` and every file's path and size; or why it was not. */
  INSTALLED_SKILLS_READ: "installedSkills.read",
  /** What a pasted GitHub source or skill text would install, read by the service; nothing is written. */
  INSTALLED_SKILLS_PREVIEW: "installedSkills.preview",
  /** The skills a paste makes, installed for the account or its workspace, all or none, drawn over every held read whose scope they are in once the service answers; or why none were. */
  INSTALLED_SKILLS_INSTALL: "installedSkills.install",
  /** One installed skill removed with its files, drawn gone at once over the held skills; or why it stands. */
  INSTALLED_SKILLS_REMOVE: "installedSkills.remove",
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
  /** One agent's changes: the files of its pull request as GitHub holds them now, each with its patch. */
  AGENTS_CHANGES: "agents.changes",
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
  /** One agent's pull request's chapters generated for its head on our own model key, or the generation already under way, answered as a read of them is. */
  AGENTS_CHAPTERS_GENERATE: "agents.chaptersGenerate",
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
  /** One image an agent's pull request's overview names, read by the service on the App's token: its bytes in base64 and their type. */
  AGENTS_GITHUB_IMAGE: "agents.githubImage",
  /** One change to an agent's pull request, made on GitHub by the service as the account on its own GitHub sign-in: how GitHub took it. */
  AGENTS_PULL_REQUEST_ACTION: "agents.pullRequestAction",
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
  /** One provider key saved on the service, the key carried once in the params; the keys as they then stand, or why nothing was kept. */
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  /** One provider's key of the kind named removed on the service, an API key where none is; the keys as they then stand. */
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  /** A connected plan's default for the account's coding agents turned on or off on the service; the keys as they then stand. */
  PROVIDER_KEYS_FOR_AGENTS: "providerKeys.forAgents",
  /** Codex's device-code login begun on the service: the code to enter, where, how often to ask again, and when it lapses, or why there is none. Never a token. */
  CHATGPT_DEVICE_START: "chatGpt.device.start",
  /** A device-code login waited on, by its login id, asked after on the interval its start named until it settles or an ask goes unanswered; how it settled, the keys as they then stand once it connected. */
  CHATGPT_DEVICE_WAIT: "chatGpt.device.wait",
  /** A device-code login withdrawn, by its login id; how it then stands. */
  CHATGPT_DEVICE_CANCEL: "chatGpt.device.cancel",
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
  /** The member's GitHub token saved on the service, carried once in the params; the token as it then stands, or why nothing was kept, which is laid on its held read too. */
  GITHUB_TOKEN_SAVE: "githubToken.save",
  /** The member's GitHub token removed on the service; none then stands, which is laid on its held read too. */
  GITHUB_TOKEN_REMOVE: "githubToken.remove",
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
  /** One memory forgotten on the service for good, drawn gone at once over the workspace's held memories; the workspace's memories as they then stand. */
  MEMORIES_FORGET: "memories.forget",
  /** One clip dictated into an agent's message box, carried once to the service; its words, or why there are none. Nothing of it is kept. */
  DICTATION_TRANSCRIBE: "dictation.transcribe",
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
  /** One item of a task's inbox answered against the revision the panel drew, under the panel's own key; the item as it then stands and whether the answer was taken, or why there is no answer. */
  AGENTS_INBOX_ANSWER: "agents.inboxAnswer",
  /** One open item of a task's inbox closed without an answer against the revision the panel drew, under the panel's own key; answered as an answer is. */
  AGENTS_INBOX_CLOSE: "agents.inboxClose",
  /** One message of the account's on an item's thread, open or settled, under the panel's own key, carrying the answer to the thread's open ask where the reader attached one; the item as it then stands, its thread with the message on it, or why there is no answer. */
  AGENTS_INBOX_MESSAGE: "agents.inboxMessage",
  /** A thread the account starts with one agent, its subject and first message under the panel's own key; the thread as it then stands, its message on it, or why there is no answer. */
  AGENTS_INBOX_START: "agents.inboxStart",
  /** One item marked read or unread for the account, as the Inbox's dot says it; its read state, or why there is no answer. */
  AGENTS_INBOX_READ_STATE: "agents.inboxReadState",
  /** One item's reminder set for the account for an instant, or canceled, whether it is read standing as it was; its read state, or why there is no answer. */
  // Note that setting a reminder keeps Snooze's id, because a write queued offline is kept on disk by its method's id, and one under an id no host answers is dropped.
  AGENTS_INBOX_REMIND: "agents.inboxSnooze",
  /** Where one item the account may read stands, its agent, task, and workspace, as a link by its id alone is opened; or why there is no answer. */
  AGENTS_INBOX_ITEM_HOME: "agents.inboxItemHome",
  /** Every item of the account's Inbox marked read, in one workspace or in all; how many were unread, or why there is no answer. */
  AGENTS_INBOX_READ_ALL: "agents.inboxReadAll",
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
  /** A browser sign-in to one account at a provider, or to a new one, begun on the service and opened on this Mac; whether it was opened and the account it signs in, never the address. */
  INTEGRATIONS_CONNECT: "integrations.connect",
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
  /** The account's sign-in to one account at a provider under way ended on the service, revoking nothing; where it then stands. */
  INTEGRATIONS_CANCEL: "integrations.cancel",
  /** The account's connection to one account at a provider ended on the service; where it then stands. */
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  /** One account at a provider named as the developer calls it, on the service; the account as it then stands. */
  INTEGRATIONS_RENAME: "integrations.rename",
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
  /** One outside MCP client revoked on the service under the Mac's session; the clients as they then stand. */
  MCP_CLIENTS_REVOKE: "mcpClients.revoke",
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
  /** One image of an inbox item, fetched under the account: its bytes in base64 under the media type the service kept, or why there is none. */
  AGENTS_INBOX_ATTACHMENT: "agents.inboxAttachment",
  /** One picture a tool answered an agent or one of its workers, fetched under the account: its bytes in base64 under the media type the service kept, or why there is none. */
  AGENTS_PICTURE: "agents.picture",
  /** One part of a message of an agent's transcript or one of its workers', whole, fetched under the account: what the page carried cut, or why there is none. */
  AGENTS_PART: "agents.part",
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
  SETTINGS_UPDATE: "settings.update",
  SETTINGS_RESET: "settings.reset",
  /** The developer's answer to one command an agent asked to run on this Mac (`@repo/host/contract`'s `MAC_COMMAND_DECISION`), by the ask's id. */
  MAC_COMMAND_ANSWER: "macCommands.answer",
  /** One experiment turned on or off for the signed-in account on the service; the settings as they then stand, the experiments among them. */
  EXPERIMENTS_SET: "experiments.set",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  /** The sign-in taken again over the session that stands, answering whether a new one landed. */
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  /**
   * The member's grant of support access granted for seven days or revoked
   * on the service, under the account's own session (`{ grant }`); the
   * grant as it then stands, which the account's access is read again for.
   */
  ACCOUNT_SUPPORT_ACCESS: "account.supportAccess",
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
  /** Every plan's or page's comments the host holds for the windows, whole, as its reads of them stand with the windows' writes laid over them, each time any of them moves. */
  DESCRIPTION_COMMENTS_CHANGED: "descriptionComments.changed",
  /** Every task's plan the host holds for the windows, whole, as its reads of them and the writes since stand, each time any of them moves. */
  DESCRIPTION_DOCUMENTS_CHANGED: "descriptionDocuments.changed",
  /** Every task's plan history the host holds for the windows, whole, as its reads of them stand, each time any of them moves. */
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
