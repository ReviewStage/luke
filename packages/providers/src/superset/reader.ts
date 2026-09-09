import path from "node:path";
import { type WireRecord, wireRecord } from "@sidecar/wire";
import { readDirectory } from "../shared/local-files.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import { type SupersetSnapshot, supersetSnapshot } from "./snapshot.js";
import {
  contextFromRow,
  contextFromWorkspaceRow,
  type SupersetSessionContext,
  type SupersetWorktreeContext,
  worktreeContextFromRow,
} from "./wire.js";

/**
 * Superset's own host state, read and nothing else: one database per
 * organization under `host/`, opened read-only, four documented reads, and
 * the contexts they answer with. What a roster does with them is the
 * snapshot's.
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

export interface SupersetHostStateOptions {
  homeDirectory: string;
  sqlite?: SqliteModuleLoader;
}

/**
 * What one query answers, and what a schema this build does not recognize
 * means for it. `fallback` reads an older schema's own query instead — a host
 * database from before bindings carried their lifecycle columns still holds
 * the chats — while `empty` loses only that query's rows and keeps the rest of
 * the read.
 */
type SchemaMiss = { readonly fallback: string } | "empty";

/**
 * One documented read, as the values it means. A query naming a column this
 * database lacks is a schema Luke does not recognize, never a reason to lose
 * the whole organization, so each read says for itself what a miss costs.
 */
function rows<Value>(
  database: SqliteDatabase,
  query: string,
  map: (row: WireRecord) => Value | undefined,
  onSchemaMiss: SchemaMiss,
): readonly Value[] {
  const read = (source: string): readonly Value[] =>
    database
      .prepare(source)
      .all()
      .flatMap((value) => {
        const row = wireRecord(value);
        const mapped = row ? map(row) : undefined;
        return mapped === undefined ? [] : [mapped];
      });
  try {
    return read(query);
  } catch (error) {
    if (!(error instanceof Error && canIgnoreSqliteError(error))) throw error;
    return onSchemaMiss === "empty" ? [] : read(onSchemaMiss.fallback);
  }
}

interface OrganizationState {
  contexts: readonly SupersetSessionContext[];
  worktrees: readonly SupersetWorktreeContext[];
}

const NO_ORGANIZATION_STATE: OrganizationState = { contexts: [], worktrees: [] };

async function readOrganization(
  sqlite: SqliteModuleLoader,
  organizationId: string,
  databasePath: string,
): Promise<OrganizationState> {
  const database = await openReadOnlyDatabase(sqlite, databasePath);
  if (!database) return NO_ORGANIZATION_STATE;
  try {
    const spawnableAgents = rows(
      database,
      SUPERSET_AGENT_QUERY,
      (row) => textFromRow(row, "preset_id"),
      "empty",
    );
    return {
      contexts: [
        ...rows(
          database,
          SUPERSET_WORKSPACE_QUERY,
          (row) => contextFromRow(organizationId, row, spawnableAgents),
          { fallback: SUPERSET_LEGACY_WORKSPACE_QUERY },
        ),
        ...rows(
          database,
          SUPERSET_CHATLESS_WORKSPACE_QUERY,
          (row) => contextFromWorkspaceRow(organizationId, row, spawnableAgents),
          "empty",
        ),
      ],
      worktrees: rows(
        database,
        SUPERSET_WORKTREE_DIRECTORY_QUERY,
        (row) => worktreeContextFromRow(organizationId, row, spawnableAgents),
        "empty",
      ),
    };
  } catch (error) {
    if (error instanceof Error && canIgnoreSqliteError(error)) return NO_ORGANIZATION_STATE;
    throw error;
  } finally {
    database.close();
  }
}

/**
 * Every organization's host state on this machine, read read-only and folded
 * into one snapshot. The directories under `host/` are named by organization,
 * not by machine: every database beneath them is this machine's own.
 */
export async function supersetHostState(
  options: SupersetHostStateOptions,
): Promise<SupersetSnapshot> {
  const sqlite = options.sqlite ?? defaultSqliteModule;
  const hostDirectory = path.join(options.homeDirectory, "host");
  const entries = await readDirectory(hostDirectory);
  const organizations = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readOrganization(sqlite, entry.name, path.join(hostDirectory, entry.name, "host.db")),
      ),
  );
  return supersetSnapshot(
    organizations.flatMap((organization) => organization.contexts),
    organizations.flatMap((organization) => organization.worktrees),
  );
}
