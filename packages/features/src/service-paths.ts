/**
 * Where Luke's hosted service answers, rooted at the service origin. The
 * addresses alone: what each endpoint takes and answers with is declared in
 * the wire module for its own domain, and a client that only needs to know
 * where to knock imports nothing else.
 */

export const HOSTED_SERVICE_PATH = {
  ACCOUNT_DELETE: "/api/account/delete",
  EVENTS: "/api/events",
  /**
   * Store and read account preferences (GET, PUT). Only settings named by
   * `@luke/settings` as cross-device preferences belong here.
   */
  ACCOUNT_PREFERENCES: "/api/account/preferences",
  /**
   * The account's own Anthropic and OpenAI API keys: read what they are
   * (GET), save one (PUT), or remove one (DELETE). No answer carries a key.
   * `provider-key-wire.ts` declares every body.
   */
  ACCOUNT_PROVIDER_KEYS: "/api/account/provider-keys",
  /**
   * The Markdown the account's new tasks start from: read it (GET), or keep
   * one verbatim or go back to the default (PUT).
   * `plan-document-template.ts` declares both bodies.
   */
  ACCOUNT_PLAN_TEMPLATE: "/api/account/plan-template",
  /**
   * The template's history: a page of its revisions, newest first, or with a
   * `before` query the page before that revision (GET).
   * `plan-document-template.ts` declares the answer.
   */
  ACCOUNT_PLAN_TEMPLATE_REVISIONS: "/api/account/plan-template/revisions",
  /**
   * A clip dictated into a message box, answered with its words (POST).
   * Nothing of the clip or its words is kept. `dictation-wire.ts` declares
   * both bodies.
   */
  DICTATION: "/api/dictation",
  /** Where every one of the account's integrations stands (GET). `integration-wire.ts` declares the answer. */
  ACCOUNT_INTEGRATIONS: "/api/account/integrations",
  /**
   * Where every one of the account's integrations stands, each sign-in
   * still under way settled first (POST): the statuses read's own answer.
   * The read settles only for a bearer, so a browser's cookie settles here.
   */
  ACCOUNT_INTEGRATIONS_SETTLE: "/api/account/integrations/settle",
  /**
   * Where Vercel Connect returns the browser from an integration's sign-in
   * (GET), with the sign-in's own state, which names the provider too: the
   * route settles it and sends the browser on to the landing page
   * `integration-wire.ts` names.
   */
  ACCOUNT_INTEGRATIONS_CONNECTED: "/api/account/integrations/connected",
  /**
   * What waits on the developer across the account's tasks: every open
   * inbox item, past a cursor (GET), held open while nothing changed, as a
   * task's inbox is. `account-inbox-wire.ts` declares the answer.
   */
  INBOX: "/api/inbox",
  /**
   * Every item the asking member's Inbox lists, marked read for them (PUT),
   * in the one workspace the body names or in all of theirs.
   * `inbox-wire.ts` declares the request and the answer.
   */
  INBOX_READ: "/api/inbox/read",
  /**
   * What waits on the developer across the account, sealed for following
   * over Neon Realtime (GET): the address and one sealed statement per part
   * of the account inbox, or `unavailable` where the deployment has no
   * Realtime. `live-wire.ts` declares the answer.
   */
  LIVE_INBOX: "/api/live/inbox",
  /**
   * A workspace's agents, on a task or with none, newest started first and
   * the archived ones left out unless the query asks for them, narrowed to
   * one repository where the query names one (GET), what an automation's
   * Same agent and an `@` list's agents are chosen from; the plan list's
   * answer (`coding-agent-wire.ts`).
   */
  AGENTS: "/api/agents",
  /**
   * The shell commands the account's agents asked to run on the developer's
   * Mac: the ones waiting, held open while none is, each claimed for the
   * Mac that read it (GET), and one's result (POST). `mac-command-wire.ts`
   * declares the bodies.
   */
  MAC_COMMANDS: "/api/mac-commands",
  /**
   * The account's automations: list them, newest first, or one task's where
   * `planId` names it (GET), or make one (POST). `automation-wire.ts`
   * declares the bodies.
   */
  AUTOMATIONS: "/api/automations",
  /**
   * A workspace's issues: list them, the most recently changed first, where
   * `workspaceId` names it (GET), or file one (POST). `issue-wire.ts`
   * declares the bodies.
   */
  ISSUES: "/api/issues",
  /**
   * One workspace's Factory world, read as it stands now, to a member of it
   * (POST). `factory-world-wire.ts` declares the bodies.
   */
  FACTORY_WORLD: "/api/factory/world",
  /** The models a coding agent may run on, as the service offers them now (GET). `models-wire.ts` declares the answer. */
  MODELS: "/api/models",
  /**
   * The account's named feature tasks: list them, newest started first
   * (GET), or start one (POST) with its name and, where one is chosen, the
   * GitHub repository it is about. `task-wire.ts` declares both.
   */
  TASKS: "/api/plans",
  /**
   * The repositories the account pinned in the sidebar: read them, newest
   * pinned first (GET), or pin or unpin one (PUT), answered with them all as
   * they then stand. `task-wire.ts` declares both.
   */
  REPOSITORY_PINS: "/api/repository-pins",
  /**
   * The sections the account made in its sidebars and the tasks it keeps in
   * them: read them (GET), or make, change, move, or delete one, or put a
   * task in one (PUT), answered with them all as they then stand.
   * `task-section-wire.ts` declares both.
   */
  TASK_SECTIONS: "/api/task-sections",
  /**
   * The repositories the signed-in account reaches through the Luke GitHub
   * App, most recently updated first (GET), with whether the App is
   * installed anywhere for them and where to install it.
   * `github-repositories-wire.ts` declares the answer, and the
   * `GITHUB_REPOSITORIES_QUERY` that names a workspace to list for.
   */
  GITHUB_REPOSITORIES: "/api/github/repositories",
  /**
   * One folder of a repository a workspace's installation reaches, as
   * GitHub holds it now (GET), named by the workspace and the repository
   * (`GITHUB_REPOSITORIES_QUERY`), for a place with no plan to name it by,
   * such as an agent an automation started; the answer is a plan's tree's
   * (`plan-wire.ts`).
   */
  GITHUB_REPOSITORY_TREE: "/api/github/repositories/tree",
  /**
   * The skills a developer may choose of a repository a workspace's
   * installation reaches (GET), named as `GITHUB_REPOSITORY_TREE` names it;
   * the answer is a plan's skills' (`plan-wire.ts`).
   */
  GITHUB_REPOSITORY_SKILLS: "/api/github/repositories/skills",
  /**
   * One pull request of a repository a workspace's installation reaches, as
   * GitHub holds it now (GET), named as `GITHUB_REPOSITORY_TREE` names the
   * repository and by its number (`GITHUB_REPOSITORIES_QUERY`), for a link
   * to it to draw its title and where it stands; the answer is
   * `github-repositories-wire.ts`'s, null where there is none to draw.
   */
  GITHUB_REPOSITORY_PULL_REQUEST: "/api/github/repositories/pull-request",
  /**
   * One issue of a repository a workspace's installation reaches, as GitHub
   * holds it now (GET), named as `GITHUB_REPOSITORY_PULL_REQUEST` names a
   * pull request, for a link to it to draw its title and where it stands;
   * the answer is `github-repositories-wire.ts`'s, null where there is none
   * to draw.
   */
  GITHUB_REPOSITORY_ISSUE: "/api/github/repositories/issue",
  /**
   * Sends the browser to GitHub to install the Luke GitHub App, or to change
   * which repositories it reaches (GET). GitHub returns the browser to
   * `GITHUB_INSTALLED` afterwards.
   */
  GITHUB_INSTALL: "/api/github/install",
  /**
   * The App's Setup URL (GET): GitHub lands here after an install or an
   * update with the installation's id, and the route confirms it before
   * sending the browser on to the landing page `github-install-wire.ts`
   * names.
   */
  GITHUB_INSTALLED: "/api/github/installed",
  /**
   * The callback a workspace's connect returns through (GET): the Setup URL
   * sends the browser to authorize the App once, GitHub returns it here with
   * a one-time code, and the route confirms the installation with the user
   * who authorized before linking it. A registered callback URL of the App.
   */
  GITHUB_INSTALLED_AUTHORIZED: "/api/github/installed/authorized",
  /**
   * A connect intent for the account's GitHub (POST): a ten-minute,
   * single-use ticket bound to the account, answered with the web page that
   * links GitHub on the browser's session. `github-connection-wire.ts`
   * declares the answer.
   */
  GITHUB_CONNECT: "/api/github/connect",
  /**
   * The connect page claims an intent (POST) on the browser's own session
   * rather than a bearer: only the intent's own account claims it.
   * `github-connection-wire.ts` declares both bodies.
   */
  GITHUB_CONNECT_CLAIM: "/api/github/connect/claim",
  /** Whether the account has connected its GitHub (GET). `github-connection-wire.ts` declares the answer. */
  GITHUB_CONNECTION: "/api/github/connection",
  /**
   * The account's GitHub disconnected (POST), under the Mac's Better Auth
   * session rather than its OAuth token, answering the connection as it then
   * stands.
   */
  GITHUB_DISCONNECT: "/api/github/disconnect",
  /**
   * The workspaces the account is a member of, its first one first and
   * the rest by name, each with its connected GitHub account (GET), or a
   * workspace created, the account its owner (POST). `workspace-wire.ts`
   * declares both.
   */
  WORKSPACES: "/api/workspaces",
  /**
   * Where an owner or admin connects a GitHub organization to a workspace
   * (POST): answers the Luke GitHub App's install address, carrying a
   * single-use intent GitHub returns to `GITHUB_INSTALLED` with.
   */
  WORKSPACE_GITHUB_CONNECT: "/api/workspaces/github/connect",
  /** A workspace's GitHub organization disconnected by an owner or admin (POST), answering the workspace. */
  WORKSPACE_GITHUB_DISCONNECT: "/api/workspaces/github/disconnect",
  /**
   * Where an owner or admin connects Linear for a whole workspace (POST):
   * answers Vercel Connect's sign-in address, which returns the browser to
   * `/api/workspaces/linear/connected` (`linear-wire.ts`).
   */
  WORKSPACE_LINEAR_CONNECT: "/api/workspaces/linear/connect",
  /** Where Vercel Connect returns the browser from a workspace's Linear sign-in (GET), which lands it on the integrations landing page. */
  WORKSPACE_LINEAR_CONNECTED: "/api/workspaces/linear/connected",
  /** A workspace's Linear disconnected by an owner or admin (POST), answering the workspace. */
  WORKSPACE_LINEAR_DISCONNECT: "/api/workspaces/linear/disconnect",
  /** The Linear issues a member of a workspace may start a plan from, or those a search matches (POST). */
  WORKSPACE_LINEAR_ISSUES: "/api/workspaces/linear/issues",
  /** A workspace renamed by an owner or an admin (POST), answering the workspace; its slug stays as it was. */
  WORKSPACES_RENAME: "/api/workspaces/rename",
  /** A workspace's photo set as a `data:` URL, or removed with null, by an owner or an admin (POST), answering the workspace. */
  WORKSPACES_PHOTO_SET: "/api/workspaces/photo/set",
  /** One workspace's members, to a member of it (GET), the workspace named in `workspace-wire.ts`'s `WORKSPACE_MEMBERS_QUERY`. */
  WORKSPACES_MEMBERS: "/api/workspaces/members",
  /**
   * A workspace's chat as a person in it reads it past a cursor (GET), held
   * open while nothing moved, the workspace and the cursor named in
   * `chat-wire.ts`'s `CHAT_QUERY`, which declares the answer.
   */
  WORKSPACES_CHAT: "/api/workspaces/chat",
  /**
   * One picture a chat message carries, served as its bytes to a person in
   * the workspace (GET), the workspace, the message, and the attachment
   * named in `chat-wire.ts`'s `CHAT_ATTACHMENT_QUERY`.
   */
  WORKSPACES_CHAT_ATTACHMENT: "/api/workspaces/chat/attachment",
  /** The owner removes an admin or a member, and an admin a member (POST), answered with those who remain. */
  WORKSPACES_MEMBERS_REMOVE: "/api/workspaces/members/remove",
  /** The owner makes another member an admin or an admin a member (POST), answered with the members as they then stand. */
  WORKSPACES_MEMBERS_ROLE: "/api/workspaces/members/role",
  /** The owner hands the workspace to an admin, becoming an admin (POST), answered with the members as they then stand. */
  WORKSPACES_TRANSFER: "/api/workspaces/transfer",
  /** The account leaves a workspace it does not own (POST). */
  WORKSPACES_LEAVE: "/api/workspaces/leave",
  /**
   * A workspace's pending invitations, to an owner or an admin (GET, the
   * workspace named in `workspace-invitation-wire.ts`'s
   * `WORKSPACE_INVITATIONS_QUERY`), or an invitation made (POST).
   */
  WORKSPACES_INVITATIONS: "/api/workspaces/invitations",
  /** A pending invitation canceled by an owner or an admin (POST), answered with those still pending. */
  WORKSPACES_INVITATIONS_CANCEL: "/api/workspaces/invitations/cancel",
  WORKSPACES_INVITATION_OFFER: "/api/workspaces/invitations/offer",
} as const;

