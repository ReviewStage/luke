import { GITHUB_REPOSITORIES_QUERY } from "./github-repositories-wire.js";
import type { IntegrationProvider } from "./integration-wire.js";

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
   * The Markdown the account's new plans start from: read it (GET), or keep
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
   * Where Vercel Connect returns the browser from an integration's sign-in
   * (GET), with the sign-in's own state, which names the provider too: the
   * route settles it and sends the browser on to the landing page
   * `integration-wire.ts` names.
   */
  ACCOUNT_INTEGRATIONS_CONNECTED: "/api/account/integrations/connected",
  /**
   * What waits on the developer across the account's plans: every open
   * inbox item, past a cursor (GET), held open while nothing changed, as a
   * plan's inbox is. `account-inbox-wire.ts` declares the answer.
   */
  INBOX: "/api/inbox",
  /**
   * A workspace's agents, on a plan or with none, newest started first and
   * the archived ones left out, narrowed to one repository where the query
   * names one (GET), what an automation's Same agent is chosen from; the
   * plan list's answer (`coding-agent-wire.ts`).
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
   * The account's automations: list them, newest first, or one plan's where
   * `planId` names it (GET), or make one (POST). `automation-wire.ts`
   * declares the bodies.
   */
  AUTOMATIONS: "/api/automations",
  /** The models a coding agent may run on, as the service offers them now (GET). `models-wire.ts` declares the answer. */
  MODELS: "/api/models",
  /**
   * The account's named feature plans: list them, newest started first
   * (GET), or start one (POST) with its name and, where one is chosen, the
   * GitHub repository it is about. `plan-wire.ts` declares both.
   */
  PLANS: "/api/plans",
  /**
   * The repositories the account pinned in the sidebar: read them, newest
   * pinned first (GET), or pin or unpin one (PUT), answered with them all as
   * they then stand. `plan-wire.ts` declares both.
   */
  REPOSITORY_PINS: "/api/repository-pins",
  /**
   * The repositories the signed-in account reaches through the Luke GitHub
   * App, most recently updated first (GET), with whether the App is
   * installed anywhere for them and where to install it.
   * `github-repositories-wire.ts` declares the answer, and the
   * `GITHUB_REPOSITORIES_QUERY` that names a workspace to list for.
   */
  GITHUB_REPOSITORIES: "/api/github/repositories",
  /**
   * A pull request's head as GitHub holds it now, with a contents-read token
   * for its repository alone (POST), which the Mac fetches the pull request
   * with to run it locally. `pr-fetch-wire.ts` declares the request and the
   * answer; the answer is the host's alone.
   */
  GITHUB_PR_FETCH: "/api/github/pr-fetch",
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

/** Begins a browser sign-in to one provider for the account (POST), answering the address the browser opens. */
export function integrationConnectPath(provider: IntegrationProvider): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/${encodeURIComponent(provider)}/connect`;
}

/** The tools one provider's server offers the account's agents (GET), read from the server now or shortly before. */
export function integrationToolsPath(provider: IntegrationProvider): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/${encodeURIComponent(provider)}/tools`;
}

/** Ends the account's sign-in to one provider under way (POST), and nothing else: no grant is revoked. */
export function integrationCancelPath(provider: IntegrationProvider): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/${encodeURIComponent(provider)}/cancel`;
}

/** Ends the account's connection to one provider (POST); what agents already did there stands. */
export function integrationDisconnectPath(provider: IntegrationProvider): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/${encodeURIComponent(provider)}/disconnect`;
}

