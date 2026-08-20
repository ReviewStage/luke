import path from "node:path";
import {
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type WireRecord,
} from "@sidecar/core";
import { readDirectory } from "./local-session-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "./local-sqlite";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "./shared/contracts";
import { SUPERSET_CONTROL_ID } from "./superset-cli";
import { wireRecord } from "./wire-boundary";

const SUPERSET_AGENT_PROVIDER = {
  claude: PROVIDER_ID.CLAUDE_CODE,
  codex: PROVIDER_ID.CODEX,
  copilot: PROVIDER_ID.COPILOT,
  cursor: PROVIDER_ID.CURSOR,
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
  terminalId: string;
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
      // A managed chat's address is its workspace's: Superset documents no
      // terminal-scoped address, so chats sharing a workspace share it, and a
      // session whose provider reported an address of its own keeps that one.
      // The app that wrote the host state is the scheme's handler, so the
      // address stands without the CLI login the acts below wait for.
      if (!detail.link) detail.link = supersetWorkspaceLink(context.workspaceId);
      const workspace = {
        providerWorkspaceId: context.workspaceId,
        name: context.workspaceName,
        scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
        managerName: "Superset",
      };
      if (!actableInOrganization(context, activeOrganizationId)) {
        return { ...observation, detail, workspace };
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
      if (context.spawnableAgents.length > 0) {
        return {
          ...observation,
          detail,
          workspace,
          canReceiveMessage: true,
          spawnableAgents: context.spawnableAgents,
          spawnTarget: context.workspaceId,
          // Superset documents renaming any workspace it manages, so the
          // target rides the advertisement the way the spawn target does.
          renameTarget: context.workspaceId,
          controls,
        };
      }
      return {
        ...observation,
        detail,
        workspace,
        canReceiveMessage: true,
        renameTarget: context.workspaceId,
        controls,
      };
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
      return database
        .prepare(SUPERSET_WORKSPACE_QUERY)
        .all()
        .flatMap((value) => {
          const row = wireRecord(value);
          if (!row) return [];
          const context = contextFromRow(organizationId, row, spawnableAgents);
          return context ? [context] : [];
        });
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    } finally {
      database.close();
    }
  }
}
