/**
 * kinds.ts -- the act kinds the window's act port answers, by domain, and the handshake that opens the port.
 *
 * Kept free of every import, oRPC and every schema among them, so `acts.ts`
 * can spell these kinds in `ACT_KIND` without resolving the contract behind
 * them, and so the lint rule `anti-slop/no-follow-outside-host-read` can
 * load this file as it stands to read `PORT_ACT_USE`: that is why each
 * kind's use is declared here rather than on its procedure. A kind here is
 * the key of its procedure in `actContract`, so the panel's act door calls a
 * kind by its own name.
 */

/** The account's asks: a sign-in begun, begun again, or canceled, a sign-out, and the account deleted. */
export const ACCOUNT_ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
} as const;

/**
 * The account's own asks from Settings and a dictating box: its provider keys
 * and a dictated clip's words.
 */
export const ACCOUNT_ASK_ACT_KIND = {
  /**
   * Settings › API keys: the account's own provider keys held as hints and
   * statuses, one saved, one removed. The save's payload is the one place a
   * key crosses from the renderer, once, on its way to the service; no
   * answer carries one back, and nothing on the way keeps it. The hold's
   * stream carries nothing: what it holds reaches the panel on app state
   * (`LIVE_READ.PROVIDER_KEYS`), and each write's own answer is laid there too.
   */
  PROVIDER_KEYS_FOLLOW: "providerKeys.follow",
  /** The account's held provider keys, which the panel reads on app state, asked again at once, as Try again asks. */
  PROVIDER_KEYS_RETRY: "providerKeys.retry",
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  /** A connected plan's default for the account's coding agents turned on or off, from beside its row in Settings. */
  PROVIDER_KEYS_FOR_AGENTS: "providerKeys.forAgents",
  /**
   * Settings › Coding agents › Codex: Sign in with ChatGPT for our hosted
   * runtime, run by the host through the developer's browser, and the one
   * waiting withdrawn. Nothing crosses from the renderer but the press, and
   * the answer is the keys as the service then holds them: the sign-in's
   * tokens go from the host to the service and never reach a window.
   */
  CHATGPT_SIGN_IN: "chatGpt.signIn",
  CHATGPT_SIGN_IN_CANCEL: "chatGpt.cancelSignIn",
  /**
   * Settings › Integrations › GitHub: the member's own classic GitHub
   * personal access token read as its login, hint, and status, saved, and
   * removed. The save's payload carries the token from the renderer once,
   * on its way to the service; no answer carries one back, and nothing on
   * the way keeps it.
   */
  GITHUB_TOKEN_READ: "githubToken.read",
  GITHUB_TOKEN_SAVE: "githubToken.save",
  GITHUB_TOKEN_REMOVE: "githubToken.remove",
  /**
   * Settings › Memory: the facts and conventions the coding agents kept in
   * the workspace Settings shows, shared by its members, read as the page
   * opens, and one forgotten for good. Each answers the memories as the
   * service then keeps them.
   */
  MEMORIES_READ: "memories.read",
  MEMORIES_FORGET: "memories.forget",
  /**
   * A clip dictated into a message box, carried once from the panel that
   * recorded it to the service and answered with its words. Nothing on the
   * way keeps it.
   */
  DICTATION_TRANSCRIBE: "dictation.transcribe",
} as const;

/** The Automations pages' asks: the account's automations made, changed, deleted, and run now, and a workspace's automations, its runs, or one's runs held and read again. */
export const AUTOMATION_ACT_KIND = {
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  /** A webhook's secret minted again by the host and answered to this window alone, once, to show. */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
  /** A workspace's automations, its runs, or one's runs held for the window while it holds the stream open; what they hold reaches it on app state. */
  AUTOMATIONS_FOLLOW: "automations.follow",
  /** A held list or history read again at once, as Try again asks. */
  AUTOMATIONS_RETRY: "automations.retry",
} as const;

/**
 * A task's coding agents, the core of what the Tasks tab asks of them: the
 * models, the default, the lists, an agent started, read, messaged, changed,
 * and shown, an agent's page, and what an agent published: its pull request,
 * its changes, and its Pull request tab's overview.
 */
