import os from "node:os";
import path from "node:path";
import {
  agedStatus,
  isRecord,
  maximumSessionTitleLength,
  OBSERVATION_WINDOW,
  oneLine,
  PROVIDER_ID,
  type ProviderSessionObservation,
  recordFromJsonLine,
  resolveOptions,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionProviderAdapter,
  type SessionStatus,
  text,
  wholeNumber,
} from "@sidecar/core";
import {
  discoverSessionFiles,
  existingWorkspaceDirectory,
  readDirectory,
  readTextFile,
  type SessionFileCandidate,
  statDirectoryEntry,
  uniquePaths,
  workspaceLabel,
} from "./local-session-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "./local-sqlite";

const OPENCODE_PROVIDER_ID = PROVIDER_ID.OPENCODE;
const OPENCODE_PROVIDER_NAME = "OpenCode";

const OPENCODE_ENVIRONMENT = {
  DATA_HOME: "XDG_DATA_HOME",
  DATABASE_FILE: "OPENCODE_DB",
} as const;

/** OpenCode keeps XDG data paths on every platform, macOS included. */
const OPENCODE_DATA_HOME_SEGMENTS = [".local", "share"] as const;
const OPENCODE_DATA_DIRECTORY_NAME = "opencode";

/**
 * The databases an install may have written. `opencode.db` is where every
 * release channel keeps sessions today; `opencode-prod.db` is what prod-channel
 * builds wrote for a few weeks in early 2026, and a machine that ran one still
 * holds sessions there.
 */
const OPENCODE_DATABASE_FILE = {
  CURRENT: "opencode.db",
  PROD_CHANNEL: "opencode-prod.db",
} as const;

/** A database with no file behind it is nothing for a read-only observer. */
const OPENCODE_MEMORY_DATABASE = ":memory:";

/**
 * Where OpenCode kept sessions as flat JSON before v1.2.0 moved them into the
 * database. The files are left in place after the migration, so they are read
 * only when no database is usable — a machine the migration has already visited
 * answers from the database alone. The still older per-project trees of v0.5
 * and earlier are not read.
 */
const OPENCODE_STORAGE_DIRECTORY = "storage";
const OPENCODE_STORAGE_SEGMENT = {
  SESSION: "session",
  MESSAGE: "message",
} as const;
const OPENCODE_SESSION_FILE_EXTENSION = ".json";

const OPENCODE_SESSION_COLUMN = {
  ID: "id",
  PARENT_ID: "parent_id",
  DIRECTORY: "directory",
  TITLE: "title",
  MODEL: "model",
  SHARE_URL: "share_url",
  TIME_CREATED: "time_created",
  TIME_UPDATED: "time_updated",
  TIME_ARCHIVED: "time_archived",
} as const;

const OPENCODE_DATA_COLUMN = "data";

const OPENCODE_ROLE = {
  ASSISTANT: "assistant",
} as const;

const OPENCODE_PART_TYPE = {
  TOOL: "tool",
} as const;

/** A tool part that has not settled is the work the session is doing now. */
const OPENCODE_TOOL_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
} as const;

/**
 * The error OpenCode records when its own user stops a turn. It ends the turn
 * rather than wedging it, so it reads as waiting and never as a failure.
 */
const OPENCODE_ABORT_ERROR_NAME = "MessageAbortedError";

/**
 * The title OpenCode stamps on a session before it has generated one. It is a
 * timestamp rather than a name, so a session still carrying it has no name yet
 * and the workspace stands in — exactly the fallback a nameless session gets.
 */
const OPENCODE_PLACEHOLDER_TITLE_PREFIX = "New session - ";

/**
 * Tool inputs whose value names the work, in the order they read best. The set
 * matches what the Claude Code and Codex adapters already report — a URL is
 * deliberately not in it, because a signed URL is a credential and no other
 * adapter sends one anywhere; a fetch is named by its tool alone.
 */