/**
 * Where the hosted voice service answers: a Vercel Function of the same
 * service, reached at `HOSTED_VOICE_SERVICE_ORIGIN`, the socket form of the
 * service's own origin. The path is a WebSocket upgrade; one connection
 * carries one session, or one attachment to a session that stands.
 */
export const VOICE_SERVICE_PATH = {
  /** A signed-in Mac's WebRTC voice session; the account bearer travels on the handshake. */
  SESSIONS: "/api/voice/sessions",
} as const;

/** One of the account's automations: change it (PATCH) or delete it with its history (DELETE). */
export function automationPath(automationId: string): string {
  return `${HOSTED_SERVICE_PATH.AUTOMATIONS}/${encodeURIComponent(automationId)}`;
}

/** An automation's "Run now" (POST), answered with the run as it came out. */
export function automationRunPath(automationId: string): string {
  return `${automationPath(automationId)}/run`;
}

/**
 * An automation's webhook address (POST), called by the sender the developer
 * hands it to under the trigger's secret rather than an account bearer.
 */
export function automationWebhookPath(automationId: string): string {
  return `${automationPath(automationId)}/webhook`;
}

/** An automation's runs, newest first (GET). */
export function automationRunsPath(automationId: string): string {
  return `${automationPath(automationId)}/runs`;
}