export const AGENT_ACT_KIND = {
  /**
   * A task's coding agents, asked of the service: the models one may run
   * on, the account's default among them read and written, the task's
   * agents with their status, one started under the press's own key, one's
   * transcript past a cursor (held open by the service while the agent
   * runs), one sent a message naming how it reaches a turn under way, one
   * given another model and effort for its next step, one renamed, one stopped, one
   * archived (a turn it still runs stopped first) or brought back, one deleted
   * for good (stopped first the same way). The
   * window holds what it draws; nothing here does.
   */
  AGENTS_MODELS: "agents.models",
  AGENTS_DEFAULT_READ: "agents.defaultRead",
  AGENTS_DEFAULT_WRITE: "agents.defaultWrite",
  /**
   * The account's hosts as Settings › Hosts reads and changes
   * them: listed, the beats of the account's devices held, and one removed; and a box's pairing, by the code its link
   * named, read, approved, or denied.
   */
  HOSTS_LIST: "hosts.list",
  /**
   * When the account's own devices last beat, held for the window while it
   * holds the stream open and a while after among those let go lately, asked
   * again every `MAC_PRESENCE.POLL_MS` while held: what it holds reaches the
   * panel on app state (`LIVE_READ.DEVICE_PRESENCE`), so the stream carries
   * nothing.
   */
  HOSTS_PRESENCE_FOLLOW: "hosts.presenceFollow",
  /** The beats a window holds asked again now, as the window comes back online. */
  HOSTS_PRESENCE_REFRESH: "hosts.presenceRefresh",
  HOSTS_REMOVE: "hosts.remove",
  HOSTS_PAIRING_READ: "hosts.pairingRead",
  HOSTS_PAIRING_APPROVE: "hosts.pairingApprove",
  HOSTS_PAIRING_DENY: "hosts.pairingDeny",
  AGENTS_LIST: "agents.list",
  /** One workspace's agents, newest started first: what an automation's Same agent is chosen from. */
  AGENTS_WORKSPACE_LIST: "agents.workspaceList",
  AGENTS_START: "agents.start",
  AGENTS_MESSAGES: "agents.messages",
  /**
   * One agent's transcript, a worker's, or a task's planning worker's,
   * followed while the window holds the stream open: its pages, the first
   * from the start and each later one what moved past the last.
   */
  AGENTS_TRANSCRIPT: "agents.transcript",
  /** One part of a message of a transcript, whole: what its followed page carried cut, fetched as the window opens it. */
  AGENTS_PART: "agents.part",
  /** The page of a followed transcript below the oldest message the window holds, as its newest or last older page named it; or why there is none. */
  AGENTS_TRANSCRIPT_OLDER: "agents.transcriptOlder",
  AGENTS_MESSAGE: "agents.message",
  AGENTS_CHOOSE: "agents.choose",
  AGENTS_RENAME: "agents.rename",
  AGENTS_SERVERS: "agents.servers",
  AGENTS_QUEUE: "agents.queue",
  AGENTS_STOP: "agents.stop",
  AGENTS_REWIND: "agents.rewind",
  AGENTS_ARCHIVE: "agents.archive",
  AGENTS_PIN: "agents.pin",
  AGENTS_DELETE: "agents.delete",
  /**
   * Which agent's tab the panel shows, or none: what an agent's end leaves no
   * unseen dot for while the window is focused, and what clears that dot.
   */
  AGENTS_SHOWN: "agents.shown",
  /** An agent's unseen dot cleared by hand, without its page being shown: its row's Mark as read. */
  AGENTS_SEEN: "agents.seen",
  /** One agent as its own page reads it, by its id, read once where a press must know where the agent stands now, as the archive confirm asks whether a teammate's agent still works before it archives it; answered to the press, never on the document. */
  AGENTS_PAGE: "agents.page",
  /**
   * The run of an automation that started one agent, held followed while the
   * window holds the stream open, and a while after among those let go
   * lately: what it holds reaches the panel on app state
   * (`LIVE_READ.AGENT_ORIGINS`), so the stream carries nothing.
   */
  AGENTS_ORIGIN_FOLLOW: "agents.originFollow",
  /** A held agent's origin, which the panel reads on app state, read again at once, as Try again asks. */
  AGENTS_ORIGIN_RETRY: "agents.originRetry",
  /** What one agent published: its branch and pull request as GitHub holds them. */
  AGENTS_PULL_REQUEST: "agents.pullRequest",
  /** One agent's changes, its pull request's files with their patches, which its Changes tab draws. */
  AGENTS_CHANGES: "agents.changes",
  /** One agent's pull request itself, its description, branches, mergeability, and people, which its Pull request tab's overview draws. */
  AGENTS_OVERVIEW_PULL_REQUEST: "agents.overviewPullRequest",
  /** What the reviewer and label pickers of an agent's Pull request tab offer. */
  AGENTS_REVIEW_OPTIONS: "agents.reviewOptions",
  /**
   * Our own tools one agent is offered, held for the window while it holds
   * the stream open and a while after among those let go lately, asked again
   * as a window comes forward: what it holds reaches the panel on app state
   * (`LIVE_READ.WORKSPACE_TOOLS`), so the stream carries nothing.
   */
  AGENTS_WORKSPACE_TOOLS_FOLLOW: "agents.workspaceToolsFollow",
  /** One agent's held tools, which the panel reads on app state, asked again at once, as Try again asks. */
  AGENTS_WORKSPACE_TOOLS_RETRY: "agents.workspaceToolsRetry",
  /** The checks on one agent's pull request's head, which its Pull request tab's overview draws. */
  AGENTS_OVERVIEW_CHECKS: "agents.overviewChecks",
  /** One agent's pull request's conversation and where its reviewers stand, which its Pull request tab's overview draws. */
  AGENTS_OVERVIEW_CONVERSATION: "agents.overviewConversation",
  /** One image an agent's pull request's overview names, its bytes read by the service on the App's token. */
  AGENTS_GITHUB_IMAGE: "agents.githubImage",
  /** One change to an agent's pull request, such as marking it ready for review, made on GitHub as the account on its own GitHub sign-in. */
  AGENTS_PULL_REQUEST_ACTION: "agents.pullRequestAction",
  /** Which of an agent's pull request's files the account marked viewed on GitHub, read on its own GitHub sign-in. */
  AGENTS_PULL_REQUEST_VIEWED: "agents.pullRequestViewed",
} as const;

/**
 * A task's coding agents, what they need of the developer and what they
 * say in the workspace: the Inbox read past a cursor (held open by the
 * service while nothing changed), a task's or one agent's; one item
 * answered, closed, messaged on its thread, or marked read or unread, and
 * every item marked read; and an item's image and an agent's picture read
 * by the host under the account. The window holds what it draws; nothing
 * here does.
 */
export const AGENT_INBOX_ACT_KIND = {
  /**
   * A task's inbox, or one agent's, held followed while the window holds
   * the stream open, and a while after among those let go lately: what it
   * holds reaches the panel on app state (`LIVE_READ.HOLDER_INBOX`), so the
   * stream carries nothing.
   */
  AGENTS_INBOX_FOLLOW: "agents.inboxFollow",
  /** A held task's or agent's inbox, which the panel reads on app state, read again at once, as Try again asks. */
  AGENTS_INBOX_RETRY: "agents.inboxRetry",
  /** Every inbox item the account reaches, which the panel reads on app state, read again at once, as Try again asks. */
  AGENTS_INBOX_ITEMS_RETRY: "agents.inboxItemsRetry",
  AGENTS_INBOX_ANSWER: "agents.inboxAnswer",
  /** One open item closed without an answer against the revision the panel drew, under the panel's own key. */
  AGENTS_INBOX_CLOSE: "agents.inboxClose",
  /** A message on one item's thread, open or settled, under the panel's own key; it never answers the item. */
  AGENTS_INBOX_MESSAGE: "agents.inboxMessage",
  /** A new thread with one agent, its subject and first message, under the panel's own key. */
  AGENTS_INBOX_START: "agents.inboxStart",
  /** One item marked read or unread for the account; it changes neither what the item asks nor whether it waits. */
  AGENTS_INBOX_READ_STATE: "agents.inboxReadState",
  /** Where one item stands, its agent, task, and workspace, as a link by its id alone is opened; it reads, and changes nothing. */
  AGENTS_INBOX_ITEM_HOME: "agents.inboxItemHome",
  /** Every item of the account's Inbox marked read, in one workspace or in all; the dots alone. */
  AGENTS_INBOX_READ_ALL: "agents.inboxReadAll",
  /** One image of an inbox item, fetched by the host under the account, so the window holds no bearer and no address. */
  AGENTS_INBOX_ATTACHMENT: "agents.inboxAttachment",
  AGENTS_PICTURE: "agents.picture",
} as const;

