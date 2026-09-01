import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Session, SessionIdentity, SessionRegistrySnapshot } from "@sidecar/session";
import { isRosterRelevant } from "@sidecar/session";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type ObservedSessionRow, observedSessions } from "./schema";

export const SESSION_INDEX_FILE_NAME = "observed-sessions.sqlite3";
const SESSION_INDEX_FILE_MODE = 0o600;
const SESSION_INDEX_BUSY_TIMEOUT_MS = 50;
const MAXIMUM_SEARCH_RESULTS = 100;
const SEARCH_CANDIDATE_MULTIPLIER = 4;

export interface SessionIndexHit extends SessionIdentity {
  rank: number;
}

export interface SessionIndexOptions {
  directory: () => string;
  migrationsDirectory: string;
  enabled: boolean;
  onDiagnostic?: (message: string) => void;
}

interface IndexedIdentity extends SessionIdentity {
  aboutHash: string;
}

interface SearchCandidate extends SessionIndexHit {
  observedAt: number;
  standing: number;
  status: Session["status"];
}

function aboutHash(row: Omit<ObservedSessionRow, "aboutHash">): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function indexedRow(session: Session): ObservedSessionRow {
  const row = {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    title: session.title,
    branch: session.detail.branch,
    recap: session.recap,
    status: session.status,
    observedAt: session.observedAt,
    providerLabel: session.provider.displayName,
    location: session.location,
    repositoryLabel: session.detail.repository,
    workspaceLabel: session.workspace?.name,
    standing: session.standing === true,
    holdingForDeveloper: session.holdingForDeveloper === true,
  } satisfies Omit<ObservedSessionRow, "aboutHash">;
  return { ...row, aboutHash: aboutHash(row) };
}

function nestedIdentityMap<T extends SessionIdentity>(
  values: readonly T[],
): Map<string, Map<string, T>> {
  const identities = new Map<string, Map<string, T>>();
  for (const value of values) {
    const provider = identities.get(value.providerId) ?? new Map<string, T>();
    provider.set(value.providerSessionId, value);
    identities.set(value.providerId, provider);
  }
  return identities;
}

function ftsQuery(query: string): string | undefined {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replaceAll('"', '""'))
    .filter(Boolean);
  if (tokens.length === 0) return undefined;
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

