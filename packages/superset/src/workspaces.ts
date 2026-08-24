import path from "node:path";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  readDirectory,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "@sidecar/providers";
import {
  AGENT_IDENTITY,
  agentIdentityFor,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "@sidecar/session";
import { type WireRecord, wireRecord } from "@sidecar/wire";
import { SUPERSET_CONTROL_ID } from "./cli.js";

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
 * Superset keeps every binding a chat ever had: restarting the app resumes
 * each terminal under a fresh id, ending the old binding (`end_reason`
 * "resumed") beside the live row it records for the new terminal. Both rows
 * name the same agent session, so each binding's own lifecycle rides along
 * and the snapshot chooses between them — a link or a message aimed at the
 * ended terminal would be silently refused by Superset's own liveness check.
 */
const SUPERSET_WORKSPACE_QUERY = `
  SELECT
    bindings.agent_id,
    bindings.agent_session_id,
    bindings.terminal_id,
    bindings.ended_at AS binding_ended_at,
    bindings.last_event_at AS binding_last_event_at,
    workspaces.id AS workspace_id,
    workspaces.name AS workspace_name,
    workspaces.branch,
    workspaces.updated_at,
    projects.name AS project_name,
    pull_requests.url AS pull_request_url
  FROM terminal_agent_bindings AS bindings
  JOIN workspaces ON workspaces.id = bindings.workspace_id
  LEFT JOIN projects ON projects.id = workspaces.project_id
  LEFT JOIN pull_requests ON pull_requests.id = workspaces.pull_request_id
  WHERE bindings.agent_session_id IS NOT NULL
`;

/**
 * The same read for a host database from before bindings carried their
 * lifecycle columns. Such a database still holds the chats, it just cannot
 * say which bindings have ended, so its rows are read as the live ones they
 * were under that schema.
 */
const SUPERSET_LEGACY_WORKSPACE_QUERY = `
  SELECT
    bindings.agent_id,
    bindings.agent_session_id,
    bindings.terminal_id,
    workspaces.id AS workspace_id,
    workspaces.name AS workspace_name,
    workspaces.branch,
    workspaces.updated_at,
    projects.name AS project_name,
    pull_requests.url AS pull_request_url
  FROM terminal_agent_bindings AS bindings
  JOIN workspaces ON workspaces.id = bindings.workspace_id
  LEFT JOIN projects ON projects.id = workspaces.project_id
  LEFT JOIN pull_requests ON pull_requests.id = workspaces.pull_request_id
  WHERE bindings.agent_session_id IS NOT NULL
`;

const SUPERSET_AGENT_QUERY = `
  SELECT preset_id
  FROM host_agent_configs
  WHERE preset_id IS NOT NULL
  ORDER BY display_order, preset_id
`;

/**
 * The workspaces standing with no agent terminal at all, which no chat row
 * will ever carry. Three exclusions bound it: the main checkout, whose
 * deletion would take the user's own working copy rather than clean up after
 * an agent — only the worktree shape Superset makes for agents qualifies; a
 * workspace Superset already archived, which its own app has filed away; and
 * any workspace with a terminal binding, mapped agent or not — its chat's own
 * row carries the workspace where Luke can see one, and where Luke cannot,
 * an unmappable agent could be mid-turn invisibly, so only a workspace with
 * no agent terminal is settled by construction.
 */
const SUPERSET_CHATLESS_WORKSPACE_QUERY = `
  SELECT
    workspaces.id AS workspace_id,
    workspaces.name AS workspace_name,
    workspaces.branch,
    workspaces.updated_at,
    projects.name AS project_name,
    pull_requests.url AS pull_request_url
  FROM workspaces
  LEFT JOIN projects ON projects.id = workspaces.project_id
  LEFT JOIN pull_requests ON pull_requests.id = workspaces.pull_request_id
  WHERE workspaces.type = 'worktree'
    AND workspaces.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM terminal_agent_bindings
      WHERE terminal_agent_bindings.workspace_id = workspaces.id
    )
`;

/**
 * Every worktree a chat could be running in without Superset having recorded
 * which chat it is. Superset's own events for some agents (OpenCode today)
 * never carry the agent's session id, so the binding row says only that an
 * agent of that kind ran somewhere in the workspace. The worktree path is the
 * one thing both sides wrote down independently — Superset when it made the
 * worktree, the agent's own record of the directory it ran in — so it is what
 * a chat with no recorded id is matched by. Only the worktree shape
 * qualifies: a main checkout is the user's own working copy, where an agent
 * run by hand would be branded Superset's by nothing more than sharing the
 * folder.
 */
const SUPERSET_WORKTREE_DIRECTORY_QUERY = `
  SELECT
    workspaces.id AS workspace_id,
    workspaces.name AS workspace_name,
    workspaces.worktree_path,
    workspaces.branch,
    workspaces.updated_at,
    projects.name AS project_name,
    pull_requests.url AS pull_request_url
  FROM workspaces
  LEFT JOIN projects ON projects.id = workspaces.project_id
  LEFT JOIN pull_requests ON pull_requests.id = workspaces.pull_request_id
  WHERE workspaces.type = 'worktree'
    AND workspaces.archived_at IS NULL
`;

/**
 * What one binding row says about the session it manages. Deliberately no
 * host identifier: the host state read here is this machine's own — the
 * directories under `host/` are named by organization, not by machine — so
 * every act on a bound terminal lands on the CLI's local default, and the
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
   * binding Superset has ended, so every act that needs one must check rather
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

/**
 * An act reaches Superset through the CLI's own login, which serves one
 * organization at a time, so only sessions the active organization's host
 * service recorded can be acted on at all.
 */
function actableInOrganization(
  context: SupersetSessionContext,
  activeOrganizationId: string | undefined,
): boolean {
  return activeOrganizationId !== undefined && context.organizationId === activeOrganizationId;
}

function contextFromRow(
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
function bindingOutranks(candidate: SupersetSessionContext, held: SupersetSessionContext): boolean {
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
function contextFromWorkspaceRow(
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

function worktreeContextFromRow(
  organizationId: string,
  row: WireRecord,
  spawnableAgents: readonly string[],
): SupersetWorktreeContext | undefined {
  const worktreePath = textFromRow(row, "worktree_path");
  const context = contextFromWorkspaceRow(organizationId, row, spawnableAgents);
  return worktreePath && context ? { worktreePath, context } : undefined;
}

export class SupersetWorkspaceSnapshot {
  readonly #sessions = new Map<string, Map<string, SupersetSessionContext>>();
  readonly #worktreesByPath = new Map<string, SupersetSessionContext>();
  /**
   * The chats matched by worktree path, remembered under the chat's own
   * identity so the act router resolves an act against the same context its
   * advertisement rode. Every enrich pass rewrites a chat's entry from its
   * latest observation — confirming, moving, or dropping it — and a fresh
   * snapshot adopts its predecessor's entries so the acts a drawn row still
   * advertises keep resolving between the snapshot standing and that pass.
   */
  readonly #directoryMatches = new Map<string, Map<string, SupersetSessionContext>>();

  constructor(
    contexts: readonly SupersetSessionContext[],
    worktrees: readonly SupersetWorktreeContext[] = [],
  ) {
    for (const context of contexts) {
      const provider = this.#sessions.get(context.providerId) ?? new Map();
      const existing = provider.get(context.providerSessionId);
      if (!existing || bindingOutranks(context, existing)) {
        provider.set(context.providerSessionId, context);
      }
      this.#sessions.set(context.providerId, provider);
    }
    for (const worktree of worktrees) {
      const existing = this.#worktreesByPath.get(worktree.worktreePath);
      if (!existing || existing.updatedAt < worktree.context.updatedAt) {
        this.#worktreesByPath.set(worktree.worktreePath, worktree.context);
      }
    }
  }

  context(providerId: string, providerSessionId: string): SupersetSessionContext | undefined {
    return (
      this.#sessions.get(providerId)?.get(providerSessionId) ??
      this.#directoryMatches.get(providerId)?.get(providerSessionId)
    );
  }

  /**
   * The recorded context for a chat, or the worktree standing in for one
   * Superset never recorded: a local chat whose provider wrote down the same
   * directory Superset made a live worktree at is that workspace's chat, even
   * though the binding row carries no session id to say which. The match
   * earns everything the workspace's own identity carries — the grouping and
   * the workspace-scoped acts — but no terminal, because no observed binding
   * identifies the exact terminal this chat is behind, and a message must
   * land on the chat it was typed at.
   */
  #contextFor(
    providerId: string,
    observation: ProviderSessionObservation,
  ): SupersetSessionContext | undefined {
    const recorded = this.#sessions.get(providerId)?.get(observation.providerSessionId);
    if (recorded) return recorded;
    // The observation is the match's whole authority, so it is re-decided
    // here from the observation alone, never read back from the remembered
    // entry: a chat that moved directories or stopped reporting one loses
    // its entry on the same pass.
    const worktree =
      observation.location !== SESSION_LOCATION.CLOUD && observation.directory
        ? this.#worktreesByPath.get(observation.directory)
        : undefined;
    if (!worktree) {
      this.#directoryMatches.get(providerId)?.delete(observation.providerSessionId);
      return undefined;
    }
    return this.#rememberDirectoryMatch(
      providerId,
      observation.providerSessionId,
      worktree,
      observation.directory ?? "",
    );
  }

  #rememberDirectoryMatch(
    providerId: string,
    providerSessionId: string,
    worktree: SupersetSessionContext,
    worktreePath: string,
  ): SupersetSessionContext {
    const context: SupersetSessionContext = {
      ...worktree,
      providerId,
      providerSessionId,
      worktreePath,
    };
    const matches = this.#directoryMatches.get(providerId) ?? new Map();
    matches.set(providerSessionId, context);
    this.#directoryMatches.set(providerId, matches);
    return context;
  }

  /**
   * Carries the previous snapshot's directory matches into this one, each
   * re-anchored to this snapshot's own read: an entry survives only while
   * the same worktree still stands, and is rebuilt from that worktree's
   * fresh fields. Without this, an act pressed between this snapshot
   * standing and the next enrich pass would find nothing behind the
   * advertisement the drawn row still carries; the workspace-scoped acts an
   * adopted entry resolves stay honest either way, because they act on the
   * workspace whose worktree was just re-read, not on the chat.
   */
  adoptDirectoryMatches(previous: SupersetWorkspaceSnapshot): void {
    for (const [providerId, matches] of previous.#directoryMatches) {
      for (const [providerSessionId, match] of matches) {
        const worktree = match.worktreePath
          ? this.#worktreesByPath.get(match.worktreePath)
          : undefined;
        if (!worktree || !match.worktreePath) continue;
        this.#rememberDirectoryMatch(providerId, providerSessionId, worktree, match.worktreePath);
      }
    }
  }

  actableContext(
    providerId: string,
    providerSessionId: string,
    activeOrganizationId: string | undefined,
  ): SupersetSessionContext | undefined {
    const context = this.context(providerId, providerSessionId);
    return context && actableInOrganization(context, activeOrganizationId) ? context : undefined;
  }

  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
    activeOrganizationId?: string,
  ): readonly ProviderSessionObservation[] {
    return observations.map((observation) => {
      const context = this.#contextFor(providerId, observation);
      if (!context) return observation;
      const detail = { ...observation.detail };
      if (context.projectName) detail.repository = context.projectName;
      if (context.branch) detail.branch = context.branch;
      if (context.pullRequestUrl) detail.change = context.pullRequestUrl;
      const applicationLink = context.terminalId
        ? supersetTerminalLink(context.workspaceId, context.terminalId)
        : supersetWorkspaceLink(context.workspaceId);
      // The app that wrote the host state is the scheme's handler, so the
      // address stands without the CLI login the acts below wait for. The
      // association carries the exact terminal address; which mark a grouped
      // row's press follows is the session normalization's call — the
      // workspace's manager leads the marks and the press follows the first
      // linked one — so the fill here only covers a row nothing else
      // addressed.
      if (!detail.link) detail.link = applicationLink;
      const applications = observation.applications?.some(
        (application) => application.id === SESSION_APPLICATION_ID.SUPERSET,
      )
        ? observation.applications
        : [
            ...(observation.applications ?? []),
            {
              id: SESSION_APPLICATION_ID.SUPERSET,
              displayName: "Superset",
              scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
              link: applicationLink,
            },
          ];
      const workspace = {
        providerWorkspaceId: context.workspaceId,
        name: context.workspaceName,
        scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
        managerName: "Superset",
      };
      if (!actableInOrganization(context, activeOrganizationId)) {
        return { ...observation, detail, applications, workspace };
      }
      // Deleting the workspace is unrecoverable and takes every sibling
      // chat's terminal with it, so it is offered only on a row positively
      // seen settled — never one still working, or one whose state could not
      // be read. The workspace id rides as the control's target, which is
      // both what the press deletes and what seats the control once on a
      // tray's own header when several chats share the workspace.
      const settled =
        observation.status !== SESSION_STATUS.WORKING &&
        observation.status !== SESSION_STATUS.UNKNOWN;
      const controls = [
        ...(observation.controls ?? []),
        ...(settled
          ? [
              {
                id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
                label: "Delete workspace",
                target: context.workspaceId,
              },
            ]
          : []),
      ];
      const enriched: ProviderSessionObservation = {
        ...observation,
        detail,
        applications,
        workspace,
        // Superset documents renaming any workspace it manages, so the
        // target rides the advertisement the way the spawn target does.
        renameTarget: context.workspaceId,
        controls,
      };
      // Only a bound terminal gives a message somewhere to land; a chatless
      // workspace row stays unmessageable rather than improvising a way in.
      if (context.terminalId) enriched.canReceiveMessage = true;
      if (context.spawnableAgents.length > 0) {
        enriched.spawnableAgents = context.spawnableAgents;
        enriched.spawnTarget = context.workspaceId;
      }
      return enriched;
    });
  }

  /**
   * The chatless workspaces as rows of the Superset workspace provider,
   * decorated here — beside `enrich`, from the same observed state — rather
   * than by a registry transform, so an act path's plain refresh commits the
   * same shape the observation loop does. Each row stands (`standing`): it is
   * re-reported for as long as the workspace exists and dropped the pass
   * after it is gone, so retention never ages it out however long the
   * workspace has sat idle — sitting idle is exactly what earns it a row.
   * Complete is the vocabulary's settled state, and a workspace with no agent
   * terminal is settled by construction — the same gate the delete control's
   * advertisement stands on — so the acts ride only while the CLI's login
   * serves the recording organization, exactly as they do on a chat row.
   */
  workspaceRowObservations(activeOrganizationId?: string): readonly ProviderSessionObservation[] {
    const contexts = [...(this.#sessions.get(SUPERSET_WORKSPACE_PROVIDER_ID)?.values() ?? [])].sort(
      (first, second) =>
        second.updatedAt - first.updatedAt || first.workspaceId.localeCompare(second.workspaceId),
    );
    return contexts.map((context) => {
      const link = supersetWorkspaceLink(context.workspaceId);
      const detail: ProviderSessionObservation["detail"] = { link };
      if (context.projectName) detail.repository = context.projectName;
      if (context.branch) detail.branch = context.branch;
      if (context.pullRequestUrl) detail.change = context.pullRequestUrl;
      const observation: ProviderSessionObservation = {
        providerSessionId: context.workspaceId,
        title: context.workspaceName,
        status: SESSION_STATUS.COMPLETE,
        observedAt: context.updatedAt,
        standing: true,
        detail,
        applications: [
          {
            id: SESSION_APPLICATION_ID.SUPERSET,
            displayName: "Superset",
            scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
            link,
          },
        ],
        workspace: {
          providerWorkspaceId: context.workspaceId,
          name: context.workspaceName,
          scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
          managerName: "Superset",
        },
      };
      if (!actableInOrganization(context, activeOrganizationId)) return observation;
      observation.controls = [
        {
          id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
          label: "Delete workspace",
          target: context.workspaceId,
        },
      ];
      observation.renameTarget = context.workspaceId;
      if (context.spawnableAgents.length > 0) {
        observation.spawnableAgents = context.spawnableAgents;
        observation.spawnTarget = context.workspaceId;
      }
      return observation;
    });
  }
}

export interface SupersetWorkspaceReaderOptions {
  homeDirectory: string;
  sqlite?: SqliteModuleLoader;
}

export class SupersetWorkspaceReader {
  readonly #homeDirectory: string;
  readonly #sqlite: SqliteModuleLoader;

  constructor(options: SupersetWorkspaceReaderOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
  }

  async read(): Promise<SupersetWorkspaceSnapshot> {
    const hostDirectory = path.join(this.#homeDirectory, "host");
    const entries = await readDirectory(hostDirectory);
    const organizations = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          this.#readOrganization(entry.name, path.join(hostDirectory, entry.name, "host.db")),
        ),
    );
    return new SupersetWorkspaceSnapshot(
      organizations.flatMap((organization) => organization.contexts),
      organizations.flatMap((organization) => organization.worktrees),
    );
  }

  async #readOrganization(
    organizationId: string,
    databasePath: string,
  ): Promise<{
    contexts: readonly SupersetSessionContext[];
    worktrees: readonly SupersetWorktreeContext[];
  }> {
    const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
    if (!database) return { contexts: [], worktrees: [] };
    try {
      const spawnableAgents = database
        .prepare(SUPERSET_AGENT_QUERY)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const presetId = textFromRow(row, "preset_id");
          return presetId ? [presetId] : [];
        });
      const bound = this.#boundChats(database, organizationId, spawnableAgents);
      return {
        contexts: [
          ...bound,
          ...this.#chatlessWorkspaces(database, organizationId, spawnableAgents),
        ],
        worktrees: this.#worktreeDirectories(database, organizationId, spawnableAgents),
      };
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error))
        return { contexts: [], worktrees: [] };
      throw error;
    } finally {
      database.close();
    }
  }

  /**
   * Read behind a fallback rather than a guard: a host database from a
   * Superset before bindings carried their lifecycle columns still holds the
   * chats, so losing the columns falls back to reading every binding as the
   * live one it was under that schema, never to losing the chats.
   */
  #boundChats(
    database: SqliteDatabase,
    organizationId: string,
    spawnableAgents: readonly string[],
  ): readonly SupersetSessionContext[] {
    const read = (query: string) =>
      database
        .prepare(query)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const context = contextFromRow(organizationId, row, spawnableAgents);
          return context ? [context] : [];
        });
    try {
      return read(SUPERSET_WORKSPACE_QUERY);
    } catch (error) {
      if (!(error instanceof Error && canIgnoreSqliteError(error))) throw error;
      return read(SUPERSET_LEGACY_WORKSPACE_QUERY);
    }
  }

  /**
   * Read behind its own guard like the chatless rows: a host database from a
   * Superset without the worktree columns loses only the path matching, never
   * the chats whose session ids Superset did record.
   */
  #worktreeDirectories(
    database: SqliteDatabase,
    organizationId: string,
    spawnableAgents: readonly string[],
  ): readonly SupersetWorktreeContext[] {
    try {
      return database
        .prepare(SUPERSET_WORKTREE_DIRECTORY_QUERY)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const worktree = worktreeContextFromRow(organizationId, row, spawnableAgents);
          return worktree ? [worktree] : [];
        });
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    }
  }

  /**
   * Read behind its own guard: a host database from a Superset without the
   * workspace columns this query names loses only the chatless rows, never
   * the bound chats read above it.
   */
  #chatlessWorkspaces(
    database: SqliteDatabase,
    organizationId: string,
    spawnableAgents: readonly string[],
  ): readonly SupersetSessionContext[] {
    try {
      return database
        .prepare(SUPERSET_CHATLESS_WORKSPACE_QUERY)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const context = contextFromWorkspaceRow(organizationId, row, spawnableAgents);
          return context ? [context] : [];
        });
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    }
  }
}