/**
 * A coding agent's Pull request tab's Chapters: a pull request's chapters
 * held followed as its workspace keeps them while the tab holds them, which
 * reach the panel on app state (`LIVE_READ.PULL_REQUEST_CHAPTERS`), and read
 * again as Try again asks; generated for its head on our own model key when
 * the developer presses Generate, the generation answered once it lands,
 * which may take minutes; and Settings' choice of the Claude model the
 * member's Generate runs on, read and written.
 */
export const CHAPTERS_ACT_KIND = {
  CHAPTERS_FOLLOW: "chapters.follow",
  CHAPTERS_RETRY: "chapters.retry",
  CHAPTERS_GENERATE: "chapters.generate",
  CHAPTERS_MODEL_READ: "chapters.modelRead",
  CHAPTERS_MODEL_WRITE: "chapters.modelWrite",
} as const;

/**
 * Settings' Skills: the skills the account sees in a workspace listed, a
 * pasted `skills add` command or skill text previewed, one of its skills'
 * `SKILL.md` read, and installed for the account or its workspace, and one toggled, checked for an update,
 * updated, or removed.
 */
export const INSTALLED_SKILL_ACT_KIND = {
  INSTALLED_SKILLS_LIST: "installedSkills.list",
  INSTALLED_SKILLS_READ: "installedSkills.read",
  INSTALLED_SKILLS_PREVIEW: "installedSkills.preview",
  INSTALLED_SKILLS_PREVIEW_FILE: "installedSkills.previewFile",
  INSTALLED_SKILLS_INSTALL: "installedSkills.install",
  INSTALLED_SKILLS_SET_ENABLED: "installedSkills.setEnabled",
  INSTALLED_SKILLS_CHECK_UPDATE: "installedSkills.checkUpdate",
  INSTALLED_SKILLS_UPDATE: "installedSkills.update",
  INSTALLED_SKILLS_SHARE: "installedSkills.share",
  INSTALLED_SKILLS_REMOVE: "installedSkills.remove",
} as const;

/**
 * Settings' integration rows: where every one of the account's integrations
 * stands, a browser sign-in to one begun and opened by the host, and one
 * connection ended. The window hears whether the browser was sent, never the
 * address it was sent to.
 */
export const INTEGRATION_ACT_KIND = {
  INTEGRATIONS_STATUS: "integrations.status",
  INTEGRATIONS_CONNECT: "integrations.connect",
  INTEGRATIONS_CANCEL: "integrations.cancel",
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  /**
   * The tools one account's server offers the account's agents, held for the
   * window while it holds the stream open and a while after among those let
   * go lately, asked again as a window comes forward: what it holds reaches
   * the panel on app state (`LIVE_READ.INTEGRATION_TOOLS`), so the stream
   * carries nothing.
   */
  INTEGRATIONS_TOOLS_FOLLOW: "integrations.toolsFollow",
  /** One server's held tools, which the panel reads on app state, asked again at once, as Try again asks. */
  INTEGRATIONS_TOOLS_RETRY: "integrations.toolsRetry",
  /** One account at a provider named as the developer calls it. */
  INTEGRATIONS_RENAME: "integrations.rename",
  /**
   * The outside MCP clients the account allowed, with the server's address,
   * held for the window while it holds the stream open: what they hold
   * reaches the panel on app state (`LIVE_READ.MCP_CLIENTS`), so the stream
   * carries nothing.
   */
  MCP_CLIENTS_FOLLOW: "mcpClients.follow",
  /** The held outside MCP clients read again at once, as Try again asks. */
  MCP_CLIENTS_RETRY: "mcpClients.retry",
  /** One outside MCP client revoked under the Mac's session, answering the clients as they then stand, or that the revoke did not finish. */
  MCP_CLIENTS_REVOKE: "mcpClients.revoke",
} as const;

/** The settings writes: one setting, a page's settings reset, and one experiment turned on or off, each answering the settings as they then stand. */
export const SETTINGS_ACT_KIND = {
  SETTING_UPDATE: "setting.update",
  SETTINGS_RESET: "settings.reset",
  EXPERIMENT_SET: "experiment.set",
} as const;

/**
 * The panel's Tasks tab asking the host: the task list and the active
 * document read as the tab shows, one task made the active one, the open
 * task left, a task started on a repository, and a task renamed, given its
 * repository, pinned or unpinned, or deleted. The view arrives on the document rather than as
 * an answer. The one write of a task's document from here is the
 * developer's edit of a field, `TASKS_EDIT`, which answers whether it
 * saved, conflicted with what was written meanwhile, or failed. Beside them,
 * a page of GitHub's or the web's opened in the browser, the account's own
 * GitHub connected or disconnected. And
 * what one task holds, read as its tabs draw it: its
 * earlier work and conversation, its repository's files,
 * folders, skills, pull requests, and issues, a fenced block colored, its
 * plan's history, pages, pictures, and comments, and a task given its
 * status and priority.
 */
