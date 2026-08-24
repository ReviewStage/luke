import path from "node:path";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  providerTranscriptResult,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import {
  isRecord,
  oneLine,
  recordFromJsonLine,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import {
  discoverSessionFiles,
  fileStats,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  LocalSessionAdapter,
  type LocalSessionAdapterOptions,
  localSessionStatus,
  readDirectory,
  readTail,
  readTextFile,
  type SessionFileCandidate,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import {
  defaultGrokBuildHome,
  GROK_DATABASE_FILE,
  GROK_EVENT_TYPE,
  GROK_MESSAGE_COLUMN,
  GROK_MESSAGE_PART,
  GROK_MESSAGE_ROLE,
  GROK_PHASE,
  GROK_SESSION_COLUMN,
  GROK_SESSION_FILE,
  GROK_SESSIONS_DIRECTORY,
  GROK_SETTLED_TOOL_STATUSES,
  GROK_STOP_REASON,
  GROK_TURN_OUTCOME,
  GROK_UPDATE_KIND,
  grokContentText,
  grokMessageParts,
  grokToolDetail,
  grokToolInputDetail,
  grokToolName,
  grokUpdateFrom,
  grokUpdateKind,
} from "./records.js";
import { GROK_SESSION_ID_PATTERN, readGrokBuildSessionTranscript } from "./transcript.js";

const GROK_BUILD_PROVIDER_ID = PROVIDER_ID.GROK_BUILD;
const GROK_BUILD_PROVIDER_NAME = "Grok Build";

const GROK_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

export const GROK_BUILD_PROVIDER: SessionProvider = {
  id: GROK_BUILD_PROVIDER_ID,
  displayName: GROK_BUILD_PROVIDER_NAME,
};

export interface GrokBuildAdapterOptions {
  grokHome?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
  transcriptMaximumRenderedLength?: number;
  sqlite?: SqliteModuleLoader;
}

/**
 * Whose move the lifecycle log says it is. `events.jsonl` is the CLI's own
 * record of every turn boundary, so the newest event is the answer: a
 * `turn_ended` is a settled turn or a recorded failure, a permission request
 * with nothing after it is a prompt still on the developer's screen, and any
 * other event is a turn still moving.
 */
const GROK_SESSION_TIP = {
  WORKING: "working",
  HOLDING: "holding",
  SETTLED: "settled",
  ERROR: "error",
} as const;

type GrokSessionTip = (typeof GROK_SESSION_TIP)[keyof typeof GROK_SESSION_TIP];

interface ParsedGrokSession {
  title?: string;
  model?: string;
  cwd?: string;
  timestampMs?: number;
  tip: GrokSessionTip;
  turnCompleted?: boolean;
  activity?: string;
  failure?: string;
  recap?: string;
}

function timestampMsFrom(record: WireRecord): number | undefined {
  const stamp = text(record.ts);
  if (stamp === undefined) return undefined;
  const stampMs = Date.parse(stamp);
  return Number.isFinite(stampMs) ? stampMs : undefined;
}

/**
 * The lifecycle log's own clock: the newest stamp on any event in the slice,
 * because each proved the session moved when it was written. The summary's
 * own clock stands in for a session whose slice holds no stamped event.
 */
function eventsClockMs(events: readonly WireRecord[]): number | undefined {
  let clock: number | undefined;
  for (const event of events) {
    const stamp = timestampMsFrom(event);
    if (stamp !== undefined && (clock === undefined || stamp > clock)) clock = stamp;
  }
  return clock;
}

interface GrokTurnTip {
  tip: GrokSessionTip;
  turnCompleted?: boolean;
}

function tipFromEvents(events: readonly WireRecord[]): GrokTurnTip {
  for (const event of [...events].reverse()) {
    const type = text(event.type);
    if (type === undefined) continue;
    if (type === GROK_EVENT_TYPE.TURN_ENDED) {
      const outcome = text(event.outcome);
      if (outcome === GROK_TURN_OUTCOME.ERROR) return { tip: GROK_SESSION_TIP.ERROR };
      return {
        tip: GROK_SESSION_TIP.SETTLED,
        turnCompleted: outcome === GROK_TURN_OUTCOME.COMPLETED,
      };
    }
    if (type === GROK_EVENT_TYPE.PERMISSION_REQUESTED) return { tip: GROK_SESSION_TIP.HOLDING };
    if (type === GROK_EVENT_TYPE.PHASE_CHANGED) {
      return text(event.phase) === GROK_PHASE.PERMISSION_PROMPT
        ? { tip: GROK_SESSION_TIP.HOLDING }
        : { tip: GROK_SESSION_TIP.WORKING };
    }
    // A resolved permission, a tool boundary, a turn or loop start: the CLI
    // recorded motion, so the turn is still moving.
    return { tip: GROK_SESSION_TIP.WORKING };
  }
  return { tip: GROK_SESSION_TIP.WORKING };
}

/**
 * A settled turn's parting words, read from the conversation log's tail: the
 * agent message chunks standing immediately before the closing
 * `turn_completed`, which are the stream deltas of the turn's final reply. A
 * turn that ended any other way left no parting words worth a recap.
 */
function recapFromUpdates(updates: readonly WireRecord[]): string | undefined {
  const chunks: string[] = [];
  let sawTurnCompleted = false;
  for (const record of [...updates].reverse()) {
    const update = grokUpdateFrom(record);
    if (!update) continue;
    const kind = grokUpdateKind(update);
    if (!sawTurnCompleted) {
      if (kind !== GROK_UPDATE_KIND.TURN_COMPLETED) return undefined;
      sawTurnCompleted = true;
      continue;
    }
    if (kind !== GROK_UPDATE_KIND.AGENT_MESSAGE_CHUNK) break;
    const words = grokContentText(update.content);
    if (words !== undefined) chunks.unshift(words);
  }
  // Chunks are stream deltas of one message, so they join without separators.
  return oneLine(chunks.join(""), maximumSessionRecapLength);
}

/** The words of the failure the CLI recorded on the turn's closing update. */
function failureFromUpdates(updates: readonly WireRecord[]): string | undefined {
  for (const record of [...updates].reverse()) {
    const update = grokUpdateFrom(record);
    if (!update) continue;
    if (grokUpdateKind(update) !== GROK_UPDATE_KIND.TURN_COMPLETED) return undefined;
    if (text(update.stop_reason) !== GROK_STOP_REASON.ERROR) return undefined;
    return oneLine(text(update.agent_result), GROK_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
  }
  return undefined;
}

/**
 * Names the tool the session is running now: the newest tool call in the
 * conversation log that has not settled. A settled newest call means the turn
 * has moved past its tools.
 */
function activityFromUpdates(updates: readonly WireRecord[]): string | undefined {
  for (const record of [...updates].reverse()) {
    const update = grokUpdateFrom(record);
    if (!update) continue;
    const kind = grokUpdateKind(update);
    if (kind !== GROK_UPDATE_KIND.TOOL_CALL && kind !== GROK_UPDATE_KIND.TOOL_CALL_UPDATE) {
      continue;
    }
    const status = text(update.status);
    if (status !== undefined && GROK_SETTLED_TOOL_STATUSES.has(status)) return undefined;
    const name = grokToolName(update);
    if (!name) return undefined;
    const detail = grokToolDetail(update, GROK_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
    return detail ? `${name}: ${detail}` : name;
  }
  return undefined;
}

interface ParsedGrokSummary {
  title?: string;
  model?: string;
  cwd?: string;
  timestampMs?: number;
}

function parseGrokSummary(document: string | undefined): ParsedGrokSummary {
  if (!document) return {};
  let record: WireRecord | undefined;
  try {
    // SAFETY: JSON.parse returns a runtime value; isRecord validates the object contract.
    const parsed = JSON.parse(document) as UnparsedWireValue;
    record = isRecord(parsed) ? parsed : undefined;
  } catch {
    record = undefined;
  }
  if (!record) return {};
  const info = isRecord(record.info) ? record.info : undefined;
  const lastActiveAt = text(record.last_active_at) ?? text(record.updated_at);
  const lastActiveAtMs = lastActiveAt === undefined ? undefined : Date.parse(lastActiveAt);
  return {
    title: text(record.generated_title) ?? text(record.session_summary),
    model: text(record.current_model_id),
    cwd: info ? text(info.cwd) : undefined,
    timestampMs:
      lastActiveAtMs !== undefined && Number.isFinite(lastActiveAtMs) ? lastActiveAtMs : undefined,
  };
}

export function parseGrokSessionState(
  summaryDocument: string | undefined,
  eventsTail: string,
  updatesTail: string,
): ParsedGrokSession {
  const summary = parseGrokSummary(summaryDocument);
  const events = tailRecords(eventsTail);
  const updates = tailRecords(updatesTail);
  const { tip, turnCompleted } = tipFromEvents(events);
  return {
    ...summary,
    timestampMs: eventsClockMs(events) ?? summary.timestampMs,
    tip,
    ...(turnCompleted !== undefined ? { turnCompleted } : undefined),
    ...(tip === GROK_SESSION_TIP.ERROR ? { failure: failureFromUpdates(updates) } : undefined),
    // A recap only for a turn that completed: a cancelled or denied turn was
    // cut mid-thought, so its trailing words pose as an outcome they are not.
    ...(tip === GROK_SESSION_TIP.SETTLED && turnCompleted === true
      ? { recap: recapFromUpdates(updates) }
      : undefined),
    ...(tip === GROK_SESSION_TIP.WORKING || tip === GROK_SESSION_TIP.HOLDING
      ? { activity: activityFromUpdates(updates) }
      : undefined),
  };
}

/**
 * A turn that stopped on an error the CLI recorded is stuck until someone
 * comes back to it. A permission prompt still open, or a turn that ended, is
 * holding for the developer; anything else is working. A killed process
 * leaves its last lifecycle event on disk forever, so an open turn gone quiet
 * is unknown rather than still working. Nothing in the store marks a session
 * closed, so a local Grok Build session is never complete.
 */
function statusFromTip(
  tip: GrokSessionTip,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (tip === GROK_SESSION_TIP.ERROR) return SESSION_STATUS.ERROR;
  const status =
    tip === GROK_SESSION_TIP.HOLDING || tip === GROK_SESSION_TIP.SETTLED
      ? SESSION_STATUS.WAITING
      : SESSION_STATUS.WORKING;
  return localSessionStatus(status, observedAt, now, freshnessMs);
}

interface GrokSessionCandidate extends SessionFileCandidate {
  projectDirectory: string;
}

/**
 * The sessions directly inside one percent-encoded working-directory
 * directory. A session is a directory named by its UUID; the store's own
 * bookkeeping beside them — the per-directory prompt history, the search
 * index — is not a session and is not read. The candidate is placed in time
 * by the newest of the three recordings this adapter reads, because the
 * directory's own mtime stops moving once the files exist.
 */
async function sessionDirectoriesIn(
  projectDirectory: string,
  project: { directoryPath: string },
): Promise<GrokSessionCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      if (!GROK_SESSION_ID_PATTERN.test(entry.name)) return undefined;
      const sessionDirectory = await statDirectoryEntry(projectDirectory, entry.name);
      if (!sessionDirectory?.stats.isDirectory()) return undefined;
      const recordings = await Promise.all(
        Object.values(GROK_SESSION_FILE).map((name) =>
          fileStats(path.join(sessionDirectory.directoryPath, name)),
        ),
      );
      const mtimeMs = recordings.reduce<number | undefined>(
        (newest, stats) =>
          stats?.isFile() && (newest === undefined || stats.mtimeMs > newest)
            ? stats.mtimeMs
            : newest,
        undefined,
      );
      if (mtimeMs === undefined) return undefined;
      return {
        filePath: sessionDirectory.directoryPath,
        providerSessionId: entry.name,
        mtimeMs,
        projectDirectory: project.directoryPath,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is GrokSessionCandidate => candidate !== undefined,
  );
}

/**
 * The workspace a session observes: the working directory the session's own
 * summary names, or the percent-encoded directory name decoded when the
 * summary has not been written yet.
 */
function workspaceFrom(cwd: string | undefined, projectDirectory: string): string {
  if (cwd?.trim()) return workspaceLabel(cwd);
  try {
    return workspaceLabel(decodeURIComponent(path.basename(projectDirectory)));
  } catch {
    return workspaceLabel(undefined);
  }
}

function detailFrom(parsed: ParsedGrokSession, workspace: string): SessionDetail {
  return {
    ...(parsed.activity ? { activity: parsed.activity } : undefined),
    repository: workspace,
    ...(parsed.model ? { model: parsed.model } : undefined),
    ...(parsed.failure ? { error: parsed.failure } : undefined),
  };
}

/**
 * The 1.0.x directory store, still the whole answer on a machine whose CLI
 * never wrote the database.
 */
class GrokBuildLegacySessionStore extends LocalFileSessionAdapter<
  GrokSessionCandidate,
  ParsedGrokSession
> {
  readonly provider = GROK_BUILD_PROVIDER;

  readonly #grokHome: string;

  constructor(grokHome: string, options: LocalSessionAdapterOptions) {
    super(options);
    this.#grokHome = grokHome;
  }

  protected discover(): Promise<GrokSessionCandidate[]> {
    return discoverSessionFiles({
      projectsDirectory: path.join(this.#grokHome, GROK_SESSIONS_DIRECTORY),
      maximumProjectDirectories: GROK_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
      sessionFilesIn: sessionDirectoriesIn,
    });
  }

  protected async parse(candidate: GrokSessionCandidate): Promise<ParsedGrokSession> {
    const [summaryDocument, eventsTail, updatesTail] = await Promise.all([
      readTextFile(path.join(candidate.filePath, GROK_SESSION_FILE.SUMMARY)),
      readTail(
        path.join(candidate.filePath, GROK_SESSION_FILE.EVENTS),
        LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
      ),
      readTail(
        path.join(candidate.filePath, GROK_SESSION_FILE.UPDATES),
        LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
      ),
    ]);
    return parseGrokSessionState(summaryDocument, eventsTail, updatesTail);
  }

  protected observation(
    candidate: GrokSessionCandidate,
    parsed: ParsedGrokSession,
    now: number,
    activeSessionFreshnessMs: number,
  ): ProviderSessionObservation {
    const workspace = workspaceFrom(parsed.cwd, candidate.projectDirectory);
    const observedAt = parsed.timestampMs ?? candidate.mtimeMs;
    const status = statusFromTip(parsed.tip, observedAt, now, activeSessionFreshnessMs);
    return {
      providerSessionId: candidate.providerSessionId,
      title: oneLine(parsed.title, maximumSessionTitleLength) ?? workspace,
      status,
      observedAt,
      ...(parsed.recap ? { recap: parsed.recap } : undefined),
      ...(parsed.cwd ? { directory: parsed.cwd } : undefined),
      detail: detailFrom(parsed, workspace),
      ...(status === SESSION_STATUS.WAITING && parsed.tip === GROK_SESSION_TIP.HOLDING
        ? { holdingForDeveloper: true }
        : undefined),
    };
  }
}

/**
 * The database's bookkeeping about one session: everything the CLI wrote
 * about it, never the conversation behind it.
 */
interface GrokDatabaseSessionSnapshot {
  providerSessionId: string;
  title?: string;
  recap?: string;
  model?: string;
  directory?: string;
  observedAt: number;
  turn?: GrokDatabaseTurn;
}

/** Whose move the newest stored message says it is. */
interface GrokDatabaseTurn {
  settled: boolean;
  activity?: string;
  atMs?: number;
}

const GROK_SESSION_QUERY = `
  SELECT id, title, recap_text, model, cwd_last, created_at, updated_at
  FROM sessions
  ORDER BY updated_at DESC
`;

const GROK_LAST_MESSAGE_QUERY = `
  SELECT role, message_json, created_at
  FROM messages
  WHERE session_id = ?
  ORDER BY seq DESC
  LIMIT 1
`;

function timestampMsFromColumn(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const stampMs = Date.parse(value);
  return Number.isFinite(stampMs) ? stampMs : undefined;
}

/**
 * Whose move the newest stored message says it is. Messages land in batches
 * as a turn's steps finish, so an assistant message that is words alone is a
 * settled turn, one still carrying a tool call is a turn whose call has not
 * answered yet, and a user or tool message — or none at all — is a turn the
 * model is still working. The database records no failure and no permission
 * prompt, so a database session is never an error and never holds for the
 * developer; the freshness decay is what tells a long quiet turn from an
 * abandoned one.
 */
function turnFromMessageRow(row: WireRecord): GrokDatabaseTurn {
  const atMs = timestampMsFromColumn(textFromRow(row, GROK_MESSAGE_COLUMN.CREATED_AT));
  const message = recordFromJsonLine(textFromRow(row, GROK_MESSAGE_COLUMN.MESSAGE_JSON) ?? "");
  if (!message || textFromRow(row, GROK_MESSAGE_COLUMN.ROLE) !== GROK_MESSAGE_ROLE.ASSISTANT) {
    return { settled: false, ...(atMs !== undefined ? { atMs } : undefined) };
  }
  const toolCall = grokMessageParts(message).find(
    (part) => text(part.type) === GROK_MESSAGE_PART.TOOL_CALL,
  );
  if (!toolCall) return { settled: true, ...(atMs !== undefined ? { atMs } : undefined) };
  const name = text(toolCall.toolName);
  const input = isRecord(toolCall.input) ? toolCall.input : undefined;
  const detail = input
    ? grokToolInputDetail(input, GROK_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH)
    : undefined;
  return {
    settled: false,
    ...(name ? { activity: detail ? `${name}: ${detail}` : name } : undefined),
    ...(atMs !== undefined ? { atMs } : undefined),
  };
}

function snapshotFromSessionRow(row: WireRecord): GrokDatabaseSessionSnapshot | undefined {
  const providerSessionId = textFromRow(row, GROK_SESSION_COLUMN.ID);
  if (!providerSessionId) return undefined;
  return {
    providerSessionId,
    title: textFromRow(row, GROK_SESSION_COLUMN.TITLE),
    recap: textFromRow(row, GROK_SESSION_COLUMN.RECAP_TEXT),
    model: textFromRow(row, GROK_SESSION_COLUMN.MODEL),
    directory: textFromRow(row, GROK_SESSION_COLUMN.CWD_LAST),
    observedAt: Math.max(
      timestampMsFromColumn(textFromRow(row, GROK_SESSION_COLUMN.UPDATED_AT)) ?? 0,
      timestampMsFromColumn(textFromRow(row, GROK_SESSION_COLUMN.CREATED_AT)) ?? 0,
    ),
  };
}

function observationFromSnapshot(
  snapshot: GrokDatabaseSessionSnapshot,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation {
  const workspace = workspaceLabel(snapshot.directory);
  const observedAt = Math.max(snapshot.observedAt, snapshot.turn?.atMs ?? 0);
  const settled = snapshot.turn?.settled === true;
  const status = localSessionStatus(
    settled ? SESSION_STATUS.WAITING : SESSION_STATUS.WORKING,
    observedAt,
    now,
    activeSessionFreshnessMs,
  );
  return {
    providerSessionId: snapshot.providerSessionId,
    title: oneLine(snapshot.title, maximumSessionTitleLength) ?? workspace,
    status,
    observedAt,
    // The recap the CLI wrote itself is reported only behind a settled turn:
    // while a newer turn runs, it describes the turn before and would pose
    // as an outcome the session has not reached.
    ...(settled && snapshot.recap
      ? { recap: oneLine(snapshot.recap, maximumSessionRecapLength) }
      : undefined),
    ...(snapshot.directory ? { directory: snapshot.directory } : undefined),
    detail: {
      ...(snapshot.turn?.activity ? { activity: snapshot.turn.activity } : undefined),
      repository: workspace,
      ...(snapshot.model ? { model: snapshot.model } : undefined),
    },
  };
}

/**
 * Observes the Grok Build sessions on this machine from the state the CLI
 * already writes for itself: the SQLite database every install since 1.1.x
 * keeps, or the per-session directories of the releases before it. It runs
 * no server, needs no credential, registers no hook, and opens everything
 * read-only.
 */
export class GrokBuildSessionAdapter extends LocalSessionAdapter {
  readonly provider = GROK_BUILD_PROVIDER;

  readonly #grokHome: string;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #legacyStore: GrokBuildLegacySessionStore;

  constructor(options: GrokBuildAdapterOptions = {}) {
    super(options);
    this.#grokHome = options.grokHome ?? defaultGrokBuildHome();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
    this.#legacyStore = new GrokBuildLegacySessionStore(this.#grokHome, options);
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const database = await openReadOnlyDatabase(
      this.#sqlite,
      path.join(this.#grokHome, GROK_DATABASE_FILE),
    );
    if (database) {
      let snapshots: GrokDatabaseSessionSnapshot[] | undefined;
      let now = 0;
      try {
        now = this.observationTime();
        snapshots = this.#databaseSnapshots(database);
      } finally {
        database.close();
      }
      // A database whose schema was unusable answers nothing; the legacy
      // directories may still answer.
      if (snapshots !== undefined) {
        return snapshots.map((snapshot) =>
          observationFromSnapshot(snapshot, now, this.activeSessionFreshnessMs),
        );
      }
    }
    return this.#legacyStore.observe();
  }

  override readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return providerTranscriptResult(
      readGrokBuildSessionTranscript({
        grokHome: this.#grokHome,
        providerSessionId,
        sqlite: this.#sqlite,
        maximumRenderedLength: this.#transcriptMaximumRenderedLength,
      }),
    );
  }

  /** The session rows, or nothing when the query does not fit this database. */
  #databaseSnapshots(database: SqliteDatabase): GrokDatabaseSessionSnapshot[] | undefined {
    let rows: WireRecord[];
    try {
      rows = database.prepare(GROK_SESSION_QUERY).all().filter(isRecord);
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return undefined;
      throw error;
    }
    const snapshots = rows
      .map(snapshotFromSessionRow)
      .filter((snapshot): snapshot is GrokDatabaseSessionSnapshot => snapshot !== undefined);
    // Every reported session gets its turn read, because a session without
    // one would default to working on freshness alone — inventing live work
    // for a row whose turn actually settled. Each read is an indexed point
    // query against one session's id, not a scan.
    for (const snapshot of snapshots) {
      snapshot.turn = this.#turnFor(database, snapshot.providerSessionId);
    }
    return snapshots;
  }

  /**
   * The newest message's bookkeeping, or nothing this build can read. A
   * messages table this build cannot read costs the turn, not the pass: the
   * database is still the current store, and yielding to the legacy
   * directories over one table would resurrect a past generation's sessions
   * while dropping the ones actually running.
   */
  #turnFor(database: SqliteDatabase, providerSessionId: string): GrokDatabaseTurn | undefined {
    try {
      const row = database
        .prepare(GROK_LAST_MESSAGE_QUERY)
        .all(providerSessionId)
        .filter(isRecord)[0];
      return row ? turnFromMessageRow(row) : undefined;
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return undefined;
      throw error;
    }
  }
}
