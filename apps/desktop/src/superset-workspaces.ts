import path from "node:path";
import { PROVIDER_ID, type ProviderSessionObservation } from "@sidecar/core";
import { readDirectory } from "./local-session-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "./local-sqlite";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "./shared/contracts";
import { SUPERSET_CONTROL_ID } from "./superset-cli";

export const SUPERSET_WORKSPACE_SCOPE_ID = SUPERSET_WORKSPACE_PROVIDER_ID;

const SUPERSET_AGENT_PROVIDER: Readonly<Record<string, string>> = {
  claude: PROVIDER_ID.CLAUDE_CODE,
  codex: PROVIDER_ID.CODEX,
  copilot: PROVIDER_ID.COPILOT,
  cursor: PROVIDER_ID.CURSOR,
  opencode: PROVIDER_ID.OPENCODE,
};

const SUPERSET_WORKSPACE_QUERY = `
  SELECT
    bindings.agent_id,
    bindings.agent_session_id,
    bindings.terminal_id,
    bindings.last_event_type,
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

export interface SupersetSessionContext {
  providerId: string;
  providerSessionId: string;
  hostId: string;
  workspaceId: string;
  workspaceName: string;
  terminalId: string;
  agentId: string;
  lastEventType: string;
  updatedAt: number;
  projectName?: string;
  branch?: string;
  pullRequestUrl?: string;
  spawnableAgents: readonly string[];
}

function numberFromRow(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function contextFromRow(
  hostId: string,
  row: Record<string, unknown>,
  spawnableAgents: readonly string[],
): SupersetSessionContext | undefined {
  const agentId = textFromRow(row, "agent_id");
  const providerId = agentId ? SUPERSET_AGENT_PROVIDER[agentId] : undefined;
  const providerSessionId = textFromRow(row, "agent_session_id");
  const workspaceId = textFromRow(row, "workspace_id");
  const workspaceName = textFromRow(row, "workspace_name");
  const terminalId = textFromRow(row, "terminal_id");
  const lastEventType = textFromRow(row, "last_event_type");
  const updatedAt = numberFromRow(row, "updated_at");
  if (
    !agentId ||
    !providerId ||
    !providerSessionId ||
    !workspaceId ||
    !workspaceName ||
    !terminalId ||
    !lastEventType ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  const projectName = textFromRow(row, "project_name");
  const branch = textFromRow(row, "branch");
  const pullRequestUrl = textFromRow(row, "pull_request_url");
  return {
    providerId,
    providerSessionId,
    hostId,
    workspaceId,
    workspaceName,
    terminalId,
    agentId,
    lastEventType,
    updatedAt,
    spawnableAgents,
    ...(projectName ? { projectName } : {}),
    ...(branch ? { branch } : {}),
    ...(pullRequestUrl ? { pullRequestUrl } : {}),
  };
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

  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
    actionsEnabled = false,
  ): readonly ProviderSessionObservation[] {
    return observations.map((observation) => {
      const context = this.context(providerId, observation.providerSessionId);
      if (!context) return observation;
      return {
        ...observation,
        detail: {
          ...observation.detail,
          ...(context.projectName ? { repository: context.projectName } : {}),
          ...(context.branch ? { branch: context.branch } : {}),
          ...(context.pullRequestUrl ? { change: context.pullRequestUrl } : {}),
        },
        workspace: {
          providerWorkspaceId: context.workspaceId,
          name: context.workspaceName,
          scopeId: SUPERSET_WORKSPACE_SCOPE_ID,
          managerName: "Superset",
        },
        ...(actionsEnabled
          ? {
              canReceiveMessage: true,
              ...(context.spawnableAgents.length > 0
                ? {
                    spawnableAgents: context.spawnableAgents,
                    spawnTarget: context.workspaceId,
                  }
                : {}),
              controls: [
                ...(observation.controls ?? []),
                {
                  id: SUPERSET_CONTROL_ID.OPEN_WORKSPACE,
                  label: "Open in Superset",
                  target: context.workspaceId,
                },
                {
                  id: SUPERSET_CONTROL_ID.CLOSE_TERMINAL,
                  label: "Close terminal",
                },
              ],
            }
          : {}),
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
            this.#readHost(entry.name, path.join(hostDirectory, entry.name, "host.db")),
          ),
      )
    ).flat();
    return new SupersetWorkspaceSnapshot(contexts);
  }

  async #readHost(
    hostId: string,
    databasePath: string,
  ): Promise<readonly SupersetSessionContext[]> {
    const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
    if (!database) return [];
    try {
      const spawnableAgents = database
        .prepare(SUPERSET_AGENT_QUERY)
        .all()
        .flatMap((value) => {
          if (typeof value !== "object" || value === null) return [];
          const presetId = textFromRow(value as Record<string, unknown>, "preset_id");
          return presetId ? [presetId] : [];
        });
      return database
        .prepare(SUPERSET_WORKSPACE_QUERY)
        .all()
        .flatMap((value) => {
          if (typeof value !== "object" || value === null) return [];
          const context = contextFromRow(hostId, value as Record<string, unknown>, spawnableAgents);
          return context ? [context] : [];
        });
    } catch (error) {
      if (canIgnoreSqliteError(error)) return [];
      throw error;
    } finally {
      database.close();
    }
  }
}
