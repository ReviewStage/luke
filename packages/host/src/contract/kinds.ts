/**
 * kinds.ts -- the act kinds the window's act port answers, by domain, and the handshake that opens the port.
 *
 * Kept free of oRPC and of every schema, so `acts.ts` can spell these kinds
 * in `ACT_KIND` beside the ones `app:act` still carries without resolving the
 * contract behind them. A kind here is the key of its procedure in
 * `actContract`, so the panel's act door calls a kind by its own name.
 */

/** The account's asks: a sign-in begun, begun again, or cancelled, a sign-out, and the account deleted. */
export const ACCOUNT_ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
} as const;

/**
 * The account's own asks from Settings and a dictating box: its provider keys,
 * its plan template and that template's history, and a dictated clip's words.
 */
export const ACCOUNT_ASK_ACT_KIND = {
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
} as const;

/** The Automations pages' asks: the account's automations listed, made, changed, deleted, run now, and one's runs read. */
export const AUTOMATION_ACT_KIND = {
  AUTOMATIONS_LIST: "automations.list",
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  AUTOMATIONS_RUNS: "automations.runs",
  /** A webhook's secret minted again by the host and answered to this window alone, once, to show. */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
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
   * archived (a turn it still runs stopped first) or brought back. The
   * window holds what it draws; nothing here does.
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
  /** What one agent published: its branch and pull request as GitHub holds them. */
  CODING_AGENTS_PULL_REQUEST: "codingAgents.pullRequest",
  /** One agent's changes, its pull request's files with their patches, which its Changes tab draws. */
  CODING_AGENTS_CHANGES: "codingAgents.changes",
  /** One agent's pull request itself, its description, branches, mergeability, and people, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_PULL_REQUEST: "codingAgents.overviewPullRequest",
  /** What the reviewer and label pickers of an agent's Pull request tab offer. */
  CODING_AGENTS_REVIEW_OPTIONS: "codingAgents.reviewOptions",
  /** The checks on one agent's pull request's head, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_CHECKS: "codingAgents.overviewChecks",
  /** One agent's pull request's conversation and where its reviewers stand, which its Pull request tab's overview draws. */
  CODING_AGENTS_OVERVIEW_CONVERSATION: "codingAgents.overviewConversation",
  /** One image an agent's pull request's overview names, its bytes read by the service on the App's token. */
  CODING_AGENTS_GITHUB_IMAGE: "codingAgents.githubImage",
  /** One change to an agent's pull request, such as marking it ready for review, made on GitHub as the account on its own GitHub sign-in. */
  CODING_AGENTS_PULL_REQUEST_ACTION: "codingAgents.pullRequestAction",
  /** Which of an agent's pull request's files the account marked viewed on GitHub, read on its own GitHub sign-in. */
  CODING_AGENTS_PULL_REQUEST_VIEWED: "codingAgents.pullRequestViewed",
} as const;

/**
 * A task's coding agents, what they need of the developer and what they
 * say in the workspace: the Inbox read past a cursor (held open by the
 * service while nothing changed), a task's or one agent's; one item
 * answered, closed, messaged on its thread, or marked read or unread, and
 * every item marked read; an item's image and an agent's picture read by the
 * host under the account; and the workspace's chat read past a cursor,
 * written to as the account's own member, and a message's picture read. The
 * window holds what it draws; nothing here does.
 */
export const AGENT_INBOX_ACT_KIND = {
  CODING_AGENTS_INBOX: "codingAgents.inbox",
  CODING_AGENTS_AGENT_INBOX: "codingAgents.agentInbox",
  CODING_AGENTS_INBOX_ANSWER: "codingAgents.inboxAnswer",
  /** One open item closed without an answer against the revision the panel drew, under the panel's own key. */
  CODING_AGENTS_INBOX_CLOSE: "codingAgents.inboxClose",
  /** A message on one item's thread, open or settled, under the panel's own key; it never answers the item. */
  CODING_AGENTS_INBOX_MESSAGE: "codingAgents.inboxMessage",
  /** One item marked read or unread for the account; it changes neither what the item asks nor whether it waits. */
  CODING_AGENTS_INBOX_READ_STATE: "codingAgents.inboxReadState",
  /** Every item of the account's Inbox marked read, in one workspace or in all; the dots alone. */
  CODING_AGENTS_INBOX_READ_ALL: "codingAgents.inboxReadAll",
  /** One image of an inbox item, fetched by the host under the account, so the window holds no bearer and no address. */
  CODING_AGENTS_INBOX_ATTACHMENT: "codingAgents.inboxAttachment",
  CODING_AGENTS_PICTURE: "codingAgents.picture",
  CODING_AGENTS_CHAT: "codingAgents.chat",
  CODING_AGENTS_CHAT_POST: "codingAgents.chatPost",
  CODING_AGENTS_CHAT_ATTACHMENT: "codingAgents.chatAttachment",
} as const;

/**
 * Luke's avatar as the windows reach it: the panel's word on it, starting,
 * live on its first frame, or ended and why, taken from the panel alone; and
 * the video tile's Video off, Video on, and Restart video, Luke's avatar asked
 * for on the standing call or taken down, taken from the panel and the
 * floating call window, which draw the tile, alone.
 */
