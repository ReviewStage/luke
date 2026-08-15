import os from "node:os";
import path from "node:path";
import {
  isRecord,
  maximumSessionRecapLength,
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
  text,
  wholeNumber,
} from "@sidecar/core";
import {
  existingWorkspaceDirectory,
  readTail,
  readTextFile,
  uniquePaths,
  workspaceLabel,
} from "./local-session-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteModuleLoader,
} from "./local-sqlite";

const CODEX_PROVIDER_ID = PROVIDER_ID.CODEX;
const CODEX_PROVIDER_NAME = "Codex";

const CODEX_ENVIRONMENT = {
  CONFIG_DIRECTORY: "CODEX_HOME",
  SQLITE_DIRECTORY: "CODEX_SQLITE_HOME",
} as const;

const CODEX_DATABASE_FILE = {
  STATE: "state_5.sqlite",
} as const;

const CODEX_CONFIG_FILE = {
  USER: "config.toml",
} as const;

const CODEX_CONFIG_KEY = {
  SQLITE_DIRECTORY: "sqlite_home",
} as const;

/**
 * The Codex app's own address for a local thread. Codex registers the `codex`
 * scheme for its windows and documents `threads/<thread-id>` as the route to an
 * existing local chat, keyed by the same `threads.id` this adapter reads — so
 * the row and the address it opens name one thread rather than two.
 */
const CODEX_THREAD_LINK_PREFIX = "codex://threads/";

const CODEX_THREAD_COLUMN = {
  ID: "id",
  CWD: "cwd",
  ARCHIVED: "archived",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  CREATED_AT_MS: "created_at_ms",
  UPDATED_AT_MS: "updated_at_ms",
  RECENCY_AT_MS: "recency_at_ms",
  TITLE: "title",
  GIT_BRANCH: "git_branch",
  MODEL: "model",
  REASONING_EFFORT: "reasoning_effort",
  ROLLOUT_PATH: "rollout_path",
} as const;

/** Records Codex appends to the rollout file named by a thread's `rollout_path`. */
const CODEX_ROLLOUT_TYPE = {
  EVENT_MSG: "event_msg",
  RESPONSE_ITEM: "response_item",
} as const;

/**
 * The turn boundary. `threads` carries no status column at all, so without the
 * rollout a Codex session can only be guessed at from how recently its row was
 * touched — and could never be reported as waiting for its developer.
 */
const CODEX_EVENT_PAYLOAD = {
  TASK_STARTED: "task_started",
  TASK_COMPLETE: "task_complete",
} as const;

const CODEX_RESPONSE_PAYLOAD = {
  FUNCTION_CALL: "function_call",
} as const;

/**
 * Function-call arguments whose value names the work, in the order they read
 * best. `cmd` leads because `exec_command` is by far the most common call Codex
 * makes and that is what it calls its command line.
 */
const CODEX_CALL_ARGUMENT_KEY = [
  "cmd",
  "command",
  "path",
  "file_path",
  "query",
  "search_query",
  "pattern",
] as const;

