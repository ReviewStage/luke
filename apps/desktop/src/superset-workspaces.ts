import path from "node:path";
import {
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
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

export interface SupersetSessionContext {
  providerId: string;
  providerSessionId: string;
  hostId: string;
  workspaceId: string;
  workspaceName: string;
  terminalId: string;
  updatedAt: number;
  projectName?: string;
  branch?: string;
  pullRequestUrl?: string;
  spawnableAgents: readonly string[];
}

function contextFromRow(
  hostId: string,
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
    hostId,
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

  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
    actionsEnabled = false,
  ): readonly ProviderSessionObservation[] {
    return observations.map((observation) => {
      const context = this.context(providerId, observation.providerSessionId);
      if (!context) return observation;
      const detail = { ...observation.detail };
      if (context.projectName) detail.repository = context.projectName;
      if (context.branch) detail.branch = context.branch;
      if (context.pullRequestUrl) detail.change = context.pullRequestUrl;
      const workspace = {
        providerWorkspaceId: context.workspaceId,
        name: context.workspaceName,
        scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
        managerName: "Superset",
      };
      if (!actionsEnabled) {
        return { ...observation, detail, workspace };
      }
      const controls = [
        ...(observation.controls ?? []),
        // The open kind is what lets an ask to open this chat run the
        // control: a Superset-managed local session has no address of its
        // own, and Superset's window is where it opens.
        {
          id: SUPERSET_CONTROL_ID.OPEN_WORKSPACE,
          label: "Open in Superset",
          kind: SESSION_CONTROL_KIND.OPEN,
          target: context.workspaceId,
        },
        {
          id: SUPERSET_CONTROL_ID.CLOSE_TERMINAL,
          label: "Close terminal",
        },
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
          const context = contextFromRow(hostId, row, spawnableAgents);
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
