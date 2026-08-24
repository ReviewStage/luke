import os from "node:os";
import path from "node:path";
import {
  AGENT_IDENTITY,
  maximumSessionTitleLength,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
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
import { unclaimedWorkspace, WorkspaceHostSnapshot } from "../shared/workspace-host-snapshot.js";

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
  [CONDUCTOR_AGENT_TYPE.CLAUDE]: AGENT_IDENTITY.CLAUDE_CODE,
  [CONDUCTOR_AGENT_TYPE.CODEX]: AGENT_IDENTITY.CODEX,
  [CONDUCTOR_AGENT_TYPE.CURSOR]: AGENT_IDENTITY.CURSOR,
  [CONDUCTOR_AGENT_TYPE.OPENCODE]: AGENT_IDENTITY.OPENCODE,
} as const satisfies Readonly<Record<ConductorAgentType, SessionProvider>>;

const CONDUCTOR_SESSION_FIELD = {
  AGENT_TYPE: "agent_type",
  CHAT_TITLE: "chat_title",
  CONDUCTOR_SESSION_ID: "conductor_session_id",
  HIDDEN: "hidden",
  PROVIDER_SESSION_ID: "provider_session_id",
  WORKSPACE_ID: "workspace_id",
  WORKSPACE_NAME: "workspace_name",
  WORKSPACE_STATE: "workspace_state",
} as const;

/**
 * The schema's default for a chat nobody has named yet. It is the absence of
 * a name rather than one anybody chose — Conductor replaces it the moment it
 * generates a real title — so it reads as no name at all, and the provider's
 * own title keeps the row.
 */
const CONDUCTOR_UNNAMED_CHAT_TITLE = "Untitled";

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
 * The address that asks Conductor's own app to create a new workspace in the
 * repository whose main worktree is `rootPath`, seeded with the developer's
 * opening prompt when they gave one. It is Conductor's own documented creation
 * link — the same shape its Linear "open in Conductor" button fires, minus the
 * issue id — so a create stays what an open is: an address handed to the
 * operating system, which Conductor's own scheme handler acts on.
 *
 * The format is exact and not a `URL`'s to give: Conductor's handler reaches
 * this branch only for a link whose host is none it knows, then re-parses the
 * raw string by splitting on `&` and reading each `key=value`. So the encoded
 * `path` and `prompt` are the whole authority — no host, no `?` — because a
 * host or a query marker would fold into the first key and drop the path,
 * which silently retargets the create at Conductor's first repository. Both
 * values are fully percent-encoded, so a path or prompt carrying `&` or `=`
 * cannot split the document, and Conductor matches `path` against a
 * repository's own main-worktree path exactly.
 */
export function conductorCreateWorkspaceLink(rootPath: string, prompt?: string): string {
  const query = [
    `path=${encodeURIComponent(rootPath)}`,
    ...(prompt ? [`prompt=${encodeURIComponent(prompt)}`] : []),
  ].join("&");
  return `conductor://${query}`;
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
 * chat's title is the name the user reads in Conductor's own sidebar, and the
 * workspace join carries the name the user knows the work by, laddered the
 * way Conductor's own sidebar labels a workspace — the chosen workspace name,
 * then the pull request's title where only a PR names the work, then the
 * directory name Conductor fell back to itself — and
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
    sessions.title AS ${CONDUCTOR_SESSION_FIELD.CHAT_TITLE},
    sessions.is_hidden AS ${CONDUCTOR_SESSION_FIELD.HIDDEN},
    workspaces.id AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_ID},
    COALESCE(workspaces.workspace_name, workspaces.pr_title, workspaces.directory_name)
      AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_NAME},
    workspaces.state AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_STATE}
  FROM sessions
  LEFT JOIN workspaces ON workspaces.id = sessions.workspace_id
  WHERE sessions.claude_session_id IS NOT NULL
    AND sessions.agent_type IS NOT NULL
`;

/**
 * The same read against a database from before Conductor titled its chats.
 * The sessions still annotate, group, and file away; their rows simply keep
 * the titles their own providers derived. Conductor stored a workspace's PR
 * title, its lifecycle state, and the hidden flag all before its chosen
 * name, so any schema this tier can read holds everything else it asks for.
 */
const CONDUCTOR_SESSION_QUERY_WITHOUT_TITLES = `
  SELECT
    sessions.claude_session_id AS ${CONDUCTOR_SESSION_FIELD.PROVIDER_SESSION_ID},
    sessions.agent_type AS ${CONDUCTOR_SESSION_FIELD.AGENT_TYPE},
    sessions.id AS ${CONDUCTOR_SESSION_FIELD.CONDUCTOR_SESSION_ID},
    sessions.is_hidden AS ${CONDUCTOR_SESSION_FIELD.HIDDEN},
    workspaces.id AS ${CONDUCTOR_SESSION_FIELD.WORKSPACE_ID},
    COALESCE(workspaces.workspace_name, workspaces.pr_title, workspaces.directory_name)
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
  /** The name Conductor gave the chat, absent while it is still unnamed. */
  chatTitle?: string;
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

export interface ConductorSessionApplicationReaderOptions {
  databasePath?: string;
  sqlite?: SqliteModuleLoader;
}