export const TASKS_ACT_KIND = {
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
  /** The repository chip's read: the repositories the account reaches through our GitHub App, as the service answers them now. */
  TASKS_REPOSITORIES: "tasks.repositories",
  /** A task given its repository on the service, or none; answers the repository as kept, or why it is unchanged. */
  TASKS_SET_REPOSITORY: "tasks.setRepository",
  /** A task moved on the service to another of the account's workspaces, its owner's alone; answers the workspace it now belongs to, or why it stands where it was. */
  TASKS_MOVE: "tasks.move",
  /** One block of a task added or taken away on the service; answers the task's blocks as they then stand, or why they are unchanged. */
  TASKS_BLOCK: "tasks.block",
  /** One task's parent set on the service, or cleared with null; answers the parent as it then stands, or why it is unchanged. */
  TASKS_SET_PARENT: "tasks.setParent",
  /** One relation of a task moved to another kind on the service, in one call; answers the task's relations as they then stand, or why they are unchanged. */
  TASKS_CHANGE_RELATION: "tasks.changeRelation",
  /** The developer's edit of the open task's document, saved on the service; answers saved, a conflict with the text as it stands now, or why nothing was saved. */
  TASKS_EDIT: "tasks.edit",
  /** A page of GitHub's opened in the browser: a repository, or where our GitHub App is installed. No other address opens through it. */
  GITHUB_OPEN: "github.open",
  /** A web page opened in the default browser: a link a transcript's or an Inbox item's words hold, off GitHub. No address but an http or https one opens through it. */
  WEB_OPEN: "web.open",
  /** The page that connects the account's GitHub, asked of the service and opened in the browser; the connection arrives on the document once the panel comes forward again. */
  GITHUB_CONNECT: "github.connect",
  /** The admin dashboard, opened in the default browser on the service's own origin, an address the host names and never one a window hands in. The service's gate decides who reads it. */
  ADMIN_OPEN: "admin.open",
  /** One admin dashboard read, asked of the service under the account's session and answered to the window that asked as it came, or why there is none; never held in app state. The service's gate decides it. */
  ADMIN_READ: "admin.read",
  /** The admin dashboard's star set or taken back on one account, for the viewing admin alone; whether it landed. */
  ADMIN_FAVORITE: "admin.favorite",
  /** The account's GitHub disconnected on the service under the Mac's session; the connection arrives on the document at once. */
  GITHUB_DISCONNECT: "github.disconnect",
  /** A task given its status and priority on the service; answers whether it saved. */
  TASKS_SET_STANDING: "tasks.setStanding",
  /** A File tab's window of a file of the open task's repository, read from GitHub through the service and colored by main; answered to the tab, never on the document. */
  TASKS_FILE: "tasks.file",
  /** A File tab's tree listing one folder of the open task's repository, read from GitHub through the service; answered to the tree, never on the document. */
  TASKS_TREE: "tasks.tree",
  /** The skills a developer may choose of a task's repository, read from GitHub through the service; answered to the asker, never on the document. */
  TASKS_SKILLS: "tasks.skills",
  /** One pull request of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_PULL_REQUEST: "tasks.pullRequest",
  /** One issue of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_ISSUE: "tasks.issue",
  /** A Browser tab opened at an address in a task's coding agent's cloud browser through the service, taken over by the member at once, as the side panel's "+" opens one; answered to the panel, never on the document. */
  TASKS_BROWSER_TAB_OPEN: "tasks.browserTabOpen",
  /**
   * A task's agents' Browser tabs, or one agent's, held followed while the
   * window holds the stream open for the side panel's cloud Browser tabs,
   * and a while after among those let go lately: what they hold, each time
   * one moves, the agent's pointer among it, or a takeover lapses, reaches
   * the panel on app state (`LIVE_READ.BROWSER_TABS`), so the stream
   * carries nothing.
   */
  TASKS_BROWSER_TABS_FOLLOW: "tasks.browserTabsFollow",
  /** A fenced block of a transcript's markdown, colored by main as the File tab's lines are: the code and its fence's language go, the lines come back; answered to the block, never on the document. */
  TASKS_COLOR_CODE: "tasks.colourCode",
  /** The id of the task a link names by its workspace and its number, found on the service before the link opens; answered to the window, never on the document. */
  TASKS_FIND: "tasks.find",
  /** A page of the open plan's history for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISIONS: "tasks.revisions",
  /** A revision of the open plan beside the one before it for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISION: "tasks.revision",
  /** A revision of a plan restored as its content on the service; answers whether it was, and the document arrives as the service answered it. */
  TASKS_RESTORE: "tasks.restore",
  /** A page tab's source of one version of one of the plan's pages, read from the service as its frame's is and colored by main as HTML; answered to the tab, never on the document. */
  TASKS_PAGE_SOURCE: "tasks.pageSource",
  /**
   * One plan's pages, or one agent's on no task, held followed while the
   * window holds the stream open for a surface that draws them, the open
   * task's page, the panel beside an Inbox item, an agent's page, or a
   * page's card or frame, and a while after among those let go lately: what
   * they hold reaches the panel on app state (`LIVE_READ.PAGES`), so the
   * stream carries nothing.
   */
  TASKS_PAGES_FOLLOW: "tasks.pagesFollow",
  /**
   * One plan's newest page of history, followed while the window holds the
   * stream open for its version history: each time a save lands, over Neon
   * Realtime, never on the document.
   */
  TASKS_HISTORY_FOLLOW: "tasks.historyFollow",
  /** One picture of the open plan as its bytes in base64, read from the service for the document drawing it; answered to the view, never on the document. */
  TASKS_PICTURE_READ: "tasks.pictureRead",
  /** A picture pasted, dropped, or chosen into the open plan's editor, kept on the service; answered with the id the text then names it by. */
  TASKS_PICTURE_KEEP: "tasks.pictureKeep",
  /**
   * A task's comment threads, its plan's own or one page's: held followed
   * while a window shows them, what they hold reaching the panel on app
   * state (`LIVE_READ.PLAN_COMMENTS`), and read again at once on Try again;
   * one started on words of the plan or on a page, and one thing done to
   * one thread, each answered with the thread as it stands.
   */
  TASKS_COMMENTS_FOLLOW: "tasks.commentsFollow",
  TASKS_COMMENTS_RETRY: "tasks.commentsRetry",
  TASKS_COMMENT_START: "tasks.commentStart",
  TASKS_COMMENT_ACT: "tasks.commentAct",
} as const;

/**
 * A cloud Browser tab's live view (`@repo/features/browser-live-acts`): one
 * view attached for the asking panel, its socket opened by the host under
 * the account's bearer, and detached. What the page shows travels on the
 * port an attach posts to that panel, never on an act.
 */
export const BROWSER_LIVE_ACT_KIND = {
  BROWSER_LIVE_ATTACH: "browserLive.attach",
  BROWSER_LIVE_DETACH: "browserLive.detach",
} as const;

/**
 * The Mac's own Terminal opened for a local agent, answered by the platform
 * shell (`mac-terminals.ts`).
 */
export const MAC_TERMINAL_ACT_KIND = {
  /** A local agent's own worktree, which the Mac's host made under `~/.vespin/agents`, opened in the Mac's Terminal. */
  MAC_TERMINAL_LOCAL_AGENT: "macTerminal.localAgent",
} as const;

/**
 * A command an agent asked to run on this Mac (`../mac-command-ask.ts`),
 * answered by the developer from the prompt the panel draws over the window:
 * allowed once, allowed always, which also writes Settings › This Mac to
 * Always allow, or denied. Answered by the host, which holds the ask.
 */
export const MAC_COMMAND_ACT_KIND = {
  MAC_COMMAND_ANSWER: "macCommands.answer",
} as const;