/** One issue of a workspace the account is a member of: read it (GET) or change it (PATCH). */
export function issuePath(issueId: string): string {
  return `${HOSTED_SERVICE_PATH.ISSUES}/${encodeURIComponent(issueId)}`;
}

/** One task the caller owns: open it with its saved document (GET), change its name or its repository (PATCH), or delete it (DELETE). */
export function taskPath(taskId: string): string {
  return `${HOSTED_SERVICE_PATH.TASKS}/${encodeURIComponent(taskId)}`;
}

/** Every code Luke showed on one task, oldest first (GET). */
export function taskCodePath(taskId: string): string {
  return `${taskPath(taskId)}/code`;
}

/** One window of a file of one task's repository, as GitHub holds it now (GET): the path, and its first and last line; `raw=1` for its whole text uncut. */
export function taskFilePath(
  taskId: string,
  window: {
    readonly path: string;
    readonly firstLine: number;
    readonly lastLine: number;
    readonly raw?: boolean;
    readonly ref?: string;
  },
): string {
  const query = new URLSearchParams({
    path: window.path,
    first: String(window.firstLine),
    last: String(window.lastLine),
  });
  if (window.raw === true) query.set("raw", "1");
  if (window.ref !== undefined) query.set("ref", window.ref);
  return `${taskPath(taskId)}/file?${query}`;
}

