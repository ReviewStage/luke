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
import { text, type UnparsedWireValue, wholeNumber, wireRecord } from "@sidecar/wire";
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
  CONDUCTOR_SESSION_ID: "conductor_session_id",
  HIDDEN: "hidden",
  PROVIDER_SESSION_ID: "provider_session_id",
  WORKSPACE_ID: "workspace_id",
  WORKSPACE_NAME: "workspace_name",
  WORKSPACE_STATE: "workspace_state",
} as const;

/**
 * The address of one chat in Conductor's own app — the same deep link
 * Conductor's notifications fire, composed here from the observed workspace
 * and chat ids, so opening stays what every open is: an address handed to
 * the operating system, reaching no provider. Conductor's handler requires
 * the workspace id and takes the chat id as the focus inside it, which is
 * why a session without a workspace has no address at all.
 */
export function conductorWorkspaceLink(workspaceId: string, conductorChatId?: string): string {
  const link = new URL("conductor://workspace");
  link.searchParams.set("id", workspaceId);
  if (conductorChatId !== undefined) link.searchParams.set("session", conductorChatId);
  return link.toString();
}

/**
 * The one workspace state that means the user filed the whole workspace away
 * on Conductor's own surface. Its other states — active, ready, sleeping —
 * are all still-open workspaces.
 */
const CONDUCTOR_ARCHIVED_WORKSPACE_STATE = "archived";

/**
 * Conductor's provider-session column kept its original Claude-specific name
 * as more agents were added. The alias is the meaning Luke reads from it. The
 * workspace join carries the name the user knows the work by — the chosen
 * workspace name, or the directory name Conductor fell back to itself — and
 * the workspace's lifecycle state, because an archived state is the one place
 * Conductor records that the user filed the workspace away. A chat filed away
 * on its own is Conductor's hidden flag, which its schema has carried since
 * before it named agents, so any database this query can read at all says
 * both.
 */
const CONDUCTOR_SESSION_QUERY = `
  SELECT
    sessions.claude_session_id AS ${CONDUCTOR_SESSION_FIELD.PROVIDER_SESSION_ID},
    sessions.agent_type AS ${CONDUCTOR_SESSION_FIELD.AGENT_TYPE},
    sessions.id AS ${CONDUCTOR_SESSION_FIELD.CONDUCTOR_SESSION_ID},
    sessions.is_hidden AS ${CONDUCTOR_SESSION_FIELD.HIDDEN},
    workspaces.id AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_ID},
    COALESCE(workspaces.workspace_name, workspaces.directory_name)
      AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_NAME},
    workspaces.state AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_STATE}
  FROM sessions
  LEFT JOIN workspaces ON workspaces.id = sessions.workspace_id
  WHERE sessions.claude_session_id IS NOT NULL
    AND sessions.agent_type IS NOT NULL
`;

/**
 * The same read against a database from before Conductor stored workspaces.
 * The sessions still annotate; they simply group under nothing, and a schema
 * too old to say what was filed away files nothing away.
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
  /** Conductor's own id for the chat, which its deep link takes as the focus. */
  conductorSessionId?: string;
  workspaceId?: string;
  workspaceName?: string;
  /**
   * The user filed this chat away on Conductor's own surface — the chat
   * hidden on its own, or its whole workspace archived. Filing a chat away is
   * how a user says it is done being watched, so it keeps the chat off the
   * panel the same way an archived workspace keeps its chats out of the cloud
   * adapter's roster.
   */
  filedAway?: boolean;
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
 * no annotation; failure can never make the provider's own observation
 * disappear. Only Conductor's own positive record that the user filed a chat
 * away — the chat hidden, or its workspace archived — drops a row, and drops
 * it whole.
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
   * child is Conductor's work even though only the parent is in its index —
   * and a chat the user filed away in Conductor is dropped from the roster
   * with its sub-agents, because the agent's transcript outlives the chat the
   * user already said goodbye to.
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

    return observations.flatMap((observation) => {
      const context = conductorContextFor(observation);
      // A filed-away chat is dropped rather than annotated: the user archived
      // or hid it on Conductor's own surface, and a sub-agent inheriting that
      // context was filed away with its parent.
      if (context?.filedAway) return [];
      if (
        !context ||
        observation.applications?.some(
          (application) => application.id === SESSION_APPLICATION_ID.CONDUCTOR,
        )
      ) {
        return [observation];
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
      // The address needs the workspace id — Conductor's handler drops a
      // link without one — and a sub-agent's inherited context addresses the
      // ancestor chat, which is where its conversation lives. The app that
      // wrote the index is the scheme's handler, so the address stands with
      // no credential at all. A native provider address still wins as the
      // row's primary press; the Conductor association keeps its own.
      const link = context.workspaceId
        ? conductorWorkspaceLink(context.workspaceId, context.conductorSessionId)
        : undefined;
      const application: SessionApplication = {
        id: SESSION_APPLICATION_ID.CONDUCTOR,
        displayName: CONDUCTOR_APPLICATION_NAME,
        scope: workspace ? SESSION_APPLICATION_SCOPE.WORKSPACE : SESSION_APPLICATION_SCOPE.SESSION,
        ...(link ? { link } : undefined),
      };
      const detail =
        link && !observation.detail?.link ? { ...observation.detail, link } : observation.detail;
      return [
        {
          ...observation,
          ...(detail ? { detail } : undefined),
          applications: [...(observation.applications ?? []), application],
          ...(workspace ? { workspace } : undefined),
        },
      ];
    });
  }
}

/**
 * Reads Conductor's own session-to-provider mapping without opening any agent
 * transcript. An absent app, an older schema, or a failed auxiliary read means
 * an empty snapshot; failure can never make the provider's observation
 * disappear.
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
      const conductorSessionId = text(record[CONDUCTOR_SESSION_FIELD.CONDUCTOR_SESSION_ID]);
      const workspaceId = text(record[CONDUCTOR_SESSION_FIELD.WORKSPACE_ID]);
      const workspaceName = text(record[CONDUCTOR_SESSION_FIELD.WORKSPACE_NAME]);
      // Filed away only on a positive record: a hidden flag or workspace
      // state the fallback query never read leaves the chat standing.
      const filedAway =
        (wholeNumber(record[CONDUCTOR_SESSION_FIELD.HIDDEN]) ?? 0) !== 0 ||
        text(record[CONDUCTOR_SESSION_FIELD.WORKSPACE_STATE]) ===
          CONDUCTOR_ARCHIVED_WORKSPACE_STATE;
      const providerId = CONDUCTOR_AGENT_BY_TYPE[type].id;
      const sessions = sessionsByProvider.get(providerId) ?? new Map();
      sessions.set(providerSessionId, {
        ...(conductorSessionId ? { conductorSessionId } : undefined),
        ...(workspaceId ? { workspaceId } : undefined),
        ...(workspaceName ? { workspaceName } : undefined),
        ...(filedAway ? { filedAway } : undefined),
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