/**
 * A coding agent's Terminal tab (`messages/terminal.ts`): its shells listed,
 * started, named, and ended, its sandbox resumed on the developer's click,
 * and a shell attached and detached. What a shell prints travels on the port
 * an attach posts to the asking panel, never on an act.
 */
export const TERMINAL_ACT_KIND = {
  TERMINAL_LIST: "terminal.list",
  TERMINAL_CREATE: "terminal.create",
  TERMINAL_RENAME: "terminal.rename",
  TERMINAL_KILL: "terminal.kill",
  TERMINAL_RESUME: "terminal.resume",
  TERMINAL_ATTACH: "terminal.attach",
  TERMINAL_DETACH: "terminal.detach",
} as const;

/**
 * This Mac's host as Settings › Hosts reaches it (`this-mac-host.ts`): the
 * device its record names, read while Hosts is drawn. Answered by the host,
 * which keeps it.
 */
export const THIS_MAC_HOST_ACT_KIND = {
  THIS_MAC_HOST_READ: "thisMacHost.read",
} as const;

/**
 * The updater as Settings' row and the sidebar's foot reach it: a check
 * asked for, answered with where the updater then stands; the ready build
 * installed; the app moved to Applications, where an install needs it; and
 * the releases page and the changelog opened.
 */
export const UPDATE_ACT_KIND = {
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_MOVE_TO_APPLICATIONS: "update.moveToApplications",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
} as const;

/**
 * The account's workspaces: one made under a name, answered as made, which
 * the account owns; one renamed by its owners and admins, answered under
 * its new name; one's photo set as a `data:` URL or removed with null by
 * its owners and admins, answered with the photo's new version or none;
 * one's pending invitations read, one made, answered
 * with its accept link, and one canceled, for its owners and admins; a GitHub
 * organization connected to one, our GitHub App's install address the
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
export const WORKSPACE_ACT_KIND = {
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_RENAME: "workspace.rename",
  WORKSPACE_INVITATIONS_READ: "workspace.invitationsRead",
  WORKSPACE_INVITE: "workspace.invite",
  WORKSPACE_INVITATION_CANCEL: "workspace.invitationCancel",
  WORKSPACE_GITHUB_CONNECT: "workspace.githubConnect",
  WORKSPACE_GITHUB_DISCONNECT: "workspace.githubDisconnect",
  WORKSPACE_SENTRY_READ: "workspace.sentryRead",
  WORKSPACE_SENTRY_INSTALL: "workspace.sentryInstall",
  WORKSPACE_SENTRY_DISCONNECT: "workspace.sentryDisconnect",
  WORKSPACE_SLACK_BOT_READ: "workspace.slackBotRead",
  WORKSPACE_SLACK_BOT_CONNECT: "workspace.slackBotConnect",
  WORKSPACE_SLACK_BOT_DISCONNECT: "workspace.slackBotDisconnect",
  WORKSPACE_SLACK_BOT_NOTIFICATIONS: "workspace.slackBotNotifications",
  WORKSPACE_SLACK_BOT_REPOSITORY: "workspace.slackBotRepository",
  WORKSPACE_SLACK_BOT_CHANNEL: "workspace.slackBotChannel",
  WORKSPACE_MEMBERS_READ: "workspace.membersRead",
  WORKSPACE_FORMER_MEMBERS_READ: "workspace.formerMembersRead",
  /**
   * A workspace's people, followed while the window holds the stream open:
   * its members and who its work names but left as they first stand, then
   * each time they move, or why there are none.
   */
  WORKSPACE_PEOPLE: "workspace.people",
  /**
   * A workspace's pending invitations, followed for an owner or an admin
   * while the window holds the stream open: as they first stand, then each
   * time they move, or why there are none.
   */
  WORKSPACE_INVITATIONS: "workspace.invitations",
  WORKSPACE_MEMBER_REMOVE: "workspace.memberRemove",
  WORKSPACE_MEMBER_ROLE: "workspace.memberRole",
  WORKSPACE_TRANSFER: "workspace.transfer",
  WORKSPACE_LEAVE: "workspace.leave",
  WORKSPACE_PHOTO_READ: "workspace.photoRead",
  WORKSPACE_PHOTO_SET: "workspace.photoSet",
  WORKSPACE_SLUG_SET: "workspace.slugSet",
  WORKSPACE_TOKEN_REPOSITORIES_READ: "workspace.tokenRepositoriesRead",
  WORKSPACE_TOKEN_REPOSITORY_SET: "workspace.tokenRepositorySet",
} as const;

/**
 * What a window asks of the system it is drawn on: the microphone asked for
 * and its route read afresh, the microphone's and the notifications' settings
 * opened, a new mail to the people who make the app, the panel focused, words
 * copied, a file saved, and feedback sent.
 */
export const WINDOW_SURFACE_ACT_KIND = {
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
  /** A new message to the people who make the app, in the system's mail app, to the address main holds. */
  CONTACT_EMAIL: "contact.email",
  WINDOW_FOCUS_PANEL: "window.focusPanel",
  WINDOW_COPY_TEXT: "window.copyText",
  /** A picture put on the clipboard as a PNG, as a copy from Preview puts one. */
  WINDOW_COPY_IMAGE: "window.copyImage",
  WINDOW_SAVE_FILE: "window.saveFile",
  /**
   * A downscaled still of part of the asking panel, as ⌃Tab's card previews a
   * tab it left: answered to that panel alone and kept nowhere else.
   */
  WINDOW_CAPTURE: "window.capture",
  /**
   * Whether the asking panel holds work it has not saved, told each time
   * that changes, so a quit, a restart to update, and a sign-out ask first
   * while it does.
   */
  WINDOW_UNSAVED_WORK: "window.unsavedWork",
  FEEDBACK_SEND: "feedback.send",
} as const;

/** Every kind the act port answers, one spread per domain, in alphabetical order. */
export const PORT_ACT_KIND = {
  ...ACCOUNT_ACT_KIND,
  ...ACCOUNT_ASK_ACT_KIND,
  ...AGENT_ACT_KIND,
  ...AGENT_INBOX_ACT_KIND,
  ...AUTOMATION_ACT_KIND,
  ...BROWSER_LIVE_ACT_KIND,
  ...CHAPTERS_ACT_KIND,
  ...INSTALLED_SKILL_ACT_KIND,
  ...INTEGRATION_ACT_KIND,
  ...MAC_COMMAND_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...SETTINGS_ACT_KIND,
  ...TASKS_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...THIS_MAC_HOST_ACT_KIND,
  ...UPDATE_ACT_KIND,
  ...WINDOW_SURFACE_ACT_KIND,
  ...WORKSPACE_ACT_KIND,
} as const;