/** One folder of one task's repository, as GitHub holds it now (GET): its path from the root, the root itself for an empty one, and `recursive=1` for everything under it. */
export function taskTreePath(
  taskId: string,
  folder: { readonly path: string; readonly recursive?: boolean },
): string {
  const path = `${taskPath(taskId)}/tree`;
  const query = new URLSearchParams();
  if (folder.path !== "") query.set("path", folder.path);
  if (folder.recursive === true) query.set("recursive", "1");
  return query.size === 0 ? path : `${path}?${query}`;
}

/** The skills a developer may choose of one task's repository, as GitHub holds it now (GET). */
export function taskSkillsPath(taskId: string): string {
  return `${taskPath(taskId)}/skills`;
}

/** A repository as a read with no plan names it: the workspace whose installation reaches it, and the repository, `owner/name`. */
export interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
}

/** One plan's pictures: one kept on the plan (POST). */
export function planAttachmentsPath(taskId: string): string {
  return `${taskPath(taskId)}/attachments`;
}

/**
 * One plan's comment threads: every thread past a cursor (GET), held open
 * while nothing changed as the inbox is, and one started (POST).
 * `plan-comment-wire.ts` declares both.
 */
export function planCommentsPath(planId: string, after?: string): string {
  const path = `${taskPath(planId)}/comments`;
  if (after === undefined) return path;
  const query = new URLSearchParams({ after });
  return `${path}?${query}`;
}

