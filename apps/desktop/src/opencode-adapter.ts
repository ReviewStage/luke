import os from "node:os";
import path from "node:path";
import {
  isRecord,
  maximumSessionTitleLength,
  oneLine,
  PROVIDER_ID,
  type ProviderSessionObservation,
  recordFromJsonLine,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
  text,
  wholeNumber,
} from "@sidecar/core";
import {
  discoverSessionFiles,
  fileStats,
  LocalSessionAdapter,
  localSessionStatus,
  readDirectory,
  readTextFile,
  type SessionFileCandidate,
  sessionIdFromFileName,
  statDirectoryEntry,
  uniquePaths,
  workspaceLabel,
} from "./local-session-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "./local-sqlite";
import { boundedTranscript, TRANSCRIPT_BOUNDS } from "./local-transcript";

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
export const OPENCODE_TOOL_INPUT_KEY = [
  "description",
  "command",
  "filePath",
  "file_path",
  "pattern",
  "query",
] as const;

const OPENCODE_ADAPTER_DEFAULTS = {
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
`;

// The WHERE clause above is the one thing that can name a column an old schema
// lacks, so a database it fails on is asked again with the filters moved into
// code, where an absent column is one missing field rather than no sessions.
const OPENCODE_SESSION_QUERY_MINIMAL = `
  SELECT *
  FROM session
  ORDER BY time_updated DESC, id DESC
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
  activeSessionFreshnessMs?: number;
  sqlite?: SqliteModuleLoader;
  transcriptMaximumRenderedLength?: number;
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
  return localSessionStatus(status, observedAt, now, freshnessMs);
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

/** Legacy storage keeps one JSON file per session inside its project directory. */
async function legacySessionFilesIn(projectDirectory: string): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name, OPENCODE_SESSION_FILE_EXTENSION);
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

export function defaultOpenCodeDataDirectory(): string {
  const dataHome = process.env[OPENCODE_ENVIRONMENT.DATA_HOME]?.trim();
  if (dataHome) return path.join(dataHome, OPENCODE_DATA_DIRECTORY_NAME);
  return path.join(os.homedir(), ...OPENCODE_DATA_HOME_SEGMENTS, OPENCODE_DATA_DIRECTORY_NAME);
}

/**
 * Where the database may be, most authoritative first: wherever `OPENCODE_DB`
 * points, then the file every release channel writes, then the one
 * prod-channel builds briefly wrote.
 */
export function openCodeDatabasePaths(dataDirectory: string): string[] {
  const configured = process.env[OPENCODE_ENVIRONMENT.DATABASE_FILE]?.trim();
  const configuredPath =
    configured && configured !== OPENCODE_MEMORY_DATABASE
      ? path.isAbsolute(configured)
        ? configured
        : path.join(dataDirectory, configured)
      : undefined;
  return uniquePaths(
    [
      configuredPath,
      path.join(dataDirectory, OPENCODE_DATABASE_FILE.CURRENT),
      path.join(dataDirectory, OPENCODE_DATABASE_FILE.PROD_CHANNEL),
    ].filter((candidate): candidate is string => candidate !== undefined),
  );
}

/**
 * Observes the OpenCode sessions on this machine from the state OpenCode
 * already writes for itself: the SQLite database every install since v1.2.0
 * keeps, or the flat JSON files of the versions before it. It runs no server,
 * needs no credential, and opens everything read-only.
 */
export class OpenCodeSessionAdapter extends LocalSessionAdapter {
  readonly provider = OPENCODE_PROVIDER;

  readonly #dataDirectory: string;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  /**
   * What each legacy file said as of the mtime it was read at. Sessions are
   * never capped, so this is what keeps the no-database fallback's pass cheap:
   * a session's info file is re-read only when it has been written to, and its
   * turn only when a newer message file exists or the newest was written to —
   * OpenCode moves that file's clock whenever it moves the turn's bookkeeping.
   */
  readonly #legacyInfo = new Map<
    string,
    { mtimeMs: number; info: Record<string, unknown> | undefined }
  >();
  readonly #legacyTurns = new Map<
    string,
    { filePath: string; mtimeMs: number; turn: OpenCodeTurn | undefined }
  >();