export type PortActKind = (typeof PORT_ACT_KIND)[keyof typeof PORT_ACT_KIND];

/**
 * What an act kind does with what it answers, which the panel's lint rule
 * `anti-slop/no-follow-outside-host-read` reads: a READ answers data that
 * can change while a surface shows it, so a surface reads it only through
 * `useHostRead`, over what the host holds; a FETCH answers what cannot
 * change for what was asked, such as content read once, a lookup as a link
 * opens, or a report for the query asked; and a WRITE is everything else: a
 * change, a command, or a stream a port carries rather than app state.
 */
export const ACT_USE = {
  READ: "read",
  WRITE: "write",
  FETCH: "fetch",
} as const;

export type ActUse = (typeof ACT_USE)[keyof typeof ACT_USE];

/**
 * Each port kind's use, by the name a call site spells it by, in the order
 * of `PORT_ACT_KIND`'s spreads. A kind added without its use, or a use left
 * behind its kind, fails the typecheck. Note that some names mislead: a
 * kind that marks something read or shown is a WRITE, as is one that opens
 * a Terminal tab's or a live view's stream, whose bytes never reach app
 * state; `TASKS_REFRESH` is a WRITE, the task list's Try again, because the
 * host follows the list from the account gate opening and only a press asks
 * it again; and `AGENTS_CHANGES`, `TASKS_TREE`, and `TERMINAL_LIST` are
 * FETCHes, though each answers what stands now, because each is asked again
 * whenever it is shown and nothing keeps it.
 */