/** One comment thread of one plan: one thing done to it (POST). */
export function planCommentThreadPath(planId: string, threadId: string): string {
  return `${planCommentsPath(planId)}/${encodeURIComponent(threadId)}`;
}

/** One picture of one plan, as its bytes (GET). */
export function planAttachmentPath(taskId: string, attachmentId: string): string {
  return `${planAttachmentsPath(taskId)}/${encodeURIComponent(attachmentId)}`;
}

/** One plan's pages (GET): each page's newest version, the most recently written first. */
export function taskPagesPath(taskId: string): string {
  return `${taskPath(taskId)}/pages`;
}

/** One version of one page of one plan, with its HTML (GET). */
export function planPageVersionPath(taskId: string, pageId: string, version: number): string {
  return `${taskPagesPath(taskId)}/${encodeURIComponent(pageId)}/versions/${version}`;
}

/** One revision of the account's plan template: its text beside the text before it (GET). */
export function planTemplateRevisionPath(seq: number): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE_REVISIONS}/${seq}`;
}

/** One revision of the account's plan template put back as the template (POST). */
export function planTemplateRestorePath(seq: number): string {
  return `${planTemplateRevisionPath(seq)}/restore`;
}

/** One task's coding agents: list them with their status (GET), or start one (POST). `coding-agent-wire.ts` declares both. */
export function taskAgentsPath(taskId: string): string {
  return `${taskPath(taskId)}/agents`;
}

/**
 * One task's inbox: every item its coding agents posted for the developer,
 * past a cursor (GET), held open while nothing changed, as an agent's
 * transcript is. `inbox-wire.ts` declares the answer.
 */
export function taskInboxPath(taskId: string, after?: string): string {
  const path = `${taskPath(taskId)}/inbox`;
  if (after === undefined) return path;
  const query = new URLSearchParams({ after });
  return `${path}?${query}`;
}

/** One agent's inbox past a cursor (GET), held open while nothing changed as a task's is, an agent with no task as much as one on a task; the same answer as `taskInboxPath`'s read. */
export function agentInboxPath(agentId: string, after: string): string {
  const query = new URLSearchParams({ after });
  return `/api/agents/${encodeURIComponent(agentId)}/inbox?${query}`;
}

/** One item of a task's inbox, answered by the developer (POST) against the revision they saw; `inbox-wire.ts` declares the request and the answer. */
export function inboxItemPath(itemId: string): string {
  return `/api/inbox/${encodeURIComponent(itemId)}`;
}

/** One item's thread, a member's message written on it (POST), open or settled; `inbox-wire.ts` declares the request and the answer. */
export function inboxMessagesPath(itemId: string): string {
  return `${inboxItemPath(itemId)}/messages`;
}

/** One item's read state for the asking member: marked read (PUT), as opening it does, or unread (DELETE); `inbox-wire.ts` declares the answer. */
export function inboxItemReadPath(itemId: string): string {
  return `${inboxItemPath(itemId)}/read`;
}

/** One workspace's photo, as its bytes under its own media type (GET), served to the workspace's members alone. */
export function workspacePhotoPath(workspaceId: string): string {
  return `${HOSTED_SERVICE_PATH.WORKSPACES}/${encodeURIComponent(workspaceId)}/photo`;
}

/** One attachment of an inbox item, an image block's picture, as its bytes under its own media type (GET), served to the item's account alone. */
export function inboxAttachmentPath(itemId: string, attachmentId: string): string {
  return `${inboxItemPath(itemId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** One picture a tool answered an agent, as its bytes under its own media type (GET), served to whoever may read the agent; one of its workers' where `callId` names the delegation call that started the worker. */
export function agentPicturePath(agentId: string, pictureId: string, callId?: string): string {
  const agent = `/api/agents/${encodeURIComponent(agentId)}`;
  const owner = callId === undefined ? agent : `${agent}/subagents/${encodeURIComponent(callId)}`;
  return `${owner}/pictures/${encodeURIComponent(pictureId)}`;
}

/** One agent: its model and effort changed for its next step (PATCH), `models-wire.ts`'s choice as the body. */
export function agentPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}`;
}

/** Stops one agent (POST): its turn is cancelled and its sandbox stopped; anything it pushed stays. */
export function agentStopPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/stop`;
}

