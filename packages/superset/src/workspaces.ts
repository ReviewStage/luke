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
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
} from "@sidecar/session";
import { type WireRecord, wireRecord } from "@sidecar/wire";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "../../../apps/desktop/src/shared/contracts.js";
import { SUPERSET_CONTROL_ID } from "./cli.js";

const SUPERSET_AGENT_PROVIDER = {
  claude: PROVIDER_ID.CLAUDE_CODE,
  codex: PROVIDER_ID.CODEX,
  copilot: PROVIDER_ID.COPILOT,
  cursor: PROVIDER_ID.CURSOR,
  // Superset binds Cursor's `agents` CLI under its own name, beside the id
  // it uses for the app's agents; both are Cursor sessions to Luke.
  "cursor-agent": PROVIDER_ID.CURSOR,
  gemini: PROVIDER_ID.GEMINI_CLI,
  opencode: PROVIDER_ID.OPENCODE,
} as const satisfies Readonly<Record<string, string>>;

function supersetProviderId(agentId: string): string | undefined {
  for (const [key, providerId] of Object.entries(SUPERSET_AGENT_PROVIDER)) {
    if (key === agentId) return providerId;
  }
  return undefined;
}

/**
 * The address of one workspace in Superset's own app — the same deep link
 * Superset's CLI fires for `workspaces open`, composed here from the observed
 * workspace id instead of asking the CLI to compose it, so opening stays what
 * every open is: an address handed to the operating system, reaching no
 * provider and needing no login.
 */
export function supersetWorkspaceLink(workspaceId: string): string {
  return `superset://v2-workspace/${workspaceId}`;
}

/** Superset's documented route to one terminal inside an observed workspace. */
export function supersetTerminalLink(workspaceId: string, terminalId: string): string {
  const link = new URL(supersetWorkspaceLink(workspaceId));
  link.searchParams.set("terminalId", terminalId);
  return link.toString();
}

const SUPERSET_WORKSPACE_QUERY = `
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
   * — there is nothing there to message — so every act that needs one must
   * check rather than assume.
   */
  terminalId?: string;
  updatedAt: number;
  projectName?: string;
  branch?: string;
  pullRequestUrl?: string;
  spawnableAgents: readonly string[];
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
  const providerId = agentId ? supersetProviderId(agentId) : undefined;
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
    terminalId,
    updatedAt,
    spawnableAgents,
  };
  if (projectName) context.projectName = projectName;
  if (branch) context.branch = branch;
  if (pullRequestUrl) context.pullRequestUrl = pullRequestUrl;
  return context;
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

export class SupersetWorkspaceSnapshot {
  readonly #sessions = new Map<string, Map<string, SupersetSessionContext>>();

  constructor(contexts: readonly SupersetSessionContext[]) {
    for (const context of contexts) {
      const provider = this.#sessions.get(context.providerId) ?? new Map();
      const existing = provider.get(context.providerSessionId);
      if (!existing || existing.updatedAt < context.updatedAt) {
        provider.set(context.providerSessionId, context);
      }
      this.#sessions.set(context.providerId, provider);
    }
  }

  context(providerId: string, providerSessionId: string): SupersetSessionContext | undefined {
    return this.#sessions.get(providerId)?.get(providerSessionId);
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
      const context = this.context(providerId, observation.providerSessionId);
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
    const contexts = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            this.#readOrganization(entry.name, path.join(hostDirectory, entry.name, "host.db")),
          ),
      )
    ).flat();
    return new SupersetWorkspaceSnapshot(contexts);
  }

  async #readOrganization(
    organizationId: string,
    databasePath: string,
  ): Promise<readonly SupersetSessionContext[]> {
    const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
    if (!database) return [];
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
      const bound = database
        .prepare(SUPERSET_WORKSPACE_QUERY)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const context = contextFromRow(organizationId, row, spawnableAgents);
          return context ? [context] : [];
        });
      return [...bound, ...this.#chatlessWorkspaces(database, organizationId, spawnableAgents)];
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    } finally {
      database.close();
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