export const PORT_ACT_USE = {
  ACCOUNT_BEGIN_SIGN_IN: ACT_USE.WRITE,
  ACCOUNT_SIGN_IN_AGAIN: ACT_USE.WRITE,
  ACCOUNT_CANCEL_SIGN_IN: ACT_USE.WRITE,
  ACCOUNT_SIGN_OUT: ACT_USE.WRITE,
  ACCOUNT_DELETE: ACT_USE.WRITE,

  PROVIDER_KEYS_FOLLOW: ACT_USE.READ,
  PROVIDER_KEYS_RETRY: ACT_USE.READ,
  PROVIDER_KEYS_SAVE: ACT_USE.WRITE,
  PROVIDER_KEYS_REMOVE: ACT_USE.WRITE,
  PROVIDER_KEYS_FOR_AGENTS: ACT_USE.WRITE,
  CHATGPT_SIGN_IN: ACT_USE.WRITE,
  CHATGPT_SIGN_IN_CANCEL: ACT_USE.WRITE,
  GITHUB_TOKEN_READ: ACT_USE.READ,
  GITHUB_TOKEN_SAVE: ACT_USE.WRITE,
  GITHUB_TOKEN_REMOVE: ACT_USE.WRITE,
  MEMORIES_READ: ACT_USE.READ,
  MEMORIES_FORGET: ACT_USE.WRITE,
  DICTATION_TRANSCRIBE: ACT_USE.FETCH,

  AGENTS_MODELS: ACT_USE.READ,
  AGENTS_DEFAULT_READ: ACT_USE.READ,
  AGENTS_DEFAULT_WRITE: ACT_USE.WRITE,
  HOSTS_LIST: ACT_USE.READ,
  HOSTS_PRESENCE_FOLLOW: ACT_USE.READ,
  HOSTS_PRESENCE_REFRESH: ACT_USE.READ,
  HOSTS_REMOVE: ACT_USE.WRITE,
  HOSTS_PAIRING_READ: ACT_USE.READ,
  HOSTS_PAIRING_APPROVE: ACT_USE.WRITE,
  HOSTS_PAIRING_DENY: ACT_USE.WRITE,
  AGENTS_LIST: ACT_USE.READ,
  AGENTS_WORKSPACE_LIST: ACT_USE.READ,
  AGENTS_START: ACT_USE.WRITE,
  AGENTS_MESSAGES: ACT_USE.READ,
  AGENTS_TRANSCRIPT: ACT_USE.READ,
  AGENTS_PART: ACT_USE.FETCH,
  AGENTS_TRANSCRIPT_OLDER: ACT_USE.READ,
  AGENTS_MESSAGE: ACT_USE.WRITE,
  AGENTS_CHOOSE: ACT_USE.WRITE,
  AGENTS_RENAME: ACT_USE.WRITE,
  AGENTS_SERVERS: ACT_USE.WRITE,
  AGENTS_QUEUE: ACT_USE.WRITE,
  AGENTS_STOP: ACT_USE.WRITE,
  AGENTS_REWIND: ACT_USE.WRITE,
  AGENTS_ARCHIVE: ACT_USE.WRITE,
  AGENTS_PIN: ACT_USE.WRITE,
  AGENTS_DELETE: ACT_USE.WRITE,
  AGENTS_SHOWN: ACT_USE.WRITE,
  AGENTS_SEEN: ACT_USE.WRITE,
  AGENTS_PAGE: ACT_USE.FETCH,
  AGENTS_ORIGIN_FOLLOW: ACT_USE.READ,
  AGENTS_ORIGIN_RETRY: ACT_USE.READ,
  AGENTS_PULL_REQUEST: ACT_USE.READ,
  AGENTS_CHANGES: ACT_USE.FETCH,
  AGENTS_OVERVIEW_PULL_REQUEST: ACT_USE.READ,
  AGENTS_REVIEW_OPTIONS: ACT_USE.READ,
  AGENTS_WORKSPACE_TOOLS_FOLLOW: ACT_USE.READ,
  AGENTS_WORKSPACE_TOOLS_RETRY: ACT_USE.READ,
  AGENTS_OVERVIEW_CHECKS: ACT_USE.READ,
  AGENTS_OVERVIEW_CONVERSATION: ACT_USE.READ,
  AGENTS_GITHUB_IMAGE: ACT_USE.FETCH,
  AGENTS_PULL_REQUEST_ACTION: ACT_USE.WRITE,
  AGENTS_PULL_REQUEST_VIEWED: ACT_USE.READ,

  AGENTS_INBOX_FOLLOW: ACT_USE.READ,
  AGENTS_INBOX_RETRY: ACT_USE.READ,
  AGENTS_INBOX_ITEMS_RETRY: ACT_USE.READ,
  AGENTS_INBOX_ANSWER: ACT_USE.WRITE,
  AGENTS_INBOX_CLOSE: ACT_USE.WRITE,
  AGENTS_INBOX_MESSAGE: ACT_USE.WRITE,
  AGENTS_INBOX_START: ACT_USE.WRITE,
  AGENTS_INBOX_READ_STATE: ACT_USE.WRITE,
  AGENTS_INBOX_ITEM_HOME: ACT_USE.FETCH,
  AGENTS_INBOX_READ_ALL: ACT_USE.WRITE,
  AGENTS_INBOX_ATTACHMENT: ACT_USE.FETCH,
  AGENTS_PICTURE: ACT_USE.FETCH,

  AUTOMATIONS_CREATE: ACT_USE.WRITE,
  AUTOMATIONS_CHANGE: ACT_USE.WRITE,
  AUTOMATIONS_DELETE: ACT_USE.WRITE,
  AUTOMATIONS_RUN: ACT_USE.WRITE,
  AUTOMATIONS_NEW_WEBHOOK_SECRET: ACT_USE.WRITE,
  AUTOMATIONS_FOLLOW: ACT_USE.READ,
  AUTOMATIONS_RETRY: ACT_USE.READ,

  BROWSER_LIVE_ATTACH: ACT_USE.WRITE,
  BROWSER_LIVE_DETACH: ACT_USE.WRITE,

  CHAPTERS_FOLLOW: ACT_USE.READ,
  CHAPTERS_RETRY: ACT_USE.READ,
  CHAPTERS_GENERATE: ACT_USE.WRITE,
  CHAPTERS_MODEL_READ: ACT_USE.READ,
  CHAPTERS_MODEL_WRITE: ACT_USE.WRITE,

  INSTALLED_SKILLS_LIST: ACT_USE.READ,
  INSTALLED_SKILLS_READ: ACT_USE.FETCH,
  INSTALLED_SKILLS_PREVIEW: ACT_USE.FETCH,
  INSTALLED_SKILLS_PREVIEW_FILE: ACT_USE.FETCH,
  INSTALLED_SKILLS_INSTALL: ACT_USE.WRITE,
  INSTALLED_SKILLS_SET_ENABLED: ACT_USE.WRITE,
  INSTALLED_SKILLS_CHECK_UPDATE: ACT_USE.FETCH,
  INSTALLED_SKILLS_UPDATE: ACT_USE.WRITE,
  INSTALLED_SKILLS_SHARE: ACT_USE.WRITE,
  INSTALLED_SKILLS_REMOVE: ACT_USE.WRITE,

  INTEGRATIONS_STATUS: ACT_USE.READ,
  INTEGRATIONS_CONNECT: ACT_USE.WRITE,
  INTEGRATIONS_CANCEL: ACT_USE.WRITE,
  INTEGRATIONS_DISCONNECT: ACT_USE.WRITE,
  INTEGRATIONS_TOOLS_FOLLOW: ACT_USE.READ,
  INTEGRATIONS_TOOLS_RETRY: ACT_USE.READ,
  INTEGRATIONS_RENAME: ACT_USE.WRITE,
  MCP_CLIENTS_FOLLOW: ACT_USE.READ,
  MCP_CLIENTS_RETRY: ACT_USE.READ,
  MCP_CLIENTS_REVOKE: ACT_USE.WRITE,

  MAC_COMMAND_ANSWER: ACT_USE.WRITE,

  MAC_TERMINAL_LOCAL_AGENT: ACT_USE.WRITE,

  SETTING_UPDATE: ACT_USE.WRITE,
  SETTINGS_RESET: ACT_USE.WRITE,
  EXPERIMENT_SET: ACT_USE.WRITE,

  TASKS_REFRESH: ACT_USE.WRITE,
  TASKS_SELECT: ACT_USE.WRITE,
  TASKS_CLOSE: ACT_USE.WRITE,
  TASKS_START: ACT_USE.WRITE,
  TASKS_DELETE: ACT_USE.WRITE,
  TASKS_RENAME: ACT_USE.WRITE,
  TASKS_PIN: ACT_USE.WRITE,
  TASKS_PIN_REPOSITORY: ACT_USE.WRITE,
  TASKS_WRITE_SECTION: ACT_USE.WRITE,
  TASKS_REPOSITORIES: ACT_USE.READ,
  TASKS_SET_REPOSITORY: ACT_USE.WRITE,
  TASKS_MOVE: ACT_USE.WRITE,
  TASKS_BLOCK: ACT_USE.WRITE,
  TASKS_SET_PARENT: ACT_USE.WRITE,
  TASKS_CHANGE_RELATION: ACT_USE.WRITE,
  TASKS_EDIT: ACT_USE.WRITE,
  GITHUB_OPEN: ACT_USE.WRITE,
  WEB_OPEN: ACT_USE.WRITE,
  GITHUB_CONNECT: ACT_USE.WRITE,
  ADMIN_OPEN: ACT_USE.WRITE,
  ADMIN_READ: ACT_USE.FETCH,
  ADMIN_FAVORITE: ACT_USE.WRITE,
  GITHUB_DISCONNECT: ACT_USE.WRITE,
  TASKS_SET_STANDING: ACT_USE.WRITE,
  TASKS_FILE: ACT_USE.FETCH,
  TASKS_TREE: ACT_USE.FETCH,
  TASKS_SKILLS: ACT_USE.FETCH,
  TASKS_PULL_REQUEST: ACT_USE.READ,
  TASKS_ISSUE: ACT_USE.READ,
  TASKS_BROWSER_TAB_OPEN: ACT_USE.WRITE,
  TASKS_BROWSER_TABS_FOLLOW: ACT_USE.READ,
  TASKS_COLOR_CODE: ACT_USE.FETCH,
  TASKS_FIND: ACT_USE.FETCH,
  TASKS_REVISIONS: ACT_USE.FETCH,
  TASKS_REVISION: ACT_USE.FETCH,
  TASKS_RESTORE: ACT_USE.WRITE,
  TASKS_PAGE_SOURCE: ACT_USE.FETCH,
  TASKS_PAGES_FOLLOW: ACT_USE.READ,
  TASKS_HISTORY_FOLLOW: ACT_USE.READ,
  TASKS_PICTURE_READ: ACT_USE.FETCH,
  TASKS_PICTURE_KEEP: ACT_USE.WRITE,
  TASKS_COMMENTS_FOLLOW: ACT_USE.READ,
  TASKS_COMMENTS_RETRY: ACT_USE.READ,
  TASKS_COMMENT_START: ACT_USE.WRITE,
  TASKS_COMMENT_ACT: ACT_USE.WRITE,

  TERMINAL_LIST: ACT_USE.FETCH,
  TERMINAL_CREATE: ACT_USE.WRITE,
  TERMINAL_RENAME: ACT_USE.WRITE,
  TERMINAL_KILL: ACT_USE.WRITE,
  TERMINAL_RESUME: ACT_USE.WRITE,
  TERMINAL_ATTACH: ACT_USE.WRITE,
  TERMINAL_DETACH: ACT_USE.WRITE,

  THIS_MAC_HOST_READ: ACT_USE.READ,

  UPDATE_CHECK: ACT_USE.WRITE,
  UPDATE_INSTALL: ACT_USE.WRITE,
  UPDATE_MOVE_TO_APPLICATIONS: ACT_USE.WRITE,
  UPDATE_OPEN_RELEASE: ACT_USE.WRITE,
  UPDATE_OPEN_CHANGELOG: ACT_USE.WRITE,

  MICROPHONE_REQUEST: ACT_USE.WRITE,
  MICROPHONE_ROUTE: ACT_USE.FETCH,
  MICROPHONE_OPEN_SETTINGS: ACT_USE.WRITE,
  NOTIFICATIONS_OPEN_SETTINGS: ACT_USE.WRITE,
  CONTACT_EMAIL: ACT_USE.WRITE,
  WINDOW_FOCUS_PANEL: ACT_USE.WRITE,
  WINDOW_COPY_TEXT: ACT_USE.WRITE,
  WINDOW_COPY_IMAGE: ACT_USE.WRITE,
  WINDOW_SAVE_FILE: ACT_USE.WRITE,
  WINDOW_CAPTURE: ACT_USE.FETCH,
  WINDOW_UNSAVED_WORK: ACT_USE.WRITE,
  FEEDBACK_SEND: ACT_USE.WRITE,

  WORKSPACE_CREATE: ACT_USE.WRITE,
  WORKSPACE_RENAME: ACT_USE.WRITE,
  WORKSPACE_INVITATIONS_READ: ACT_USE.READ,
  WORKSPACE_INVITE: ACT_USE.WRITE,
  WORKSPACE_INVITATION_CANCEL: ACT_USE.WRITE,
  WORKSPACE_GITHUB_CONNECT: ACT_USE.WRITE,
  WORKSPACE_GITHUB_DISCONNECT: ACT_USE.WRITE,
  WORKSPACE_SENTRY_READ: ACT_USE.READ,
  WORKSPACE_SENTRY_INSTALL: ACT_USE.WRITE,
  WORKSPACE_SENTRY_DISCONNECT: ACT_USE.WRITE,
  WORKSPACE_SLACK_BOT_READ: ACT_USE.READ,
  WORKSPACE_SLACK_BOT_CONNECT: ACT_USE.WRITE,
  WORKSPACE_SLACK_BOT_DISCONNECT: ACT_USE.WRITE,
  WORKSPACE_SLACK_BOT_NOTIFICATIONS: ACT_USE.WRITE,
  WORKSPACE_SLACK_BOT_REPOSITORY: ACT_USE.WRITE,
  WORKSPACE_SLACK_BOT_CHANNEL: ACT_USE.WRITE,
  WORKSPACE_MEMBERS_READ: ACT_USE.READ,
  WORKSPACE_FORMER_MEMBERS_READ: ACT_USE.READ,
  WORKSPACE_PEOPLE: ACT_USE.READ,
  WORKSPACE_INVITATIONS: ACT_USE.READ,
  WORKSPACE_MEMBER_REMOVE: ACT_USE.WRITE,
  WORKSPACE_MEMBER_ROLE: ACT_USE.WRITE,
  WORKSPACE_TRANSFER: ACT_USE.WRITE,
  WORKSPACE_LEAVE: ACT_USE.WRITE,
  WORKSPACE_PHOTO_READ: ACT_USE.READ,
  WORKSPACE_PHOTO_SET: ACT_USE.WRITE,
  WORKSPACE_SLUG_SET: ACT_USE.WRITE,
  WORKSPACE_TOKEN_REPOSITORIES_READ: ACT_USE.READ,
  WORKSPACE_TOKEN_REPOSITORY_SET: ACT_USE.WRITE,
} as const satisfies Record<keyof typeof PORT_ACT_KIND, ActUse>;