const OPENCODE_TOOL_INPUT_KEY = [
  "description",
  "command",
  "filePath",
  "file_path",
  "pattern",
  "query",
] as const;

const OPENCODE_ADAPTER_DEFAULTS = {
  MAXIMUM_SESSION_ROWS: 40,
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  /** Enough parts to reach past a finished step's bookkeeping to its tool. */
  MAXIMUM_PART_ROWS: 8,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

// Every column is read defensively from the row, so the projection stays `*`:
// OpenCode adds columns by migration, and naming one this build expects but an
// older install lacks would fail the whole query rather than one field.
const OPENCODE_SESSION_QUERY = `
  SELECT *
  FROM session
  WHERE parent_id IS NULL
    AND time_archived IS NULL
  ORDER BY time_updated DESC, id DESC
  LIMIT ?
`;

// The WHERE clause above is the one thing that can name a column an old schema
// lacks, so a database it fails on is asked again with the filters moved into
// code, where an absent column is one missing field rather than no sessions.
const OPENCODE_SESSION_QUERY_MINIMAL = `
  SELECT *
  FROM session
  ORDER BY time_updated DESC, id DESC
  LIMIT ?
`;

const OPENCODE_LAST_MESSAGE_QUERY = `
  SELECT *
  FROM message
  WHERE session_id = ?
  ORDER BY time_created DESC, id DESC
  LIMIT 1
`;

const OPENCODE_RECENT_PART_QUERY = `
  SELECT *
  FROM part
  WHERE session_id = ?
  ORDER BY time_created DESC, id DESC
  LIMIT ?
`;

type OpenCodeRow = Record<string, unknown>;

export const OPENCODE_PROVIDER: SessionProvider = {
  id: OPENCODE_PROVIDER_ID,
  displayName: OPENCODE_PROVIDER_NAME,
};

export interface OpenCodeAdapterOptions {
  dataDirectory?: string;
  now?: () => number;
  maximumSessionRows?: number;
  maximumSessionAgeMs?: number;
  activeSessionFreshnessMs?: number;
  sqlite?: SqliteModuleLoader;
}

/**
 * What the last message says about the session's turn. Only the message's
 * bookkeeping is read — role, times, and the error OpenCode recorded — never
 * the words of the message, which live in part records and stay there.
 */
interface OpenCodeTurn {
  role?: string;
  completed?: boolean;
  aborted?: boolean;
  failure?: string;
}

interface OpenCodeSessionSnapshot {
  providerSessionId: string;
  directory?: string;
  title?: string;
  model?: string;
  shareUrl?: string;
  observedAt: number;
  turn?: OpenCodeTurn;
  activity?: string;
}

function numberFromRow(row: OpenCodeRow, key: string): number | undefined {
  return wholeNumber(row[key]);
}

function textFromRow(row: OpenCodeRow, key: string): string | undefined {
  return text(row[key]);
}

/** OpenCode writes the session's model as JSON; older records carried an object. */
function modelFrom(value: unknown): string | undefined {
  const record = typeof value === "string" ? recordFromJsonLine(value) : value;
  if (!isRecord(record)) return undefined;
  const model = text(record.id) ?? text(record.modelID);
  if (!model) return undefined;
  const variant = text(record.variant);
  return variant ? `${model} · ${variant}` : model;
}

/**
 * OpenCode names its own sessions, and that name is what a developer is
 * looking for. The workspace is the fallback for a session too new to have
 * been named, which OpenCode marks with a placeholder timestamp rather than an
 * empty title.
 */
function sessionTitle(title: string | undefined, directory: string | undefined): string {
  const named = oneLine(title, maximumSessionTitleLength);
  if (!named || named.startsWith(OPENCODE_PLACEHOLDER_TITLE_PREFIX)) {
    return workspaceLabel(directory);
  }
  return named;
}

/**
 * Reads the turn boundary out of a message's bookkeeping. OpenCode stamps
 * `time.completed` on an assistant message when the turn ends, and records the
 * failure that ended one early — its own user stopping the turn included,
 * which is a turn that ended rather than one that is stuck.
 */
function turnFromMessage(record: Record<string, unknown>): OpenCodeTurn {
  const turn: OpenCodeTurn = { role: text(record.role) };
  const time = isRecord(record.time) ? record.time : undefined;
  turn.completed = wholeNumber(time?.completed) !== undefined;

  const error = isRecord(record.error) ? record.error : undefined;
  if (!error) return turn;
  const errorName = text(error.name);
  if (errorName === OPENCODE_ABORT_ERROR_NAME) {
    turn.aborted = true;
    return turn;
  }
  const errorData = isRecord(error.data) ? error.data : undefined;
  turn.failure =
    oneLine(text(errorData?.message), OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ??
    errorName;
  return turn;
}

/**
 * A turn that failed is stuck until someone comes back to it. Past that, the
 * last message's bookkeeping answers what recency alone cannot: an assistant
 * message whose turn ended is holding for the developer, and one still open
 * is working. A killed OpenCode process leaves an open turn on disk forever,
 * so an open turn that has gone quiet is unknown rather than still working.
 */
function statusFromTurn(
  turn: OpenCodeTurn | undefined,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (turn?.failure) return SESSION_STATUS.ERROR;
  const status =
    turn?.role === OPENCODE_ROLE.ASSISTANT && (turn.completed || turn.aborted)
      ? SESSION_STATUS.WAITING
      : SESSION_STATUS.WORKING;
  if (status === SESSION_STATUS.WORKING && now - observedAt > freshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, observedAt, now, freshnessMs);
}

/**
 * Names the tool the session is running, from the newest live tool part's own
 * bookkeeping. Only a part still pending or running counts, and a settled one
 * is passed over rather than ending the search: OpenCode runs tools
 * concurrently, so the newest tool having finished says nothing about an older
 * one still working. A stale part left running by a killed process cannot
 * reach here, because activity is only read for a session already fresh enough
 * to be working. The words of the conversation live in text parts, which are
 * never opened.
 */
function activityFromPartRows(rows: readonly OpenCodeRow[]): string | undefined {
  for (const row of rows) {
    const record = recordFromJsonLine(textFromRow(row, OPENCODE_DATA_COLUMN) ?? "");
    if (!record || record.type !== OPENCODE_PART_TYPE.TOOL) continue;
    const state = isRecord(record.state) ? record.state : undefined;
    const status = text(state?.status);
    if (status !== OPENCODE_TOOL_STATUS.PENDING && status !== OPENCODE_TOOL_STATUS.RUNNING) {
      continue;
    }
    const name = text(record.tool);
    if (!name) continue;
    const input = isRecord(state?.input) ? state.input : {};
    for (const key of OPENCODE_TOOL_INPUT_KEY) {
      const detail = oneLine(text(input[key]), OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
      if (detail) return `${name}: ${detail}`;
    }
    return name;
  }
  return undefined;
}

/**
 * The share page is the one address OpenCode publishes that names this exact
 * session, and only a session its own user chose to share carries one.
 */
function detailFromSnapshot(snapshot: OpenCodeSessionSnapshot): SessionDetail {
  return {
    ...(snapshot.activity ? { activity: snapshot.activity } : {}),
    repository: workspaceLabel(snapshot.directory),
    ...(snapshot.model ? { model: snapshot.model } : {}),
    ...(snapshot.turn?.failure ? { error: snapshot.turn.failure } : {}),
    ...(snapshot.shareUrl ? { link: snapshot.shareUrl } : {}),
  };
}

function observationFromSnapshot(
  snapshot: OpenCodeSessionSnapshot,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation {
  return {
    providerSessionId: snapshot.providerSessionId,
    title: sessionTitle(snapshot.title, snapshot.directory),
    status: statusFromTurn(snapshot.turn, snapshot.observedAt, now, activeSessionFreshnessMs),
    observedAt: snapshot.observedAt,
    detail: detailFromSnapshot(snapshot),
  };
}

function snapshotFromSessionRow(row: OpenCodeRow): OpenCodeSessionSnapshot | undefined {
  const providerSessionId = textFromRow(row, OPENCODE_SESSION_COLUMN.ID);
  if (!providerSessionId) return undefined;
  return {
    providerSessionId,
    directory: textFromRow(row, OPENCODE_SESSION_COLUMN.DIRECTORY),
    title: textFromRow(row, OPENCODE_SESSION_COLUMN.TITLE),
    model: modelFrom(row[OPENCODE_SESSION_COLUMN.MODEL]),
    shareUrl: textFromRow(row, OPENCODE_SESSION_COLUMN.SHARE_URL),
    observedAt: Math.max(
      numberFromRow(row, OPENCODE_SESSION_COLUMN.TIME_UPDATED) ?? 0,
      numberFromRow(row, OPENCODE_SESSION_COLUMN.TIME_CREATED) ?? 0,
    ),
  };
}

/**
 * A subagent's session is part of the session that spawned it, and an archived
 * session has been put away; neither is a row of its own. Both are also named
 * in the primary query's WHERE clause — this is the same reading applied to
 * rows the minimal query let through.
 */
function isObservableSessionRow(row: OpenCodeRow): boolean {
  return (
    textFromRow(row, OPENCODE_SESSION_COLUMN.PARENT_ID) === undefined &&
    numberFromRow(row, OPENCODE_SESSION_COLUMN.TIME_ARCHIVED) === undefined
  );
}

function sessionIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(OPENCODE_SESSION_FILE_EXTENSION)) return undefined;
  const providerSessionId = fileName.slice(0, -OPENCODE_SESSION_FILE_EXTENSION.length).trim();
  return providerSessionId || undefined;
}

/** Legacy storage keeps one JSON file per session inside its project directory. */
async function legacySessionFilesIn(projectDirectory: string): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name);
      if (!providerSessionId) return undefined;
      const candidate = await statDirectoryEntry(projectDirectory, entry.name);
      if (!candidate?.stats.isFile()) return undefined;
      return {
        filePath: candidate.directoryPath,
        providerSessionId,
        mtimeMs: candidate.stats.mtimeMs,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is SessionFileCandidate => candidate !== undefined,
  );
}