/** Names one of the account's accounts at a provider (POST), the label it then carries. */
export function integrationRenamePath(provider: IntegrationProvider): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/${encodeURIComponent(provider)}/rename`;
}

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

/** One plan the caller owns: open it with its saved document (GET), change its name or its repository (PATCH), or delete it (DELETE). */
export function planPath(planId: string): string {
  return `${HOSTED_SERVICE_PATH.PLANS}/${encodeURIComponent(planId)}`;
}

/** One plan's whiteboard: read it with Luke's latest drawing (GET), or write its scene whole (PUT). */
export function planBoardPath(planId: string): string {
  return `${planPath(planId)}/board`;
}

/** The developer's edit of one plan's document (POST). */
export function planEditPath(planId: string): string {
  return `${planPath(planId)}/edit`;
}

/** What was said on one plan's calls (GET). */
export function planTranscriptPath(planId: string): string {
  return `${planPath(planId)}/transcript`;
}

/**
 * One plan's work (GET): a page of the planning turns of its calls, the
 * newest of all or, with `before`, the newest queued before that turn, and
 * on the newest page every code Luke showed on it.
 */
export function planWorkPath(planId: string, before?: string): string {
  const path = `${planPath(planId)}/work`;
  if (before === undefined) return path;
  const query = new URLSearchParams({ before });
  return `${path}?${query}`;
}

/**
 * One plan's planning conversation as a coding agent's transcript is read
 * (GET), the same answer as `agentMessagesPath`'s read: past a cursor, held
 * open while a turn runs; with no cursor, its newest turns; with `before`,
 * the turns queued before that one.
 */
export function planMessagesPath(
  planId: string,
  page: { after?: string; before?: string },
): string {
  const path = `${planPath(planId)}/messages`;
  const query = new URLSearchParams({
    ...(page.after === undefined ? undefined : { after: page.after }),
    ...(page.before === undefined ? undefined : { before: page.before }),
  });
  return query.size === 0 ? path : `${path}?${query}`;
}

/** One planning worker's transcript past a cursor (GET), under the plan and the call that started it, held open while the worker runs; the same answer as `planMessagesPath`'s read. */
export function planSubagentMessagesPath(planId: string, callId: string, after: string): string {
  const query = new URLSearchParams({ after });
  return `${planPath(planId)}/subagents/${encodeURIComponent(callId)}/messages?${query}`;
}

/** Every code Luke showed on one plan, oldest first (GET). */
export function planCodePath(planId: string): string {
  return `${planPath(planId)}/code`;
}

/** One window of a file of one plan's repository, as GitHub holds it now (GET): the path, and its first and last line; `raw=1` for its whole text uncut. */
export function planFilePath(
  planId: string,
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
  return `${planPath(planId)}/file?${query}`;
}

/** One folder of one plan's repository, as GitHub holds it now (GET): its path from the root, the root itself for an empty one, and `recursive=1` for everything under it. */
export function planTreePath(
  planId: string,
  folder: { readonly path: string; readonly recursive?: boolean },
): string {
  const path = `${planPath(planId)}/tree`;
  const query = new URLSearchParams();
  if (folder.path !== "") query.set("path", folder.path);
  if (folder.recursive === true) query.set("recursive", "1");
  return query.size === 0 ? path : `${path}?${query}`;
}

/** The skills a developer may choose of one plan's repository, as GitHub holds it now (GET). */
export function planSkillsPath(planId: string): string {
  return `${planPath(planId)}/skills`;
}

/** A repository as a read with no plan names it: the workspace whose installation reaches it, and the repository, `owner/name`. */
export interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
}

/** The query naming a repository place, which every read of one repository by its workspace opens with. */
function repositoryPlaceQuery(place: RepositoryPlace): URLSearchParams {
  return new URLSearchParams({
    [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: place.workspaceId,
    [GITHUB_REPOSITORIES_QUERY.REPOSITORY]: place.repository,
  });
}

/** One folder of a repository a workspace reaches, as GitHub holds it now (GET), queried as `planTreePath`'s folder is. */
export function repositoryTreePath(
  place: RepositoryPlace,
  folder: { readonly path: string; readonly recursive?: boolean },
): string {
  const query = repositoryPlaceQuery(place);
  if (folder.path !== "") query.set("path", folder.path);
  if (folder.recursive === true) query.set("recursive", "1");
  return `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE}?${query}`;
}

/** The skills a developer may choose of a repository a workspace reaches, as GitHub holds it now (GET). */
export function repositorySkillsPath(place: RepositoryPlace): string {
  return `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS}?${repositoryPlaceQuery(place)}`;
}

/** One pull request of a repository a workspace reaches, by its number, as GitHub holds it now (GET). */
export function repositoryPullRequestPath(place: RepositoryPlace, number: number): string {
  const query = repositoryPlaceQuery(place);
  query.set(GITHUB_REPOSITORIES_QUERY.NUMBER, String(number));
  return `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST}?${query}`;
}

/** One plan's history (GET): a page of its revisions, the newest of all or, with `before`, the newest before that revision. */
export function planRevisionsPath(planId: string, before?: number): string {
  const path = `${planPath(planId)}/revisions`;
  if (before === undefined) return path;
  const query = new URLSearchParams({ before: String(before) });
  return `${path}?${query}`;
}

/** One revision of one plan: its content beside the content before it (GET). */
export function planRevisionPath(planId: string, seq: number): string {
  return `${planRevisionsPath(planId)}/${seq}`;
}

/** One revision of one plan put back as its content (POST). */
export function planRestorePath(planId: string, seq: number): string {
  return `${planRevisionPath(planId, seq)}/restore`;
}

/** One plan's pictures: one kept on the plan (POST). */
export function planAttachmentsPath(planId: string): string {
  return `${planPath(planId)}/attachments`;
}

/** One picture of one plan, as its bytes (GET). */
export function planAttachmentPath(planId: string, attachmentId: string): string {
  return `${planAttachmentsPath(planId)}/${encodeURIComponent(attachmentId)}`;
}

/** One plan's pages (GET): each page's newest version, the most recently written first. */
export function planPagesPath(planId: string): string {
  return `${planPath(planId)}/pages`;
}

/** One version of one page of one plan, with its HTML (GET). */
export function planPageVersionPath(planId: string, pageId: string, version: number): string {
  return `${planPagesPath(planId)}/${encodeURIComponent(pageId)}/versions/${version}`;
}

/** One revision of the account's plan template: its text beside the text before it (GET). */
export function planTemplateRevisionPath(seq: number): string {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE_REVISIONS}/${seq}`;
}