const CODEX_ADAPTER_DEFAULTS = {
  MAXIMUM_SESSION_ROWS: 40,
  /** Enough to reach past one turn's token accounting to its boundary event. */
  READ_ROLLOUT_TAIL_BYTES: 64 * 1024,
  /** Only the threads that can still change are worth a second file read. */
  MAXIMUM_ROLLOUT_READS: 12,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

// Every column is read defensively from the row, so the projection stays `*`:
// Codex adds columns by migration, and naming one this build expects but an
// older install lacks would fail the whole query rather than one field.
const CODEX_THREAD_QUERY = `
  SELECT *
  FROM threads
  WHERE archived = 0
    AND id <> ''
    AND cwd <> ''
  ORDER BY
    CASE
      WHEN recency_at_ms IS NOT NULL AND recency_at_ms > 0 THEN recency_at_ms
      WHEN updated_at_ms IS NOT NULL AND updated_at_ms > 0 THEN updated_at_ms
      WHEN created_at_ms IS NOT NULL AND created_at_ms > 0 THEN created_at_ms
      WHEN updated_at IS NOT NULL AND updated_at > 0 THEN updated_at * 1000
      ELSE created_at * 1000
    END DESC,
    id DESC
  LIMIT ?
`;

type CodexThreadRow = Record<string, unknown>;

export const CODEX_PROVIDER: SessionProvider = {
  id: CODEX_PROVIDER_ID,
  displayName: CODEX_PROVIDER_NAME,
};

export interface CodexAdapterOptions {
  codexHome?: string;
  sqliteHome?: string;
  now?: () => number;
  maximumSessionRows?: number;
  maximumSessionAgeMs?: number;
  activeSessionFreshnessMs?: number;
  sqlite?: SqliteModuleLoader;
}

/**
 * Reads one argument as the phrase that names the work. Codex passes some of
 * them as a list rather than a string — a search's terms, a command's argv —
 * so a list of plain values is joined instead of dropped. A list of anything
 * else, such as a plan's steps, is not a phrase and is left alone.
 */
function argumentPhrase(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  if (typeof value === "number") return String(value);
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tokens = value.map((entry) =>
    typeof entry === "string" || typeof entry === "number" ? String(entry) : undefined,
  );
  return tokens.every((token) => token !== undefined) ? text(tokens.join(" ")) : undefined;
}

/** Names the tool Codex called, preferring whichever argument says what it is for. */
function activityFromCall(payload: Record<string, unknown>): string | undefined {
  const name = text(payload.name);
  if (!name) return undefined;
  const parsedArguments = text(payload.arguments)
    ? recordFromJsonLine(payload.arguments as string)
    : undefined;
  for (const key of CODEX_CALL_ARGUMENT_KEY) {
    const detail = oneLine(
      argumentPhrase(parsedArguments?.[key]),
      CODEX_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
    );
    if (detail) return `${name}: ${detail}`;
  }
  return name;
}

interface ParsedCodexRollout {
  activity?: string;
  lastAgentMessage?: string;
  turnComplete?: boolean;
}

/**
 * Reads the turn boundary and the current call out of a rollout tail. A
 * `task_complete` that nothing followed means the turn ended and the session is
 * holding for its developer; a `task_started` means it is still running.
 */
function parseCodexRolloutTail(tail: string): ParsedCodexRollout {
  const parsed: ParsedCodexRollout = {};
  const lines = tail.split(/\r?\n/);
  for (const line of lines) {
    const record = recordFromJsonLine(line);
    if (!record) continue;
    const payload = isRecord(record.payload) ? record.payload : undefined;
    if (!payload) continue;

    if (record.type === CODEX_ROLLOUT_TYPE.EVENT_MSG) {
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_STARTED) {
        parsed.turnComplete = false;
        parsed.lastAgentMessage = undefined;
        // A new turn is not running the previous turn's last call, and holding
        // it would keep a stale line on the row until some other tool runs.
        parsed.activity = undefined;
      }
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_COMPLETE) {
        parsed.turnComplete = true;
        parsed.activity = undefined;
        parsed.lastAgentMessage = oneLine(
          text(payload.last_agent_message),
          maximumSessionRecapLength,
        );
      }
      continue;
    }
    if (
      record.type === CODEX_ROLLOUT_TYPE.RESPONSE_ITEM &&
      payload.type === CODEX_RESPONSE_PAYLOAD.FUNCTION_CALL
    ) {
      parsed.activity = activityFromCall(payload) ?? parsed.activity;
    }
  }
  return parsed;
}

function numberFromRow(row: CodexThreadRow, key: string): number | undefined {
  return wholeNumber(row[key]);
}

function textFromRow(row: CodexThreadRow, key: string): string | undefined {
  return text(row[key]);
}

function timestampFromRow(row: CodexThreadRow): number {
  return Math.max(
    numberFromRow(row, CODEX_THREAD_COLUMN.RECENCY_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT_MS) ?? 0,
    (numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT) ?? 0) * 1000,
    (numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT) ?? 0) * 1000,
  );
}