/** What one agent published (GET): the branch it pushed and the pull request from it, as GitHub holds them; `coding-agent-wire.ts` declares the answer. With a `number`, this and the Pull request tab's reads and changes below are of that pull request of the agent's repository instead. */
export function agentPullRequestPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/pull-request`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** One agent's changes (GET): the files of its pull request as GitHub holds them; `coding-agent-wire.ts` declares the answer. */
export function agentChangesPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/changes`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** One agent's pull request itself as its overview draws it (GET): its description, branches, mergeability, author, and the reviewers it asks for; `coding-agent-wire.ts` declares the answer. */
export function agentOverviewPullRequestPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/overview/pull-request`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** The checks on one agent's pull request's head as its overview draws them (GET); `coding-agent-wire.ts` declares the answer. */
export function agentOverviewChecksPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/overview/checks`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** One agent's pull request's conversation as its overview draws it (GET): its comments, reviews, threads, and where its reviewers stand; `coding-agent-wire.ts` declares the answer. */
export function agentOverviewConversationPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/overview/conversation`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** One image its pull request's overview names (GET), by the address GitHub's rendering spelled; answered as bytes of one of `github-image.ts`'s types. */
export function agentGitHubImagePath(agentId: string, src: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/github-image?${new URLSearchParams({ src })}`;
}

/** One change to an agent's pull request (POST), made on GitHub as the member who asks; `pull-request-write-wire.ts` declares the request and the answer. */
export function agentPullRequestActionPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/pull-request/action`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** Which of an agent's pull request's files the asking member marked viewed on GitHub (GET), read on their own sign-in; `pull-request-write-wire.ts` declares the answer. */
export function agentPullRequestViewedPath(agentId: string, number?: number): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/pull-request/viewed`;
  if (number === undefined) return path;
  const query = new URLSearchParams({ number: String(number) });
  return `${path}?${query}`;
}

/** What the reviewer and label pickers of an agent's Pull request tab offer: its repository's labels, collaborators, and teams. */
export function agentReviewOptionsPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/review-options`;
}

/** One agent's shells: list them and where its sandbox stands (GET), or start one (POST); `terminal-wire.ts` declares both. */
export function agentTerminalsPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/terminals`;
}

/** One of an agent's shells: named anew (PATCH) or ended (DELETE), each answering the shells as they stand after. */
export function agentTerminalPath(agentId: string, terminalId: string): string {
  return `${agentTerminalsPath(agentId)}/${encodeURIComponent(terminalId)}`;
}

/** Resumes one agent's stopped sandbox (POST), on the developer's click and nothing else. */
export function agentSandboxResumePath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/sandbox/resume`;
}
