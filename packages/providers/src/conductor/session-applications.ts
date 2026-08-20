import os from "node:os";
import path from "node:path";
import {
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  type SessionApplication,
  type SessionProvider,
} from "@sidecar/session";
import { text, type UnparsedWireValue, wireRecord } from "@sidecar/wire";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";

const CONDUCTOR_APPLICATION_SUPPORT_DIRECTORY = "com.conductor.app";
const CONDUCTOR_DATABASE_FILE = "conductor.db";

export const CONDUCTOR_APPLICATION_NAME = "Conductor";

const CONDUCTOR_AGENT_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  OPENCODE: "opencode",
} as const;

type ConductorAgentType = (typeof CONDUCTOR_AGENT_TYPE)[keyof typeof CONDUCTOR_AGENT_TYPE];

/**
 * The agents Conductor names in its own vocabulary, each mapped to the
 * identity Luke already draws that agent's sessions under. Shared with the
 * cloud adapter, so a Conductor chat reports the same agent whichever way it
 * was observed.
 */
export const CONDUCTOR_AGENT_BY_TYPE = {
  [CONDUCTOR_AGENT_TYPE.CLAUDE]: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
  [CONDUCTOR_AGENT_TYPE.CODEX]: { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  [CONDUCTOR_AGENT_TYPE.CURSOR]: { id: PROVIDER_ID.CURSOR, displayName: "Cursor" },
  [CONDUCTOR_AGENT_TYPE.OPENCODE]: { id: PROVIDER_ID.OPENCODE, displayName: "OpenCode" },
} as const satisfies Readonly<Record<ConductorAgentType, SessionProvider>>;

/** Reads Conductor's own agent word into the mapped agent, or nothing. */
export function conductorAgent(value: string | undefined): SessionProvider | undefined {
  const parsed = Object.values(CONDUCTOR_AGENT_TYPE).find((candidate) => candidate === value);
  return parsed ? CONDUCTOR_AGENT_BY_TYPE[parsed] : undefined;
}

const CONDUCTOR_SESSION_FIELD = {
  AGENT_TYPE: "agent_type",
  PROVIDER_SESSION_ID: "provider_session_id",
  WORKSPACE_ID: "workspace_id",
  WORKSPACE_NAME: "workspace_name",
} as const;

/**
 * Conductor's provider-session column kept its original Claude-specific name
 * as more agents were added. The alias is the meaning Luke reads from it. The
 * workspace join carries the name the user knows the work by — the chosen
 * workspace name, or the directory name Conductor fell back to itself.
 */
const CONDUCTOR_SESSION_QUERY = `
  SELECT
    sessions.claude_session_id AS ${CONDUCTOR_SESSION_FIELD.PROVIDER_SESSION_ID},
    sessions.agent_type AS ${CONDUCTOR_SESSION_FIELD.AGENT_TYPE},
    workspaces.id AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_ID},
    COALESCE(workspaces.workspace_name, workspaces.directory_name)
      AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_NAME}
  FROM sessions
  LEFT JOIN workspaces ON workspaces.id = sessions.workspace_id
  WHERE sessions.claude_session_id IS NOT NULL
    AND sessions.agent_type IS NOT NULL
`;

/**
 * The same read against a database from before Conductor stored workspaces.
 * The sessions still annotate; they simply group under nothing.
 */
const CONDUCTOR_SESSION_QUERY_WITHOUT_WORKSPACES = `
  SELECT
    sessions.claude_session_id AS ${CONDUCTOR_SESSION_FIELD.PROVIDER_SESSION_ID},
    sessions.agent_type AS ${CONDUCTOR_SESSION_FIELD.AGENT_TYPE}
  FROM sessions
  WHERE sessions.claude_session_id IS NOT NULL
    AND sessions.agent_type IS NOT NULL
`;

/** What Conductor's own index says about one session it holds. */
interface ConductorSessionContext {
  workspaceId?: string;
  workspaceName?: string;
}

type SessionContextsByProvider = ReadonlyMap<string, ReadonlyMap<string, ConductorSessionContext>>;

export interface ConductorSessionApplicationReaderOptions {
  databasePath?: string;
  sqlite?: SqliteModuleLoader;
}

function defaultConductorDatabasePath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    CONDUCTOR_APPLICATION_SUPPORT_DIRECTORY,
    CONDUCTOR_DATABASE_FILE,
  );
}

function agentType(value: UnparsedWireValue): ConductorAgentType | undefined {
  const parsed = text(value);
  return Object.values(CONDUCTOR_AGENT_TYPE).find((candidate) => candidate === parsed);
}

/**
 * Reads Conductor's own session-to-provider mapping without opening any agent
 * transcript. An absent app, an older schema, or a failed auxiliary read means
 * no annotation; it can never make the provider's own observation disappear.
 */
export class ConductorSessionApplicationSnapshot {
  readonly #sessionsByProvider: SessionContextsByProvider;

  constructor(sessionsByProvider: SessionContextsByProvider = new Map()) {
    this.#sessionsByProvider = sessionsByProvider;
  }

  has(providerId: string, providerSessionId: string): boolean {
    return this.#sessionsByProvider.get(providerId)?.has(providerSessionId) === true;
  }