function defaultDataDirectory(): string {
  const dataHome = process.env[OPENCODE_ENVIRONMENT.DATA_HOME]?.trim();
  if (dataHome) return path.join(dataHome, OPENCODE_DATA_DIRECTORY_NAME);
  return path.join(os.homedir(), ...OPENCODE_DATA_HOME_SEGMENTS, OPENCODE_DATA_DIRECTORY_NAME);
}

/**
 * Observes the OpenCode sessions on this machine from the state OpenCode
 * already writes for itself: the SQLite database every install since v1.2.0
 * keeps, or the flat JSON files of the versions before it. It runs no server,
 * needs no credential, and opens everything read-only.
 */
export class OpenCodeSessionAdapter implements SessionProviderAdapter {
  readonly provider = OPENCODE_PROVIDER;

  readonly #dataDirectory: string;
  readonly #now: () => number;
  readonly #maximumSessionRows: number;
  readonly #maximumSessionAgeMs: number;
  readonly #activeSessionFreshnessMs: number;
  readonly #sqlite: SqliteModuleLoader;

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.#dataDirectory = options.dataDirectory ?? defaultDataDirectory();
    this.#now = options.now ?? Date.now;
    const resolved = resolveOptions(
      options,
      {
        maximumSessionRows: OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_SESSION_ROWS,
        maximumSessionAgeMs: OBSERVATION_WINDOW.MAXIMUM_SESSION_AGE_MS,
        activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
      },
      {
        positive: ["maximumSessionRows"],
        nonNegative: ["maximumSessionAgeMs", "activeSessionFreshnessMs"],
      },
    );
    this.#maximumSessionRows = resolved.maximumSessionRows;
    this.#maximumSessionAgeMs = resolved.maximumSessionAgeMs;
    this.#activeSessionFreshnessMs = resolved.activeSessionFreshnessMs;
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    for (const databasePath of this.#databasePaths()) {
      const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (!database) continue;
      let snapshots: OpenCodeSessionSnapshot[] | undefined;
      let now = 0;
      try {
        now = this.#now();
        snapshots = this.#databaseSnapshots(database, now);
      } finally {
        database.close();
      }
      // A database whose schema was unusable answers nothing; the next
      // candidate, or the legacy files, may still answer.
      if (snapshots === undefined) continue;
      const existingSnapshots = (
        await Promise.all(
          snapshots.map(async (snapshot) =>
            (await existingWorkspaceDirectory(snapshot.directory)) ? snapshot : undefined,
          ),
        )
      ).filter((snapshot): snapshot is OpenCodeSessionSnapshot => snapshot !== undefined);
      return existingSnapshots.map((snapshot) =>
        observationFromSnapshot(snapshot, now, this.#activeSessionFreshnessMs),
      );
    }
    return this.#legacyObservations();
  }

