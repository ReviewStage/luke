import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderSessionObservation,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SessionProviderAdapterBase,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/session";
import { text, wireRecord } from "@sidecar/wire";
import { repositoryLabel } from "../shared/cloud-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import {
  conductorCreateWorkspaceLink,
  defaultConductorDatabasePath,
} from "./session-applications.js";

/**
 * The name a person reads for the local creator, set apart from the cloud
 * adapter's plain "Conductor" on purpose: the two are one brand but different
 * places — a repository on this Mac versus a cloud project behind a key — and
 * a create offer that named both "Conductor" could not be told apart in the
 * picker or asked for by name out loud. The mark stays Conductor's; only the
 * word carries the locality.
 */
export const CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_NAME = "Conductor (local)";

/** How the reader names the columns it reads, so a rename here is one edit. */
const CONDUCTOR_REPO_FIELD = {
  ID: "id",
  NAME: "name",
  REMOTE_URL: "remote_url",
  ROOT_PATH: "root_path",
} as const;

/**
 * The repositories Conductor holds, read from its own index. `root_path` is
 * the repository's main worktree — the exact path Conductor's creation link
 * matches a project by — so a row without one names no place a workspace can
 * be created and is dropped. `hidden` is Conductor's own mark for a repository
 * the user filed out of its sidebar, so a hidden repository is left off the
 * offer the way an archived workspace is; a schema too old to carry the flag
 * offers every repository, which is what that schema itself showed.
 */
const CONDUCTOR_REPOSITORY_QUERY = `
  SELECT
    repos.id AS ${CONDUCTOR_REPO_FIELD.ID},
    repos.name AS ${CONDUCTOR_REPO_FIELD.NAME},
    repos.remote_url AS ${CONDUCTOR_REPO_FIELD.REMOTE_URL},
    repos.root_path AS ${CONDUCTOR_REPO_FIELD.ROOT_PATH}
  FROM repos
  WHERE repos.hidden = 0
    AND repos.root_path IS NOT NULL
    AND repos.root_path != ''
`;

const CONDUCTOR_REPOSITORY_QUERY_WITHOUT_HIDDEN = `
  SELECT
    repos.id AS ${CONDUCTOR_REPO_FIELD.ID},
    repos.name AS ${CONDUCTOR_REPO_FIELD.NAME},
    repos.remote_url AS ${CONDUCTOR_REPO_FIELD.REMOTE_URL},
    repos.root_path AS ${CONDUCTOR_REPO_FIELD.ROOT_PATH}
  FROM repos
  WHERE repos.root_path IS NOT NULL
    AND repos.root_path != ''
`;

/** How many repositories the offer holds, so an index of hundreds is bounded. */
const CONDUCTOR_MAXIMUM_REPOSITORIES = 50;

/** One repository Conductor holds: where a new workspace lands, and what it is called. */
interface ConductorRepository {
  id: string;
  rootPath: string;
  repositoryLabel: string;
}

export interface ConductorRepositoryReaderOptions {
  databasePath?: string;
  sqlite?: SqliteModuleLoader;
}

/**
 * Reads the repositories Conductor holds from its own index, read-only and
 * without opening any transcript, the same way the session reader does. An
 * absent app, an older schema, or a failed read means no repositories — an
 * empty offer, never a failed pass — because a place to create a workspace
 * that cannot be read is a place nothing may be created.
 */
export class ConductorRepositoryReader {
  readonly #databasePath: string;
  readonly #sqlite: SqliteModuleLoader;

  constructor(options: ConductorRepositoryReaderOptions = {}) {
    this.#databasePath = options.databasePath ?? defaultConductorDatabasePath();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
  }