function normalizeDirectory(value: string | undefined, baseDirectory: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === "~") return os.homedir();
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  if (path.isAbsolute(normalized)) return normalized;
  return path.resolve(baseDirectory, normalized);
}

function unescapeBasicTomlString(value: string): string {
  return value.replace(/\\(["\\bfnrt])/g, (_match, character: string) => {
    if (character === "b") return "\b";
    if (character === "f") return "\f";
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    if (character === "t") return "\t";
    return character;
  });
}

function tomlStringValue(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return unescapeBasicTomlString(normalized.slice(1, -1)).trim() || undefined;
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).trim() || undefined;
  }
  return normalized.trim() || undefined;
}

function topLevelTomlString(source: string, key: string): string | undefined {
  let inTopLevel = true;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    if (trimmed.slice(0, separatorIndex).trim() !== key) continue;
    return tomlStringValue(trimmed.slice(separatorIndex + 1).replace(/\s+#.*$/, ""));
  }
  return undefined;
}

async function sqliteHomeFromConfig(codexHome: string): Promise<string | undefined> {
  const config = await readTextFile(path.join(codexHome, CODEX_CONFIG_FILE.USER));
  return config
    ? normalizeDirectory(topLevelTomlString(config, CODEX_CONFIG_KEY.SQLITE_DIRECTORY), codexHome)
    : undefined;
}

async function stateDatabasePaths(
  codexHome: string,
  configuredSqliteHome: string | undefined,
): Promise<string[]> {
  const sqliteHome =
    normalizeDirectory(configuredSqliteHome, codexHome) ??
    (await sqliteHomeFromConfig(codexHome)) ??
    normalizeDirectory(process.env[CODEX_ENVIRONMENT.SQLITE_DIRECTORY], codexHome);
  return uniquePaths(
    [
      sqliteHome && path.join(sqliteHome, CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, "sqlite", CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, CODEX_DATABASE_FILE.STATE),
    ].filter((candidate): candidate is string => candidate !== undefined),
  );
}

/**
 * Codex names its own threads, and that name is what a developer is looking
 * for. The workspace is the fallback for a thread too new to have been named.
 */
function titleFromRow(row: CodexThreadRow): string {
  return (
    oneLine(textFromRow(row, CODEX_THREAD_COLUMN.TITLE), maximumSessionTitleLength) ??
    workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD))
  );
}

function modelFromRow(row: CodexThreadRow): string | undefined {
  const model = textFromRow(row, CODEX_THREAD_COLUMN.MODEL);
  if (!model) return undefined;
  const effort = textFromRow(row, CODEX_THREAD_COLUMN.REASONING_EFFORT);
  return effort ? `${model} · ${effort}` : model;
}

function statusFromRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
  observedAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  if ((numberFromRow(row, CODEX_THREAD_COLUMN.ARCHIVED) ?? 0) !== 0) {
    return SESSION_STATUS.COMPLETE;
  }
  const isFresh = now - observedAt <= activeSessionFreshnessMs;
  // A turn that ended is holding for the developer however the row's timestamp
  // reads, but once it is stale Luke cannot tell a turn that just finished from
  // a thread abandoned hours ago.
  if (rollout?.turnComplete === true) {
    return isFresh ? SESSION_STATUS.WAITING : SESSION_STATUS.UNKNOWN;
  }
  if (rollout?.turnComplete === false) return SESSION_STATUS.WORKING;
  return isFresh ? SESSION_STATUS.WORKING : SESSION_STATUS.UNKNOWN;
}

function detailFromRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
): SessionDetail {
  const activity = rollout?.activity;
  const branch = textFromRow(row, CODEX_THREAD_COLUMN.GIT_BRANCH);
  const model = modelFromRow(row);
  const threadId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  return {
    ...(activity ? { activity } : {}),
    repository: workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD)),
    ...(branch ? { branch } : {}),
    ...(model ? { model } : {}),
    ...(threadId ? { link: `${CODEX_THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}` } : {}),
  };
}

function observationFromThreadRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation | undefined {
  const providerSessionId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  if (!providerSessionId) return undefined;

  const observedAt = timestampFromRow(row);
  const status = statusFromRow(row, rollout, observedAt, now, activeSessionFreshnessMs);
  return {
    providerSessionId,
    title: titleFromRow(row),
    status,
    observedAt,
    ...(rollout?.lastAgentMessage ? { recap: rollout.lastAgentMessage } : {}),
    detail: detailFromRow(row, rollout),
  };
}

function defaultCodexHome(): string {
  const configuredHome = process.env[CODEX_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".codex");
}

export class CodexSessionAdapter implements SessionProviderAdapter {
  readonly provider = CODEX_PROVIDER;

  readonly #codexHome: string;
  readonly #sqliteHome: string | undefined;
  readonly #now: () => number;
  readonly #maximumSessionRows: number;
  readonly #maximumSessionAgeMs: number;
  readonly #activeSessionFreshnessMs: number;
  readonly #sqlite: SqliteModuleLoader;

  constructor(options: CodexAdapterOptions = {}) {
    this.#codexHome = options.codexHome ?? defaultCodexHome();
    this.#sqliteHome = options.sqliteHome;
    this.#now = options.now ?? Date.now;
    const resolved = resolveOptions(
      options,
      {
        maximumSessionRows: CODEX_ADAPTER_DEFAULTS.MAXIMUM_SESSION_ROWS,
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
    for (const databasePath of await stateDatabasePaths(this.#codexHome, this.#sqliteHome)) {
      const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (!database) continue;
      let rows: CodexThreadRow[];
      let now: number;
      try {
        now = this.#now();
        rows = database
          .prepare(CODEX_THREAD_QUERY)
          .all(this.#maximumSessionRows)
          .filter((row): row is CodexThreadRow => row !== null && typeof row === "object")
          .filter((row) => now - timestampFromRow(row) <= this.#maximumSessionAgeMs);
      } catch (error) {
        if (canIgnoreSqliteError(error)) continue;
        throw error;
      } finally {
        database.close();
      }

      const existingRows = (
        await Promise.all(
          rows.map(async (row) =>
            (await existingWorkspaceDirectory(textFromRow(row, CODEX_THREAD_COLUMN.CWD)))
              ? row
              : undefined,
          ),
        )
      ).filter((row): row is CodexThreadRow => row !== undefined);

      // The rollout read happens with the database already closed, so a slow
      // disk never holds a read lock on state Codex itself is writing.
      const rollouts = await this.#rollouts(existingRows);
      return existingRows
        .map((row) =>
          observationFromThreadRow(
            row,
            rollouts.get(textFromRow(row, CODEX_THREAD_COLUMN.ID) ?? ""),
            now,
            this.#activeSessionFreshnessMs,
          ),
        )
        .filter(
          (observation): observation is ProviderSessionObservation => observation !== undefined,
        );
    }
    return [];
  }

  /**
   * Reads the turn boundary for the threads that can still change. An archived
   * thread has already settled, and the cap keeps a crowded day from turning
   * one observation pass into dozens of file reads.
   */
  async #rollouts(rows: readonly CodexThreadRow[]): Promise<Map<string, ParsedCodexRollout>> {
    const candidates = rows
      .filter((row) => (numberFromRow(row, CODEX_THREAD_COLUMN.ARCHIVED) ?? 0) === 0)
      .slice(0, CODEX_ADAPTER_DEFAULTS.MAXIMUM_ROLLOUT_READS)
      .map((row) => ({
        id: textFromRow(row, CODEX_THREAD_COLUMN.ID),
        rolloutPath: textFromRow(row, CODEX_THREAD_COLUMN.ROLLOUT_PATH),
      }))
      .filter(
        (candidate): candidate is { id: string; rolloutPath: string } =>
          candidate.id !== undefined && candidate.rolloutPath !== undefined,
      );

    const parsed = await Promise.all(
      candidates.map(async (candidate) => {
        const tail = await readTail(
          candidate.rolloutPath,
          CODEX_ADAPTER_DEFAULTS.READ_ROLLOUT_TAIL_BYTES,
        );
        return [candidate.id, parseCodexRolloutTail(tail)] as const;
      }),
    );
    return new Map(parsed);
  }
}