export function defaultConductorDatabasePath(): string {
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

function chatTitle(value: UnparsedWireValue): string | undefined {
  const parsed = text(value);
  if (!parsed || parsed === CONDUCTOR_UNNAMED_CHAT_TITLE) return undefined;
  return parsed.slice(0, maximumSessionTitleLength);
}

/**
 * Reads Conductor's own session-to-provider mapping without opening any agent
 * transcript. An absent app, an older schema, or a failed auxiliary read means
 * no annotation; failure can never make the provider's own observation
 * disappear. Only Conductor's own positive record that the user filed a chat
 * away — the chat hidden, or its workspace archived — drops a row, and drops
 * it whole.
 */
export class ConductorSessionApplicationSnapshot extends WorkspaceHostSnapshot<ConductorSessionContext> {
  protected override readonly applicationId = SESSION_APPLICATION_ID.CONDUCTOR;

  // A filed-away chat is dropped rather than annotated: the user archived
  // or hid it on Conductor's own surface, and a sub-agent inheriting that
  // context was filed away with its parent — the agent's transcript outlives
  // the chat the user already said goodbye to.
  protected override retains(context: ConductorSessionContext): boolean {
    return context.filedAway !== true;
  }

  /**
   * Adds Conductor beside any app associations the provider already reported,
   * titles the chat by the name Conductor gave it, and groups it under the
   * Conductor workspace it belongs to, the way a Superset-managed chat groups
   * under its Superset workspace.
   */
  protected override annotate(
    observation: ProviderSessionObservation,
    context: ConductorSessionContext,
    conductorSessions: ReadonlyMap<string, ConductorSessionContext>,
  ): ProviderSessionObservation {
    // The workspace is claimed only where no other manager already grouped
    // the chat; the claim is what carries the manager's mark on the tray
    // header, once, above the chats it holds.
    const workspace = context.workspaceId
      ? unclaimedWorkspace(observation, {
          providerWorkspaceId: context.workspaceId,
          ...(context.workspaceName ? { name: context.workspaceName } : undefined),
          scopeId: SESSION_APPLICATION_ID.CONDUCTOR,
          managerName: CONDUCTOR_APPLICATION_NAME,
        })
      : undefined;
    // The address needs the workspace id — Conductor's handler drops a
    // link without one — and a sub-agent's inherited context addresses the
    // ancestor chat, which is where its conversation lives. The app that
    // wrote the index is the scheme's handler, so the address stands with
    // no credential at all.
    const link = context.workspaceId
      ? conductorWorkspaceLink(context.workspaceId, context.conductorSessionId)
      : undefined;
    // The association names the exact chat — its address does, when it has
    // one — so it is the session's own and rides the row even inside the
    // workspace's tray, where the tray header's manager mark comes from
    // the workspace claim above rather than from this.
    const application: SessionApplication = {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: CONDUCTOR_APPLICATION_NAME,
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      ...(link ? { link } : undefined),
    };
    // The address fills the row's link only where nothing else gave one.
    // Which app a grouped row's press follows is not decided here: the
    // session normalization orders every row's marks with its workspace's
    // manager in the lead and points the press at the first linked mark,
    // so Conductor's precedence over an agent's own app falls out of the
    // grouping rather than out of any Conductor-specific write.
    const detail =
      link && !observation.detail?.link ? { ...observation.detail, link } : observation.detail;
    // The name Conductor gave the chat is what the user reads in Conductor's
    // own sidebar, so it titles the row here the way it titles a
    // cloud-observed chat's — but only on the chat itself, never inherited:
    // a sub-agent labelled with its parent's name would read as the same
    // conversation twice while saying nothing about its own work.
    const title = conductorSessions.get(observation.providerSessionId)?.chatTitle;
    return {
      ...observation,
      ...(title ? { title } : undefined),
      ...(detail ? { detail } : undefined),
      applications: [...(observation.applications ?? []), application],
      ...(workspace ? { workspace } : undefined),
    };
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
      const title = chatTitle(record[CONDUCTOR_SESSION_FIELD.CHAT_TITLE]);
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
        ...(title ? { chatTitle: title } : undefined),
        ...(workspaceId ? { workspaceId } : undefined),
        ...(workspaceName ? { workspaceName } : undefined),
        ...(filedAway ? { filedAway } : undefined),
      });
      sessionsByProvider.set(providerId, sessions);
    }
    return new ConductorSessionApplicationSnapshot(sessionsByProvider);
  }

  /**
   * The fullest read first, then progressively older schemas: losing the
   * chat titles must not cost the grouping, and losing the grouping must not
   * cost the annotation itself.
   */
  #queryRows(database: SqliteDatabase): UnparsedWireValue[] {
    for (const query of [CONDUCTOR_SESSION_QUERY, CONDUCTOR_SESSION_QUERY_WITHOUT_TITLES]) {
      try {
        return database.prepare(query).all();
      } catch (error) {
        if (!(error instanceof Error && canIgnoreSqliteError(error))) throw error;
      }
    }
    return database.prepare(CONDUCTOR_SESSION_QUERY_WITHOUT_WORKSPACES).all();
  }
}