  /**
   * Adds Conductor beside any app associations the provider already reported,
   * and groups the chat under the Conductor workspace it belongs to, the way
   * a Superset-managed chat groups under its Superset workspace. Only local
   * observations can match a local Conductor database; a cloud row with a
   * coincidentally equal provider id is never annotated. A sub-agent inherits
   * its nearest Conductor-known ancestor's association and workspace: the
   * child is Conductor's work even though only the parent is in its index.
   */
  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    const conductorSessions = this.#sessionsByProvider.get(providerId);
    if (!conductorSessions) return observations;

    const localObservationsById = new Map(
      observations
        .filter((observation) => observation.location !== SESSION_LOCATION.CLOUD)
        .map((observation) => [observation.providerSessionId, observation] as const),
    );

    const conductorContextFor = (
      observation: ProviderSessionObservation,
    ): ConductorSessionContext | undefined => {
      if (observation.location === SESSION_LOCATION.CLOUD) return undefined;
      let sessionId: string | undefined = observation.providerSessionId;
      const visited = new Set<string>();
      while (sessionId && !visited.has(sessionId)) {
        const context = conductorSessions.get(sessionId);
        if (context) return context;
        visited.add(sessionId);
        sessionId = text(localObservationsById.get(sessionId)?.parentProviderSessionId);
      }
      return undefined;
    };

    return observations.map((observation) => {
      const context = conductorContextFor(observation);
      if (
        !context ||
        observation.applications?.some(
          (application) => application.id === SESSION_APPLICATION_ID.CONDUCTOR,
        )
      ) {
        return observation;
      }
      // The workspace is claimed only where no other manager already grouped
      // the chat, and the association's scope follows it: carried by the
      // workspace, the mark sits once on the tray header; carried by the
      // session alone, it stays on the row.
      const workspace =
        context.workspaceId && !observation.workspace
          ? {
              providerWorkspaceId: context.workspaceId,
              ...(context.workspaceName ? { name: context.workspaceName } : undefined),
              scopeId: SESSION_APPLICATION_ID.CONDUCTOR,
              managerName: CONDUCTOR_APPLICATION_NAME,
            }
          : undefined;
      const application: SessionApplication = {
        id: SESSION_APPLICATION_ID.CONDUCTOR,
        displayName: CONDUCTOR_APPLICATION_NAME,
        scope: workspace ? SESSION_APPLICATION_SCOPE.WORKSPACE : SESSION_APPLICATION_SCOPE.SESSION,
      };
      return {
        ...observation,
        applications: [...(observation.applications ?? []), application],
        ...(workspace ? { workspace } : undefined),
      };
    });
  }
}

/**
 * Reads Conductor's own session-to-provider mapping without opening any agent
 * transcript. An absent app, an older schema, or a failed auxiliary read means
 * an empty snapshot; it can never make the provider's observation disappear.
 */
export class ConductorSessionApplicationReader {
  readonly #databasePath: string;
  readonly #sqlite: SqliteModuleLoader;

  constructor(options: ConductorSessionApplicationReaderOptions = {}) {
    this.#databasePath = options.databasePath ?? defaultConductorDatabasePath();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
  }

  async read(): Promise<ConductorSessionApplicationSnapshot> {
    const database = await openReadOnlyDatabase(this.#sqlite, this.#databasePath);
    if (!database) return new ConductorSessionApplicationSnapshot(new Map());

    let rows: UnparsedWireValue[];
    try {
      rows = this.#queryRows(database);
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) {
        return new ConductorSessionApplicationSnapshot(new Map());
      }
      throw error;
    } finally {
      database.close();
    }

    const sessionsByProvider = new Map<string, Map<string, ConductorSessionContext>>();
    for (const row of rows) {
      const record = wireRecord(row);
      if (!record) continue;
      const type = agentType(record[CONDUCTOR_SESSION_FIELD.AGENT_TYPE]);
      const providerSessionId = text(record[CONDUCTOR_SESSION_FIELD.PROVIDER_SESSION_ID]);
      if (!type || !providerSessionId) continue;
      const workspaceId = text(record[CONDUCTOR_SESSION_FIELD.WORKSPACE_ID]);
      const workspaceName = text(record[CONDUCTOR_SESSION_FIELD.WORKSPACE_NAME]);
      const providerId = CONDUCTOR_AGENT_BY_TYPE[type].id;
      const sessions = sessionsByProvider.get(providerId) ?? new Map();
      sessions.set(providerSessionId, {
        ...(workspaceId ? { workspaceId } : undefined),
        ...(workspaceName ? { workspaceName } : undefined),
      });
      sessionsByProvider.set(providerId, sessions);
    }
    return new ConductorSessionApplicationSnapshot(sessionsByProvider);
  }

  /**
   * The joined read first, then the plain one where the schema predates
   * workspaces: losing the grouping must not cost the annotation itself.
   */
  #queryRows(database: SqliteDatabase): UnparsedWireValue[] {
    try {
      return database.prepare(CONDUCTOR_SESSION_QUERY).all();
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) {
        return database.prepare(CONDUCTOR_SESSION_QUERY_WITHOUT_WORKSPACES).all();
      }
      throw error;
    }
  }
}