/**
 * The port kinds the platform shell answers itself, because they reach its
 * windows, ports, and system, one spread per domain, in alphabetical order;
 * the host's procedures answer every other.
 */
export const PLATFORM_PORT_ACT_KIND = {
  ...BROWSER_LIVE_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...UPDATE_ACT_KIND,
  ...WINDOW_SURFACE_ACT_KIND,
} as const;

export type PlatformPortActKind =
  (typeof PLATFORM_PORT_ACT_KIND)[keyof typeof PLATFORM_PORT_ACT_KIND];

/**
 * The handshake that hands a window's act port to main, as oRPC's Electron
 * adapter has it: the page posts one end of a channel to its own window with
 * `REQUEST`, and the preload forwards it to main on `CHANNEL`.
 */
export const ACT_PORT = {
  REQUEST: "app:act-port",
  CHANNEL: "app:act-port",
} as const;

/** A window message as the preload hears it: what was posted, by whom, and the ports it carried. */
export interface ActPortMessage<Port, Source> {
  readonly data: unknown;
  readonly source: Source | null;
  readonly ports: readonly Port[];
}

/**
 * The preload's listener for the page's act port: the first port the page
 * posts to itself with the handshake is forwarded to main, and every later
 * one is ignored, so one page holds one port for its life. A reload runs the
 * preload again, and the new page forwards its own.
 */
export function actPortForwarder<Port, Source>(
  self: Source,
  forward: (port: Port) => void,
): (message: ActPortMessage<Port, Source>) => void {
  let forwarded = false;
  return (message) => {
    if (forwarded || message.source !== self || message.data !== ACT_PORT.REQUEST) return;
    const [port] = message.ports;
    if (port === undefined) return;
    forwarded = true;
    forward(port);
  };
}
