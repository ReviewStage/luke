import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderAdapter,
} from "@sidecar/core";

const CODEX_PROVIDER_ID = "codex";
const CODEX_PROVIDER_NAME = "Codex";
const UNKNOWN_WORKSPACE_LABEL = "workspace";

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

const CODEX_THREAD_COLUMN = {
  ID: "id",
  CWD: "cwd",
  ARCHIVED: "archived",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  CREATED_AT_MS: "created_at_ms",
  UPDATED_AT_MS: "updated_at_ms",
  RECENCY_AT_MS: "recency_at_ms",
} as const;

const CODEX_ADAPTER_DEFAULTS = {
  MAXIMUM_SESSION_ROWS: 40,
  MAXIMUM_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
  ACTIVE_SESSION_FRESHNESS_MS: 15 * 60 * 1000,
} as const;

const CODEX_THREAD_QUERY = `
  SELECT
    id,
    cwd,
    archived,
    created_at,
    updated_at,
    created_at_ms,
    updated_at_ms,
    recency_at_ms
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

interface SqliteStatement {
  all(...anonymousParameters: readonly unknown[]): unknown[];
}

interface SqliteDatabase {
  close(): void;
  enableDefensive?(enabled: boolean): void;
  prepare(source: string): SqliteStatement;
}

interface SqliteModule {
  DatabaseSync: new (location: string, options: { readOnly: boolean }) => SqliteDatabase;
}

type SqliteModuleLoader = () => Promise<SqliteModule>;

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

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function canIgnoreFilesystemError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

function canIgnoreSqliteError(error: unknown): boolean {
  if (isNodeError(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return true;
  if (!(error instanceof Error)) return false;
  return /no such table|no such column|unable to open database file|readonly database/i.test(
    error.message,
  );
}

async function fileStats(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

async function defaultSqliteModule(): Promise<SqliteModule> {
  return (await import("node:sqlite")) as SqliteModule;
}

async function openReadOnlyDatabase(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Promise<SqliteDatabase | undefined> {
  const stats = await fileStats(filePath);
  if (!stats?.isFile()) return undefined;

  try {
    const module = await sqlite();
    const database = new module.DatabaseSync(filePath, { readOnly: true });
    database.enableDefensive?.(true);
    return database;
  } catch (error) {
    if (canIgnoreSqliteError(error) || canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

function numberFromRow(row: CodexThreadRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textFromRow(row: CodexThreadRow, key: string): string | undefined {
  const value = row[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
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

function workspaceLabel(cwd: string | undefined): string {
  if (!cwd) return UNKNOWN_WORKSPACE_LABEL;
  const label = path.basename(cwd.trim());
  return label || UNKNOWN_WORKSPACE_LABEL;
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

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

async function stateDatabasePaths(
  codexHome: string,
  configuredSqliteHome: string | undefined,
): Promise<string[]> {
  const sqliteHome =
    normalizeDirectory(configuredSqliteHome, codexHome) ??
    normalizeDirectory(process.env[CODEX_ENVIRONMENT.SQLITE_DIRECTORY], codexHome) ??
    (await sqliteHomeFromConfig(codexHome));
  return uniquePaths(
    [
      sqliteHome && path.join(sqliteHome, CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, "sqlite", CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, CODEX_DATABASE_FILE.STATE),
    ].filter((candidate): candidate is string => candidate !== undefined),
  );
}

function titleFromRow(row: CodexThreadRow): string {
  return `${CODEX_PROVIDER_NAME}: ${workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD))}`;
}

function statusFromRow(
  row: CodexThreadRow,
  observedAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  if ((numberFromRow(row, CODEX_THREAD_COLUMN.ARCHIVED) ?? 0) !== 0) {
    return SESSION_STATUS.COMPLETE;
  }
  return now - observedAt <= activeSessionFreshnessMs
    ? SESSION_STATUS.WORKING
    : SESSION_STATUS.UNKNOWN;
}

function summaryFromStatus(status: ProviderSessionObservation["status"]): string {
  return `${CODEX_PROVIDER_NAME} ${status}; session metadata is observed read-only and transcript content is not retained.`;
}

function observationFromThreadRow(
  row: CodexThreadRow,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation | undefined {
  const providerSessionId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  if (!providerSessionId) return undefined;

  const observedAt = timestampFromRow(row);
  const status = statusFromRow(row, observedAt, now, activeSessionFreshnessMs);
  return {
    providerSessionId,
    title: titleFromRow(row),
    status,
    observedAt,
    summary: summaryFromStatus(status),
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
    this.#maximumSessionRows = positiveInteger(
      options.maximumSessionRows,
      CODEX_ADAPTER_DEFAULTS.MAXIMUM_SESSION_ROWS,
    );
    this.#maximumSessionAgeMs = nonNegativeNumber(
      options.maximumSessionAgeMs,
      CODEX_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
    );
    this.#activeSessionFreshnessMs = nonNegativeNumber(
      options.activeSessionFreshnessMs,
      CODEX_ADAPTER_DEFAULTS.ACTIVE_SESSION_FRESHNESS_MS,
    );
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    let database: SqliteDatabase | undefined;
    for (const databasePath of await stateDatabasePaths(this.#codexHome, this.#sqliteHome)) {
      database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (database) break;
    }
    if (!database) return [];

    try {
      const now = this.#now();
      const rows = database.prepare(CODEX_THREAD_QUERY).all(this.#maximumSessionRows);
      return rows
        .filter((row): row is CodexThreadRow => row !== null && typeof row === "object")
        .map((row) => observationFromThreadRow(row, now, this.#activeSessionFreshnessMs))
        .filter((observation): observation is ProviderSessionObservation => {
          if (!observation) return false;
          return now - observation.observedAt <= this.#maximumSessionAgeMs;
        });
    } catch (error) {
      if (canIgnoreSqliteError(error)) return [];
      throw error;
    } finally {
      database.close();
    }
  }
}
