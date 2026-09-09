import { AGENT_IDENTITY, agentIdentityFor, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { numberFromRow, textFromRow } from "../shared/local-sqlite.js";

/**
 * What one row of Superset's own host state says, and the readers that turn a
 * row into it. Nothing here opens a database or decides a roster.
 */

const SUPERSET_AGENT_PROVIDER = {
  claude: AGENT_IDENTITY.CLAUDE_CODE.id,
  codex: AGENT_IDENTITY.CODEX.id,
  copilot: AGENT_IDENTITY.COPILOT.id,
  cursor: AGENT_IDENTITY.CURSOR.id,
  // Superset binds Cursor's `agents` CLI under its own name, beside the id
  // it uses for the app's agents; both are Cursor sessions to Luke.
  "cursor-agent": AGENT_IDENTITY.CURSOR.id,
  gemini: AGENT_IDENTITY.GEMINI_CLI.id,
  grok: AGENT_IDENTITY.GROK_BUILD.id,
  opencode: AGENT_IDENTITY.OPENCODE.id,
} as const satisfies Readonly<Record<string, string>>;

const SUPERSET_WORKSPACE_LINK_PREFIX = "superset://v2-workspace/";

/**
 * The address of one workspace in Superset's own app — the same deep link
 * Superset's CLI fires for `workspaces open`, composed here from the observed
 * workspace id instead of asking the CLI to compose it, so opening stays what
 * every open is: an address handed to the operating system, reaching no
 * provider and needing no login.
 */
export function supersetWorkspaceLink(workspaceId: string): string {
  return `${SUPERSET_WORKSPACE_LINK_PREFIX}${workspaceId}`;
}

/** Superset's documented route to one terminal inside an observed workspace. */
export function supersetTerminalLink(workspaceId: string, terminalId: string): string {
  const link = new URL(supersetWorkspaceLink(workspaceId));
  link.searchParams.set("terminalId", terminalId);
  return link.toString();
}

/**
 * The address a press actually fires for a session behind a bound terminal.
 * Superset consumes a terminal focus once per request id — its own rows mint
 * a fresh `focusRequestId` for every press — so the roster's static address
 * focuses the terminal only while the workspace draws fresh, and a press on a
 * workspace already on screen lands nowhere. The nonce is the caller's,
 * minted at the moment of the press, and names nothing observed; every other
 * address, a terminal-less workspace link included, is handed on untouched.
 */
export function supersetPressedLink(link: string, focusRequestId: string): string {
  if (!link.startsWith(SUPERSET_WORKSPACE_LINK_PREFIX)) return link;
  const url = new URL(link);
  if (!url.searchParams.get("terminalId")) return link;
  url.searchParams.set("focusRequestId", focusRequestId);
  return url.toString();
}

/**
 * What one binding row says about the session it manages. Deliberately no
 * host identifier: the host state read here is this machine's own — the
 * directories under `host/` are named by organization, not by machine — so
 * every action on a bound terminal lands on the CLI's local default, and the
 * one id the CLI would take for `--host`, a machineId, appears nowhere in
 * this state.
 */
export interface SupersetSessionContext {
  providerId: string;
  providerSessionId: string;
  /**
   * The organization whose local host service recorded the session, which is
   * what the directory under `host/` is named by. It is not a host id: every
   * database under that directory belongs to this machine.
   */
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  /**
   * The bound terminal a message lands in. A chatless workspace row has none
   * — there is nothing there to message — and neither does a chat whose every
   * binding Superset has ended, so every action that needs one must check rather
   * than assume.
   */
  terminalId?: string;
  /**
   * When Superset last recorded an event on the binding behind this context,
   * carried so a chat with several bindings resolves to its freshest one.
   * Absent on chatless rows and on databases from before bindings kept it.
   */
  bindingLastEventAt?: number;
  updatedAt: number;
  projectName?: string;
  branch?: string;
  pullRequestUrl?: string;
  spawnableAgents: readonly string[];
  /**
   * The worktree a directory-matched chat was anchored by, carried only on
   * such matches so a fresh snapshot can re-anchor them against its own read.
   */
  worktreePath?: string;
}

export function contextFromRow(
  organizationId: string,
  row: WireRecord,
  spawnableAgents: readonly string[],
): SupersetSessionContext | undefined {
  const agentId = textFromRow(row, "agent_id");
  const providerId = agentIdentityFor(SUPERSET_AGENT_PROVIDER, agentId);
  const providerSessionId = textFromRow(row, "agent_session_id");
  const workspaceId = textFromRow(row, "workspace_id");
  const workspaceName = textFromRow(row, "workspace_name");
  const terminalId = textFromRow(row, "terminal_id");
  const updatedAt = numberFromRow(row, "updated_at");
  if (
    !agentId ||
    !providerId ||
    !providerSessionId ||
    !workspaceId ||
    !workspaceName ||
    !terminalId ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  const projectName = textFromRow(row, "project_name");
  const branch = textFromRow(row, "branch");
  const pullRequestUrl = textFromRow(row, "pull_request_url");
  const context: SupersetSessionContext = {
    providerId,
    providerSessionId,
    organizationId,
    workspaceId,
    workspaceName,
    updatedAt,
    spawnableAgents,
  };
  // A binding Superset has ended no longer identifies a live terminal — the
  // chat resumed into another terminal, or the terminal is gone — so the row
  // keeps its workspace identity and offers no terminal to act through.
  if (numberFromRow(row, "binding_ended_at") === undefined) context.terminalId = terminalId;
  const bindingLastEventAt = numberFromRow(row, "binding_last_event_at");
  if (bindingLastEventAt !== undefined) context.bindingLastEventAt = bindingLastEventAt;
  if (projectName) context.projectName = projectName;
  if (branch) context.branch = branch;
  if (pullRequestUrl) context.pullRequestUrl = pullRequestUrl;
  return context;
}

/**
 * Whether a binding read later should displace the one already held for the
 * same chat. A live terminal outranks an ended one regardless of the order
 * the database returned the rows in, the freshest binding event breaks a tie
 * between two of the same standing, and the workspace's own clock decides
 * only between rows carrying no binding history — a chatless row, or a
 * database from before the lifecycle columns.
 */
export function bindingOutranks(
  candidate: SupersetSessionContext,
  held: SupersetSessionContext,
): boolean {
  const candidateLive = candidate.terminalId !== undefined;
  if (candidateLive !== (held.terminalId !== undefined)) return candidateLive;
  const candidateEvent = candidate.bindingLastEventAt ?? 0;
  const heldEvent = held.bindingLastEventAt ?? 0;
  if (candidateEvent !== heldEvent) return candidateEvent > heldEvent;
  return held.updatedAt < candidate.updatedAt;
}

/**
 * A chatless workspace as its own row's context, keyed under the Superset
 * workspace provider by the workspace's own id — the same shape a bound
 * chat's context has, minus the terminal there is nothing to message through.
 */
export function contextFromWorkspaceRow(
  organizationId: string,
  row: WireRecord,
  spawnableAgents: readonly string[],
): SupersetSessionContext | undefined {
  const workspaceId = textFromRow(row, "workspace_id");
  const workspaceName = textFromRow(row, "workspace_name");
  const updatedAt = numberFromRow(row, "updated_at");
  if (!workspaceId || !workspaceName || updatedAt === undefined) return undefined;
  const projectName = textFromRow(row, "project_name");
  const branch = textFromRow(row, "branch");
  const pullRequestUrl = textFromRow(row, "pull_request_url");
  const context: SupersetSessionContext = {
    providerId: SUPERSET_WORKSPACE_PROVIDER_ID,
    providerSessionId: workspaceId,
    organizationId,
    workspaceId,
    workspaceName,
    updatedAt,
    spawnableAgents,
  };
  if (projectName) context.projectName = projectName;
  if (branch) context.branch = branch;
  if (pullRequestUrl) context.pullRequestUrl = pullRequestUrl;
  return context;
}

/**
 * A workspace offered for matching by its worktree path: the same
 * workspace-shaped, terminal-less context a chatless row carries, keyed by
 * the directory a chat Superset recorded no session id for would be
 * running in.
 */
export interface SupersetWorktreeContext {
  worktreePath: string;
  context: SupersetSessionContext;
}

export function worktreeContextFromRow(
  organizationId: string,
  row: WireRecord,
  spawnableAgents: readonly string[],
): SupersetWorktreeContext | undefined {
  const worktreePath = textFromRow(row, "worktree_path");
  const context = contextFromWorkspaceRow(organizationId, row, spawnableAgents);
  return worktreePath && context ? { worktreePath, context } : undefined;
}