  /**
   * Where the database may be, most authoritative first: wherever
   * `OPENCODE_DB` points, then the file every release channel writes, then the
   * one prod-channel builds briefly wrote.
   */
  #databasePaths(): string[] {
    const configured = process.env[OPENCODE_ENVIRONMENT.DATABASE_FILE]?.trim();
    const configuredPath =
      configured && configured !== OPENCODE_MEMORY_DATABASE
        ? path.isAbsolute(configured)
          ? configured
          : path.join(this.#dataDirectory, configured)
        : undefined;
    return uniquePaths(
      [
        configuredPath,
        path.join(this.#dataDirectory, OPENCODE_DATABASE_FILE.CURRENT),
        path.join(this.#dataDirectory, OPENCODE_DATABASE_FILE.PROD_CHANNEL),
      ].filter((candidate): candidate is string => candidate !== undefined),
    );
  }

  /** The session rows, or nothing when neither query fits this database. */
  #sessionRows(database: SqliteDatabase): OpenCodeRow[] | undefined {
    for (const query of [OPENCODE_SESSION_QUERY, OPENCODE_SESSION_QUERY_MINIMAL]) {
      try {
        return database
          .prepare(query)
          .all(this.#maximumSessionRows)
          .filter((row): row is OpenCodeRow => isRecord(row));
      } catch (error) {
        if (!canIgnoreSqliteError(error)) throw error;
      }
    }
    return undefined;
  }

  #databaseSnapshots(database: SqliteDatabase, now: number): OpenCodeSessionSnapshot[] | undefined {
    const rows = this.#sessionRows(database);
    if (rows === undefined) return undefined;

    const snapshots = rows
      .filter(isObservableSessionRow)
      .map(snapshotFromSessionRow)
      .filter((snapshot): snapshot is OpenCodeSessionSnapshot => snapshot !== undefined)
      .filter((snapshot) => now - snapshot.observedAt <= this.#maximumSessionAgeMs);

    // Every reported session gets its turn read, because a session without one
    // would default to working on freshness alone — inventing live work for a
    // row whose turn actually ended. The pass stays bounded the way the Claude
    // Code adapter's is: each read is an indexed point query against the row
    // cap above, not a scan.
    for (const snapshot of snapshots) {
      snapshot.turn = this.#turnFor(database, snapshot.providerSessionId);
      if (
        statusFromTurn(snapshot.turn, snapshot.observedAt, now, this.#activeSessionFreshnessMs) ===
        SESSION_STATUS.WORKING
      ) {
        snapshot.activity = this.#activityFor(database, snapshot.providerSessionId);
      }
    }
    return snapshots;
  }

  /** The last message's bookkeeping, or nothing this build can read. */
  #turnFor(database: SqliteDatabase, providerSessionId: string): OpenCodeTurn | undefined {
    const row = this.#rowsFor(database, OPENCODE_LAST_MESSAGE_QUERY, [providerSessionId])[0];
    const record = row
      ? recordFromJsonLine(textFromRow(row, OPENCODE_DATA_COLUMN) ?? "")
      : undefined;
    return record ? turnFromMessage(record) : undefined;
  }

  #activityFor(database: SqliteDatabase, providerSessionId: string): string | undefined {
    return activityFromPartRows(
      this.#rowsFor(database, OPENCODE_RECENT_PART_QUERY, [
        providerSessionId,
        OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_PART_ROWS,
      ]),
    );
  }

  /** A message or part table this build cannot read costs a field, not the pass. */
  #rowsFor(database: SqliteDatabase, query: string, parameters: readonly unknown[]): OpenCodeRow[] {
    try {
      return database
        .prepare(query)
        .all(...parameters)
        .filter((row): row is OpenCodeRow => isRecord(row));
    } catch (error) {
      if (canIgnoreSqliteError(error)) return [];
      throw error;
    }
  }

  async #legacyObservations(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.#now();
    const storageDirectory = path.join(this.#dataDirectory, OPENCODE_STORAGE_DIRECTORY);
    const candidates = (
      await discoverSessionFiles({
        projectsDirectory: path.join(storageDirectory, OPENCODE_STORAGE_SEGMENT.SESSION),
        maximumProjectDirectories: OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
        maximumSessionFiles: this.#maximumSessionRows,
        sessionFilesIn: legacySessionFilesIn,
      })
    ).filter((candidate) => now - candidate.mtimeMs <= this.#maximumSessionAgeMs);

    const observations = new Map<string, ProviderSessionObservation>();
    for (const candidate of candidates) {
      if (observations.has(candidate.providerSessionId)) continue;
      const info = recordFromJsonLine((await readTextFile(candidate.filePath)) ?? "");
      if (!info) continue;
      if (text(info.parentID)) continue;

      const time = isRecord(info.time) ? info.time : undefined;
      const snapshot: OpenCodeSessionSnapshot = {
        providerSessionId: candidate.providerSessionId,
        directory: text(info.directory),
        title: text(info.title),
        model: modelFrom(info.model),
        shareUrl: isRecord(info.share) ? text(info.share.url) : undefined,
        observedAt: Math.max(
          candidate.mtimeMs,
          wholeNumber(time?.updated) ?? 0,
          wholeNumber(time?.created) ?? 0,
        ),
      };
      if (!(await existingWorkspaceDirectory(snapshot.directory))) continue;
      // Read for every reported session, not a capped few: a session without
      // its turn would default to working on freshness alone. Each read is one
      // directory listing and one small file, against the same session cap the
      // Claude Code adapter pays a bounded tail read for.
      snapshot.turn = await this.#legacyTurn(storageDirectory, candidate.providerSessionId);
      observations.set(
        candidate.providerSessionId,
        observationFromSnapshot(snapshot, now, this.#activeSessionFreshnessMs),
      );
    }
    return [...observations.values()];
  }

  /**
   * The newest message file's bookkeeping. OpenCode's message identifiers sort
   * in creation order, so the greatest file name is the newest message and no
   * second directory pass is needed to find it.
   */
  async #legacyTurn(
    storageDirectory: string,
    providerSessionId: string,
  ): Promise<OpenCodeTurn | undefined> {
    const messagesDirectory = path.join(
      storageDirectory,
      OPENCODE_STORAGE_SEGMENT.MESSAGE,
      providerSessionId,
    );
    const newest = (await readDirectory(messagesDirectory))
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(OPENCODE_SESSION_FILE_EXTENSION))
      .sort()
      .at(-1);
    if (!newest) return undefined;
    const record = recordFromJsonLine(
      (await readTextFile(path.join(messagesDirectory, newest))) ?? "",
    );
    return record ? turnFromMessage(record) : undefined;
  }
}