function isCorruptDatabase(error: Error): boolean {
  for (let current: Error | undefined = error; current; ) {
    if (/database disk image is malformed|file is not a database/i.test(current.message)) {
      return true;
    }
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return false;
}

export class SessionIndex {
  readonly #options: SessionIndexOptions;
  #database: BetterSqlite3.Database | undefined;
  #queue: Promise<void> = Promise.resolve();
  #lastDiagnostic: string | undefined;

  constructor(options: SessionIndexOptions) {
    this.#options = options;
  }

  reconcile(snapshot: SessionRegistrySnapshot): Promise<void> {
    if (!this.#options.enabled) return Promise.resolve();
    const queued = this.#queue.then(() => this.#reconcileWithRecovery(snapshot));
    this.#queue = queued.catch(() => undefined);
    return queued;
  }

  clear(): Promise<void> {
    return this.reconcile({ revision: 0, sessions: [], attention: [] });
  }

  async search(query: string, now: number, limit = 20): Promise<readonly SessionIndexHit[]> {
    if (!this.#options.enabled) return [];
    await this.#queue;
    const match = ftsQuery(query);
    if (!match) return [];
    try {
      const database = this.#open();
      const boundedLimit = Math.max(1, Math.min(limit, MAXIMUM_SEARCH_RESULTS));
      const candidates = database
        .prepare<[string, number], SearchCandidate>(
          `SELECT
             sessions.provider_id AS providerId,
             sessions.provider_session_id AS providerSessionId,
             bm25(observed_sessions_fts) AS rank,
             sessions.observed_at AS observedAt,
             sessions.standing AS standing,
             sessions.status AS status
           FROM observed_sessions_fts
           JOIN observed_sessions AS sessions
             ON sessions.rowid = observed_sessions_fts.rowid
           WHERE observed_sessions_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(match, boundedLimit * SEARCH_CANDIDATE_MULTIPLIER);
      this.#lastDiagnostic = undefined;
      return candidates
        .filter((candidate) =>
          isRosterRelevant(
            {
              status: candidate.status,
              observedAt: candidate.observedAt,
              standing: candidate.standing === 1,
            },
            now,
          ),
        )
        .slice(0, boundedLimit)
        .map(({ providerId, providerSessionId, rank }) => ({
          providerId,
          providerSessionId,
          rank,
        }));
    } catch (error) {
      this.#diagnose(error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
  }

  #reconcileWithRecovery(snapshot: SessionRegistrySnapshot): void {
    try {
      this.#reconcile(snapshot);
      this.#lastDiagnostic = undefined;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (isCorruptDatabase(failure)) {
        try {
          this.#rebuild();
          this.#reconcile(snapshot);
          this.#lastDiagnostic = undefined;
          return;
        } catch (rebuildError) {
          this.#diagnose(
            rebuildError instanceof Error ? rebuildError : new Error(String(rebuildError)),
          );
          return;
        }
      }
      this.#diagnose(failure);
    }
  }

  #reconcile(snapshot: SessionRegistrySnapshot): void {
    const database = this.#open();
    const orm = drizzle(database);
    const nextRows = snapshot.sessions.map(indexedRow);
    const nextIdentities = nestedIdentityMap(nextRows);
    const currentRows = orm
      .select({
        providerId: observedSessions.providerId,
        providerSessionId: observedSessions.providerSessionId,
        aboutHash: observedSessions.aboutHash,
      })
      .from(observedSessions)
      .all() satisfies IndexedIdentity[];
    const currentIdentities = nestedIdentityMap(currentRows);
    const deleteRow = database.prepare<[string, string]>(
      "DELETE FROM observed_sessions WHERE provider_id = ? AND provider_session_id = ?",
    );

    database.transaction(() => {
      for (const row of nextRows) {
        const current = currentIdentities.get(row.providerId)?.get(row.providerSessionId);
        if (current?.aboutHash === row.aboutHash) continue;
        orm
          .insert(observedSessions)
          .values(row)
          .onConflictDoUpdate({
            target: [observedSessions.providerId, observedSessions.providerSessionId],
            set: row,
          })
          .run();
      }
      for (const current of currentRows) {
        if (nextIdentities.get(current.providerId)?.has(current.providerSessionId)) continue;
        deleteRow.run(current.providerId, current.providerSessionId);
      }
    })();
  }

  #open(): BetterSqlite3.Database {
    if (this.#database) return this.#database;
    const directory = this.#options.directory();
    fs.mkdirSync(directory, { recursive: true });
    const databasePath = path.join(directory, SESSION_INDEX_FILE_NAME);
    const database = new BetterSqlite3(databasePath);
    try {
      database.pragma(`busy_timeout = ${SESSION_INDEX_BUSY_TIMEOUT_MS}`);
      migrate(drizzle(database), {
        migrationsFolder: this.#options.migrationsDirectory,
      });
      fs.chmodSync(databasePath, SESSION_INDEX_FILE_MODE);
    } catch (error) {
      database.close();
      throw error;
    }
    this.#database = database;
    return database;
  }

  #rebuild(): void {
    this.close();
    const databasePath = path.join(this.#options.directory(), SESSION_INDEX_FILE_NAME);
    for (const suffix of ["", "-shm", "-wal"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }

  #diagnose(error: Error): void {
    const message = error.message;
    if (message === this.#lastDiagnostic) return;
    this.#lastDiagnostic = message;
    this.#options.onDiagnostic?.(`Session index unavailable: ${message}`);
  }
}