/** One revision of the account's plan template put back as the template (POST). */
export function planTemplateRestorePath(seq: number): string {
  return `${planTemplateRevisionPath(seq)}/restore`;
}

/** One plan's coding agents: list them with their status (GET), or start one (POST). `coding-agent-wire.ts` declares both. */
export function planAgentsPath(planId: string): string {
  return `${planPath(planId)}/agents`;
}

/**
 * One plan's inbox: every item its coding agents posted for the developer,
 * past a cursor (GET), held open while nothing changed, as an agent's
 * transcript is. `inbox-wire.ts` declares the answer.
 */
export function planInboxPath(planId: string, after?: string): string {
  const path = `${planPath(planId)}/inbox`;
  if (after === undefined) return path;
  const query = new URLSearchParams({ after });
  return `${path}?${query}`;
}

/** One agent's inbox past a cursor (GET), held open while nothing changed as a plan's is, an agent with no plan as much as one on a plan; the same answer as `planInboxPath`'s read. */
export function agentInboxPath(agentId: string, after: string): string {
  const query = new URLSearchParams({ after });
  return `/api/agents/${encodeURIComponent(agentId)}/inbox?${query}`;
}

/** One item of a plan's inbox, answered by the developer (POST) against the revision they saw; `inbox-wire.ts` declares the request and the answer. */
export function inboxItemPath(itemId: string): string {
  return `/api/inbox/${encodeURIComponent(itemId)}`;
}

/** One workspace's photo, as its bytes under its own media type (GET), served to the workspace's members alone. */
export function workspacePhotoPath(workspaceId: string): string {
  return `${HOSTED_SERVICE_PATH.WORKSPACES}/${encodeURIComponent(workspaceId)}/photo`;
}

/** One attachment of an inbox item, an image block's picture, as its bytes under its own media type (GET), served to the item's account alone. */
export function inboxAttachmentPath(itemId: string, attachmentId: string): string {
  return `${inboxItemPath(itemId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * One agent's messages: its transcript past a cursor (GET), held open while
 * the agent runs, or, with no cursor, a message sent to it (POST).
 * `coding-agent-wire.ts` declares the answer and the request.
 */
export function agentMessagesPath(agentId: string, after?: string): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/messages`;
  if (after === undefined) return path;
  const query = new URLSearchParams({ after });
  return `${path}?${query}`;
}

/** One worker's transcript past a cursor (GET), under the agent and the delegation call that started it, held open while the worker runs as the agent's own is; the same answer as `agentMessagesPath`'s read. */
export function agentSubagentMessagesPath(agentId: string, callId: string, after: string): string {
  const query = new URLSearchParams({ after });
  return `/api/agents/${encodeURIComponent(agentId)}/subagents/${encodeURIComponent(callId)}/messages?${query}`;
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

/** What one agent published (GET): the branch it pushed and the pull request from it, as GitHub holds them; `coding-agent-wire.ts` declares the answer. */
export function agentPullRequestPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/pull-request`;
}

/** One agent's changes (GET): the files of its pull request as GitHub holds them; `coding-agent-wire.ts` declares the answer. */
export function agentChangesPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/changes`;
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