  constructor(options: OpenCodeAdapterOptions = {}) {
    super(options);
    this.#dataDirectory = options.dataDirectory ?? defaultOpenCodeDataDirectory();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    for (const databasePath of openCodeDatabasePaths(this.#dataDirectory)) {
      const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (!database) continue;
      let snapshots: OpenCodeSessionSnapshot[] | undefined;
      let now = 0;
      try {
        now = this.observationTime();
        snapshots = this.#databaseSnapshots(database, now);
      } finally {
        database.close();
      }
      // A database whose schema was unusable answers nothing; the next
      // candidate, or the legacy files, may still answer.
      if (snapshots === undefined) continue;
      return snapshots.map((snapshot) =>
        observationFromSnapshot(snapshot, now, this.activeSessionFreshnessMs),
      );
    }
    return this.#legacyObservations();
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return OpenCodeTranscript.read({
      dataDirectory: this.#dataDirectory,
      providerSessionId,
      sqlite: this.#sqlite,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }

  /** The session rows, or nothing when neither query fits this database. */
  #sessionRows(database: SqliteDatabase): OpenCodeRow[] | undefined {
    for (const query of [OPENCODE_SESSION_QUERY, OPENCODE_SESSION_QUERY_MINIMAL]) {
      try {
        return database
          .prepare(query)
          .all()
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
      .filter((snapshot): snapshot is OpenCodeSessionSnapshot => snapshot !== undefined);

    // Every reported session gets its turn read, because a session without one
    // would default to working on freshness alone — inventing live work for a
    // row whose turn actually ended. Each read is an indexed point query
    // against one session's id, not a scan, so the pass costs one cheap query
    // per row however many rows the database holds.
    for (const snapshot of snapshots) {
      snapshot.turn = this.#turnFor(database, snapshot.providerSessionId);
      if (
        statusFromTurn(snapshot.turn, snapshot.observedAt, now, this.activeSessionFreshnessMs) ===
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
    const now = this.observationTime();
    const storageDirectory = path.join(this.#dataDirectory, OPENCODE_STORAGE_DIRECTORY);
    const candidates = await discoverSessionFiles({
      projectsDirectory: path.join(storageDirectory, OPENCODE_STORAGE_SEGMENT.SESSION),
      maximumProjectDirectories: OPENCODE_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
      sessionFilesIn: legacySessionFilesIn,
    });

    const observations = new Map<string, ProviderSessionObservation>();
    for (const candidate of candidates) {
      if (observations.has(candidate.providerSessionId)) continue;
      const info = await this.#legacyInfoFor(candidate);
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
      // Read for every reported session, not a capped few: a session without
      // its turn would default to working on freshness alone. Steady state,
      // each read is one directory listing and one stat — the caches above
      // pay a file read only for what actually changed.
      snapshot.turn = await this.#legacyTurn(storageDirectory, candidate.providerSessionId);
      observations.set(
        candidate.providerSessionId,
        observationFromSnapshot(snapshot, now, this.activeSessionFreshnessMs),
      );
    }

    // A file no longer discovered was deleted, so its parse must not outlive it.
    const discoveredFiles = new Set(candidates.map((candidate) => candidate.filePath));
    for (const filePath of this.#legacyInfo.keys()) {
      if (!discoveredFiles.has(filePath)) this.#legacyInfo.delete(filePath);
    }
    const discoveredSessions = new Set(candidates.map((candidate) => candidate.providerSessionId));
    for (const providerSessionId of this.#legacyTurns.keys()) {
      if (!discoveredSessions.has(providerSessionId)) this.#legacyTurns.delete(providerSessionId);
    }

    return [...observations.values()];
  }

  /** The session's own record, re-read only when its file has been written to. */
  async #legacyInfoFor(
    candidate: SessionFileCandidate,
  ): Promise<Record<string, unknown> | undefined> {
    const cached = this.#legacyInfo.get(candidate.filePath);
    if (cached && cached.mtimeMs === candidate.mtimeMs) return cached.info;
    const info = recordFromJsonLine((await readTextFile(candidate.filePath)) ?? "");
    this.#legacyInfo.set(candidate.filePath, { mtimeMs: candidate.mtimeMs, info });
    return info;
  }

  /**
   * The newest message file's bookkeeping. OpenCode's message identifiers sort
   * in creation order, so the greatest file name is the newest message and no
   * second directory pass is needed to find it. The file is re-read only when
   * a newer message exists or this one's clock has moved: OpenCode rewrites a
   * message's file as its turn opens, aborts, fails, and completes.
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
    const filePath = path.join(messagesDirectory, newest);
    const mtimeMs = (await fileStats(filePath))?.mtimeMs ?? 0;
    const cached = this.#legacyTurns.get(providerSessionId);
    if (cached && cached.filePath === filePath && cached.mtimeMs === mtimeMs) return cached.turn;
    const record = recordFromJsonLine((await readTextFile(filePath)) ?? "");
    const turn = record ? turnFromMessage(record) : undefined;
    this.#legacyTurns.set(providerSessionId, { filePath, mtimeMs, turn });
    return turn;
  }
}

namespace OpenCodeTranscript {
  /**
   * On-demand reading of one OpenCode session's transcript, for a question the
   * developer just asked. The message and part rows in OpenCode's own database
   * are the transcript — the same tables the adapter reads bookkeeping from,
   * here opened for their words: a bounded slice of the newest messages, read
   * through parameterized point queries against the read-only handle, rendered
   * into a bounded conversation, and discarded. Nothing here is retained,
   * watched, or written; a session is re-read the next time it is asked about.
   *
   * Installs from before OpenCode moved its sessions into the database keep
   * their conversations in per-part JSON files this build does not read, so a
   * legacy session answers as no transcript rather than a partial one.
   */

  const OPENCODE_SPEAKER_NAME = "OpenCode";

  const OPENCODE_DATA_COLUMN = "data";

  const OPENCODE_MESSAGE_ROLE = {
    USER: "user",
    ASSISTANT: "assistant",
  } as const;

  const OPENCODE_PART_TYPE = {
    TEXT: "text",
    TOOL: "tool",
  } as const;

  /** The tool states whose bookkeeping carries an answer worth a line. */
  const OPENCODE_TOOL_STATUS = {
    COMPLETED: "completed",
    ERROR: "error",
  } as const;

  /**
   * The error OpenCode records when its own user stops a turn. A stopped turn
   * is something the developer did, not something that happened to them, so it
   * takes no error line.
   */
  const OPENCODE_ABORT_ERROR_NAME = "MessageAbortedError";

  const OPENCODE_TRANSCRIPT_BOUNDS = {
    /** How many of the session's newest messages one read may load. */
    MAXIMUM_MESSAGES: 40,
    /** How many of a message's parts one read may load. */
    MAXIMUM_PARTS: 32,
  } as const;

  /** Newest first, so the bound keeps the turns the question is about. */
  const OPENCODE_RECENT_MESSAGE_QUERY = `
    SELECT *
    FROM message
    WHERE session_id = ?
    ORDER BY time_created DESC, id DESC
    LIMIT ?
  `;

  // Newest first here too: a tool-heavy turn can outgrow the bound, and the
  // concluding words sit on its newest parts. Ordered by the row's own clock
  // before its id, like every other query over these tables — ids sort in
  // creation order only until their timestamp half wraps — and put back in the
  // order they were said before rendering.
  const OPENCODE_MESSAGE_PART_QUERY = `
    SELECT *
    FROM part
    WHERE message_id = ?
    ORDER BY time_created DESC, id DESC
    LIMIT ?
  `;

  type OpenCodeRow = Record<string, unknown>;

  interface Request {
    dataDirectory?: string;
    providerSessionId: string;
    sqlite?: SqliteModuleLoader;
    maximumRenderedLength?: number;
  }

  function rowData(row: OpenCodeRow): Record<string, unknown> | undefined {
    return recordFromJsonLine(text(row[OPENCODE_DATA_COLUMN]) ?? "");
  }

  function toolLine(part: Record<string, unknown>): string[] {
    const name = text(part.tool);
    if (!name) return [];
    const state = isRecord(part.state) ? part.state : {};
    const input = isRecord(state.input) ? state.input : {};
    let call = `→ ${name}`;
    for (const key of OPENCODE_TOOL_INPUT_KEY) {
      const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (detail) {
        call = `→ ${name}: ${detail}`;
        break;
      }
    }
    const answer =
      state.status === OPENCODE_TOOL_STATUS.COMPLETED
        ? oneLine(text(state.output), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
        : state.status === OPENCODE_TOOL_STATUS.ERROR
          ? oneLine(text(state.error), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
          : undefined;
    return answer ? [call, `← ${answer}`] : [call];
  }

  /**
   * The failure that ended a message's turn early, in the provider's words. An
   * abort is left out: the developer stopping a turn is not news to them.
   */
  function errorLine(data: Record<string, unknown>): string | undefined {
    const error = isRecord(data.error) ? data.error : undefined;
    if (!error || error.name === OPENCODE_ABORT_ERROR_NAME) return undefined;
    const errorData = isRecord(error.data) ? error.data : undefined;
    const words = oneLine(
      text(errorData?.message) ?? text(error.name),
      TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
    );
    return words ? `Error: ${words}` : undefined;
  }

  /**
   * Renders one message and its parts into the lines a conversation can carry.
   * A text part's words are the message's own — the role rides the message row,
   * not the part — and a synthetic or ignored text part is OpenCode's own
   * scaffolding, not something anyone said.
   */
  function linesFromMessage(
    data: Record<string, unknown>,
    parts: readonly OpenCodeRow[],
  ): string[] {
    const role = text(data.role);
    if (role !== OPENCODE_MESSAGE_ROLE.USER && role !== OPENCODE_MESSAGE_ROLE.ASSISTANT) return [];
    const speaker = role === OPENCODE_MESSAGE_ROLE.USER ? "Developer" : OPENCODE_SPEAKER_NAME;

    const lines: string[] = [];
    const spokenParts: string[] = [];
    for (const row of parts) {
      const part = rowData(row);
      if (!part) continue;
      if (part.type === OPENCODE_PART_TYPE.TEXT) {
        if (part.synthetic === true || part.ignored === true) continue;
        const words = text(part.text);
        if (words) spokenParts.push(words);
        continue;
      }
      if (part.type === OPENCODE_PART_TYPE.TOOL && role === OPENCODE_MESSAGE_ROLE.ASSISTANT) {
        lines.push(...toolLine(part));
      }
    }
    const said = oneLine(spokenParts.join(" "), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (said) lines.unshift(`${speaker}: ${said}`);

    const failure = errorLine(data);
    if (failure) lines.push(failure);
    return lines;
  }

  function readRows(
    database: SqliteDatabase,
    query: string,
    parameters: readonly unknown[],
  ): OpenCodeRow[] {
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

  function renderedFromDatabase(
    database: SqliteDatabase,
    providerSessionId: string,
    maximumLength: number,
  ): string | undefined {
    const messages = readRows(database, OPENCODE_RECENT_MESSAGE_QUERY, [
      providerSessionId,
      OPENCODE_TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGES,
    ]).toReversed();
    const lines = messages.flatMap((message) => {
      const data = rowData(message);
      const messageId = text(message.id);
      if (!data || !messageId) return [];
      const parts = readRows(database, OPENCODE_MESSAGE_PART_QUERY, [
        messageId,
        OPENCODE_TRANSCRIPT_BOUNDS.MAXIMUM_PARTS,
      ]).toReversed();
      return linesFromMessage(data, parts);
    });
    return boundedTranscript(lines, maximumLength);
  }

  /**
   * Reads one session's recent transcript into a bounded rendering, or nothing
   * when no database holds messages for that id.
   */
  export async function read(request: Request): Promise<string | undefined> {
    const dataDirectory = request.dataDirectory ?? defaultOpenCodeDataDirectory();
    const sqlite = request.sqlite ?? defaultSqliteModule;
    for (const databasePath of openCodeDatabasePaths(dataDirectory)) {
      const database = await openReadOnlyDatabase(sqlite, databasePath);
      if (!database) continue;
      try {
        const rendered = renderedFromDatabase(
          database,
          request.providerSessionId,
          request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
        );
        if (rendered) return rendered;
      } finally {
        database.close();
      }
    }
    return undefined;
  }
}