  async read(): Promise<readonly ConductorRepository[]> {
    const database = await openReadOnlyDatabase(this.#sqlite, this.#databasePath);
    if (!database) return [];
    try {
      return this.#queryRows(database)
        .flatMap((row) => {
          const record = wireRecord(row);
          if (!record) return [];
          const id = text(record[CONDUCTOR_REPO_FIELD.ID]);
          const rootPath = text(record[CONDUCTOR_REPO_FIELD.ROOT_PATH]);
          if (!id || !rootPath) return [];
          return [
            {
              id,
              rootPath,
              repositoryLabel: repositoryLabel(
                text(record[CONDUCTOR_REPO_FIELD.REMOTE_URL]),
                text(record[CONDUCTOR_REPO_FIELD.NAME]),
              ),
            },
          ];
        })
        .slice(0, CONDUCTOR_MAXIMUM_REPOSITORIES);
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    } finally {
      database.close();
    }
  }

  /** The fuller read first, then the schema that predates the hidden flag. */
  #queryRows(database: SqliteDatabase) {
    try {
      return database.prepare(CONDUCTOR_REPOSITORY_QUERY).all();
    } catch (error) {
      if (!(error instanceof Error && canIgnoreSqliteError(error))) throw error;
      return database.prepare(CONDUCTOR_REPOSITORY_QUERY_WITHOUT_HIDDEN).all();
    }
  }
}

export interface ConductorLocalWorkspaceAdapterOptions {
  reader?: ConductorRepositoryReader;
  /** Hands one address to the operating system, the sole write this makes. */
  openExternal: (url: string) => Promise<void>;
}

/**
 * Creates a Conductor workspace on this machine by handing Conductor's own
 * creation deep link to the operating system — the local counterpart of the
 * cloud adapter's `POST /v0/workspaces`, and the same bounded exception. It
 * observes no sessions of its own: the local Conductor chats are already
 * reported by the agents that run them and grouped by the session-application
 * reader. Its whole job is to say where a workspace can be created — the
 * repositories the latest read of Conductor's index reported — and, only for
 * one of exactly those, to fire the create link the developer just asked for.
 *
 * The developer's opening task rides the link as Conductor's `prompt`; the
 * link carries no agent, model, or name, because Conductor's creation link
 * documents none, so a new local workspace runs the repository's own default
 * agent and wears the name Conductor gives it. The workspace it lands in is
 * always the offered project's own root path, read back here rather than taken
 * from the request, so a create can only ever reach a repository this pass saw.
 */
export class ConductorLocalWorkspaceAdapter extends SessionProviderAdapterBase {
  readonly provider = {
    id: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
    displayName: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_NAME,
  };
  readonly #reader: ConductorRepositoryReader;
  readonly #openExternal: (url: string) => Promise<void>;
  #projects: readonly WorkspaceProject[] = [];

  constructor(options: ConductorLocalWorkspaceAdapterOptions) {
    super();
    this.#reader = options.reader ?? new ConductorRepositoryReader();
    this.#openExternal = options.openExternal;
  }

  /** Creates no rows: local Conductor chats are observed by their own agents. */
  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return [];
  }

  /**
   * Re-reads the repositories Conductor holds and turns each into a project a
   * workspace can be created in. A read that fails or finds nothing empties
   * the offer, so a create is never validated against repositories a later
   * read could no longer see.
   */
  async refresh(): Promise<void> {
    this.#projects = (await this.#reader.read()).map((repository) => ({
      providerProjectId: repository.id,
      repository: repository.repositoryLabel,
      // Conductor makes an idle workspace happily and takes the opening task
      // as its first prompt, so a task is welcome but never required.
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      // The repository's own main-worktree path, which the creation link
      // matches a project by and which a create reads back rather than trusts
      // from the request.
      providerTargetId: repository.rootPath,
    }));
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
  }

  override async createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Promise<ProviderWorkspaceResult> {
    const project = this.#projects.find(
      (candidate) =>
        candidate.providerProjectId === request.providerProjectId &&
        (request.providerTargetId === undefined ||
          candidate.providerTargetId === request.providerTargetId),
    );
    // The root path a create fires against is the offered project's own, never
    // the request's: a create can reach only a repository this pass reported.
    const rootPath = project?.providerTargetId;
    if (!rootPath) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const link = conductorCreateWorkspaceLink(rootPath, request.task);
    try {
      await this.#openExternal(link);
    } catch (error) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: `Couldn't ask Conductor to create the workspace: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    // Conductor's link both creates the workspace and opens it in Conductor's
    // own window, and hands back no session id, so none is reported and the
    // created-workspace open tracker stays out of it: the workspace opens
    // where it was made.
    return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
  }
}