export const AVATAR_ACT_KIND = {
  AVATAR_REPORT: "avatar.report",
  VOICE_SET_VIDEO: "voice.setVideo",
} as const;

/** The Factory page's ask: a workspace's Factory world, read whole as it stands now. */
export const FACTORY_ACT_KIND = {
  FACTORY_WORLD: "factory.world",
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
  /** The tools one account's server offers the account's agents, read from the service when a list of them is shown. */
  INTEGRATIONS_TOOLS: "integrations.tools",
  /** One account at a provider named as the developer calls it. */
  INTEGRATIONS_RENAME: "integrations.rename",
} as const;

/** The Issues page's asks: a workspace's issues listed, one read, one filed, and one changed. */
export const ISSUE_ACT_KIND = {
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
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
 * repository, pinned or unpinned, archived or brought back, or deleted. The view arrives on the document rather than as
 * an answer. The one write of a task's document from here is the
 * developer's edit of a field, `TASKS_EDIT`, which answers whether it
 * saved, conflicted with what Luke wrote meanwhile, or failed. Beside them,
 * a page of GitHub's or the web's opened in the browser, the account's own
 * GitHub connected or disconnected, a call about the open task, and its
 * whiteboard saved. And what one task holds, read as its tabs draw it: its
 * earlier work and conversation, a call's messages, its repository's files,
 * folders, skills, pull requests, and issues, a fenced block coloured, its
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
  /** A task given its status and priority on the service; answers whether it saved. */
  TASKS_SET_STANDING: "tasks.setStanding",
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
   * The open plan's comment threads: read past a cursor (held open by the
   * service while nothing changed), one started on words of the plan, and
   * one thing done to one thread. The window holds what it draws.
   */
  TASKS_COMMENTS: "tasks.comments",
  TASKS_COMMENT_START: "tasks.commentStart",
  TASKS_COMMENT_ACT: "tasks.commentAct",
} as const;

/**
 * A coding agent's branch run on this Mac (`@luke/features/mac-terminal-wire`):
 * each repository's run command read and set; a run of the agent's branch
 * started for the asking panel, stopped with Stop, and closed with its tab;
 * and its worktree opened in the Mac's own Terminal. What the run prints
 * travels on the port an open posts to that panel, never on an act.
 */
export const MAC_TERMINAL_ACT_KIND = {
  MAC_REPOSITORIES: "macRepositories.read",
  MAC_REPOSITORY_SET: "macRepositories.set",
  MAC_TERMINAL_OPEN: "macTerminal.open",
  MAC_TERMINAL_CLOSE: "macTerminal.close",
  MAC_TERMINAL_STOP: "macTerminal.stop",
  MAC_TERMINAL_REVEAL: "macTerminal.reveal",
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
 * The voice window's runtime: a command to it from a panel or the call
 * window; the call card's way back, Luke's window brought forward on the
 * call's own task; the voice window as a GPT Live peer, its SDP offer handed
 * to the host, which creates the one session and answers the SDP, the
 * hang-up it asks the host to decide, and the two reports the host reads its
 * transport and its idle from, none carrying a credential; the stop key;
 * Stop Luke, on the task named, else the call's, else the open one; the
 * voice diagnostics; and the microphone's privacy settings opened.
 */
export const VOICE_RUNTIME_ACT_KIND = {
  VOICE_COMMAND: "voice.command",
  CALL_SHOW_TASK: "call.showTask",
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  LUKE_STOP: "luke.stop",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  MICROPHONE_OPEN_SETTINGS: "microphone.openSettings",
} as const;

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
export const WORKSPACE_ACT_KIND = {
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
} as const;

/** Every kind the act port answers, one spread per domain, in alphabetical order. */
export const PORT_ACT_KIND = {
  ...ACCOUNT_ACT_KIND,
  ...ACCOUNT_ASK_ACT_KIND,
  ...AGENT_ACT_KIND,
  ...AGENT_INBOX_ACT_KIND,
  ...AUTOMATION_ACT_KIND,
  ...AVATAR_ACT_KIND,
  ...FACTORY_ACT_KIND,
  ...INTEGRATION_ACT_KIND,
  ...ISSUE_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...SETTINGS_ACT_KIND,
  ...TASKS_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...VOICE_RUNTIME_ACT_KIND,
  ...WORKSPACE_ACT_KIND,
} as const;

export type PortActKind = (typeof PORT_ACT_KIND)[keyof typeof PORT_ACT_KIND];

/**
 * The port kinds the platform shell answers itself, because they reach its
 * windows, ports, and system, one spread per domain, in alphabetical order;
 * the host's procedures answer every other.
 */
export const PLATFORM_PORT_ACT_KIND = {
  ...AVATAR_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...VOICE_RUNTIME_ACT_KIND,
} as const;

export type PlatformPortActKind =
  (typeof PLATFORM_PORT_ACT_KIND)[keyof typeof PLATFORM_PORT_ACT_KIND];

/**
 * The handshake that hands a window's act port to main, as oRPC's Electron
 * adapter has it: the page posts one end of a channel to its own window with
 * `REQUEST`, and the preload forwards it to main on `CHANNEL`.
 */
export const ACT_PORT = {
  REQUEST: "luke:act-port",
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
