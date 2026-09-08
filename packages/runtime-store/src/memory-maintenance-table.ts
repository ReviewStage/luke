import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  boundCandidateText,
  CANDIDATE_STATUS,
  type CandidateSeed,
  type CandidateStatus,
  CONSOLIDATION_DEFAULTS,
  CONSOLIDATION_PHASE,
  type ConsolidationPhase,
  candidateFromSeed,
  candidateKeyFor,
  DREAMS_FILE,
  hashText,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryCandidate,
  type MemoryHousekeepingOutcome,
  memoryCandidateFromWire,
  promotedCandidateKeys,
  reinforceCandidate,
  removePromotedEntries,
} from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import type { SessionKey } from "@sidecar/runtime-contracts";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { RuntimeDatabase } from "./database.js";
import { removeIndexedPath } from "./memory-index-table.js";
import { forgetNotebookEntry, type NotebookEntry } from "./notebook-table.js";
import { readWorkspaceFileSync, writeWorkspaceFileSync } from "./workspace-files.js";

/**
 * The store's side of memory maintenance, on the database worker. It holds
 * what consolidation ranks and what forgetting must reach: the short-term
 * candidates with their signals, the ingestion cursor and seen-message
 * hashes of each conversation, the tombstones of forgotten sources, the
 * preimage of every MEMORY.md rewrite, and each conversation's last flush.
 * The two durable files consolidation may write — MEMORY.md and DREAMS.md —
 * are written here as well, each behind a check that the file still reads as
 * the plan was built over it, so an edit made by hand meanwhile refuses the
 * rewrite rather than being overwritten.
 */

type CandidateRow = { payload: string };

const PHASES: readonly ConsolidationPhase[] = Object.values(CONSOLIDATION_PHASE);
const OUTCOMES: readonly MemoryHousekeepingOutcome[] = Object.values(MEMORY_HOUSEKEEPING_OUTCOME);

/** A row's payload as a candidate, or nothing for one this build cannot read. */
function readCandidate(row: CandidateRow): MemoryCandidate | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the reader is the validation.
    return memoryCandidateFromWire(JSON.parse(row.payload) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}

function readCandidates(rows: readonly CandidateRow[]): MemoryCandidate[] {
  return rows.flatMap((row) => {
    const candidate = readCandidate(row);
    return candidate ? [candidate] : [];
  });
}

function putCandidate(database: RuntimeDatabase, candidate: MemoryCandidate): void {
  database
    .prepare(
      `INSERT INTO memory_candidates
         (key, path, status, origin, source_session_key, source_event_id, last_seen_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         path = excluded.path, status = excluded.status, origin = excluded.origin,
         source_session_key = excluded.source_session_key, source_event_id = excluded.source_event_id,
         last_seen_at = excluded.last_seen_at, payload = excluded.payload`,
    )
    .run(
      candidate.key,
      candidate.path,
      candidate.status,
      candidate.origin,
      candidate.sourceSessionKey ?? null,
      candidate.sourceEventId ?? null,
      candidate.lastSeenAt,
      JSON.stringify(candidate),
    );
}

function candidateByKey(database: RuntimeDatabase, key: string): MemoryCandidate | undefined {
  // SAFETY: the one text column selected is the payload.
  const row = database.prepare("SELECT payload FROM memory_candidates WHERE key = ?").get(key) as
    | CandidateRow
    | undefined;
  return row ? readCandidates([row])[0] : undefined;
}

export function listMemoryCandidates(
  database: RuntimeDatabase,
  status?: CandidateStatus,
): readonly MemoryCandidate[] {
  // SAFETY: the one text column selected is the payload.
  const rows = (
    status
      ? database
          .prepare(
            "SELECT payload FROM memory_candidates WHERE status = ? ORDER BY last_seen_at DESC, key",
          )
          .all(status)
      : database
          .prepare("SELECT payload FROM memory_candidates ORDER BY last_seen_at DESC, key")
          .all()
  ) as CandidateRow[];
  return readCandidates(rows);
}

export interface CandidateStagingReport {
  readonly staged: number;
  readonly reinforced: number;
  readonly refused: number;
}

/**
 * Stages signals: a seed whose key the table holds reinforces that candidate,
 * a new one becomes a candidate, and a seed whose source is tombstoned is
 * refused, so a forgotten source is never relearned however many scans see it.
 */
export function stageMemoryCandidates(
  database: RuntimeDatabase,
  seeds: readonly CandidateSeed[],
  now: number,
): CandidateStagingReport {
  return database.transaction(() => {
    let staged = 0;
    let reinforced = 0;
    let refused = 0;
    for (const seed of seeds) {
      if (seedForgotten(database, seed)) {
        refused += 1;
        continue;
      }
      const fresh = candidateFromSeed(seed, now);
      const held = candidateByKey(database, fresh.key);
      if (held) {
        if (held.status === CANDIDATE_STATUS.PROMOTED) {
          refused += 1;
          continue;
        }
        putCandidate(database, reinforceCandidate(held, seed, now));
        reinforced += 1;
      } else {
        putCandidate(database, fresh);
        staged += 1;
      }
    }
    return { staged, reinforced, refused };
  });
}

function phaseHit(
  held: MemoryCandidate,
  phase: ConsolidationPhase,
): Pick<MemoryCandidate, "lightHits" | "remHits"> {
  switch (phase) {
    case CONSOLIDATION_PHASE.LIGHT:
      return { lightHits: held.lightHits + 1, remHits: held.remHits };
    case CONSOLIDATION_PHASE.REM:
      return { lightHits: held.lightHits, remHits: held.remHits + 1 };
    case CONSOLIDATION_PHASE.DEEP:
      return { lightHits: held.lightHits, remHits: held.remHits };
  }
}

/** Records a phase's hit on candidates, for the small boost deep ranking adds. */
export function recordPhaseHits(
  database: RuntimeDatabase,
  phase: ConsolidationPhase,
  keys: readonly string[],
  now: number,
): number {
  return database.transaction(() => {
    let hit = 0;
    for (const key of keys) {
      const held = candidateByKey(database, key);
      if (!held) continue;
      putCandidate(database, {
        ...held,
        ...phaseHit(held, phase),
        lastPhaseHitAt: now,
      });
      hit += 1;
    }
    return hit;
  });
}

export function setCandidateStatus(
  database: RuntimeDatabase,
  keys: readonly string[],
  status: CandidateStatus,
  now: number,
): number {
  return database.transaction(() => {
    let changed = 0;
    for (const key of keys) {
      const held = candidateByKey(database, key);
      if (!held) continue;
      putCandidate(database, {
        ...held,
        status,
        ...(status === CANDIDATE_STATUS.PROMOTED ? { promotedAt: now } : undefined),
      });
      changed += 1;
    }
    return changed;
  });
}

export function ingestionCursor(database: RuntimeDatabase, sessionKey: SessionKey): number {
  // SAFETY: the one integer column selected is the cursor.
  const row = database
    .prepare("SELECT last_recorded_at FROM memory_ingestion_cursors WHERE session_key = ?")
    .get(sessionKey) as { last_recorded_at: number } | undefined;
  return row?.last_recorded_at ?? 0;
}

/** Which of the hashes were ingested from the conversation before, in one read. */
export function messagesIngested(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  hashes: readonly string[],
): readonly string[] {
  if (hashes.length === 0) return [];
  // SAFETY: the one text column selected is the hash.
  const rows = database
    .prepare(
      `SELECT hash FROM memory_ingested_messages
       WHERE session_key = ? AND hash IN (SELECT value FROM json_each(?))`,
    )
    .all(sessionKey, JSON.stringify(hashes)) as { hash: string }[];
  return rows.map((row) => row.hash);
}

/** Moves the cursor forward and remembers the hashes, bounded per conversation to the pinned count. */
export function advanceIngestion(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  lastRecordedAt: number,
  hashes: readonly string[],
  now: number,
): void {
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO memory_ingestion_cursors (session_key, last_recorded_at, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           last_recorded_at = MAX(memory_ingestion_cursors.last_recorded_at, excluded.last_recorded_at),
           updated_at = excluded.updated_at`,
      )
      .run(sessionKey, lastRecordedAt, now);
    const insert = database.prepare(
      `INSERT OR IGNORE INTO memory_ingested_messages (session_key, hash, ingested_at) VALUES (?, ?, ?)`,
    );
    for (const hash of hashes) insert.run(sessionKey, hash, now);
    database
      .prepare(
        `DELETE FROM memory_ingested_messages WHERE session_key = ? AND rowid IN (
           SELECT rowid FROM memory_ingested_messages WHERE session_key = ?
           ORDER BY ingested_at DESC, rowid DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(sessionKey, sessionKey, CONSOLIDATION_DEFAULTS.MAX_TRACKED_MESSAGES_PER_SESSION);
  });
}

/** What a tombstone names: a whole conversation, one of its lines, a candidate, or a dated note's line. */
export const FORGOTTEN_SOURCE_KIND = {
  CONVERSATION: "conversation",
  HISTORY_LINE: "history-line",
  CANDIDATE: "candidate",
  NOTE_PATH: "note-path",
} as const;

export type ForgottenSourceKind =
  (typeof FORGOTTEN_SOURCE_KIND)[keyof typeof FORGOTTEN_SOURCE_KIND];

export interface ForgottenSource {
  readonly kind: ForgottenSourceKind;
  readonly id: string;
  readonly forgottenAt: number;
  readonly reason: string;
}

export function tombstoneSources(
  database: RuntimeDatabase,
  sources: readonly { kind: ForgottenSourceKind; id: string; reason: string }[],
  now: number,
): number {
  return database.transaction(() => {
    const insert = database.prepare(
      `INSERT INTO memory_forgotten_sources (source_kind, source_id, forgotten_at, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source_kind, source_id) DO UPDATE SET reason = excluded.reason`,
    );
    for (const source of sources) insert.run(source.kind, source.id, now, source.reason);
    return sources.length;
  });
}

export function isForgottenSource(
  database: RuntimeDatabase,
  kind: ForgottenSourceKind,
  id: string,
): boolean {
  return (
    database
      .prepare("SELECT 1 FROM memory_forgotten_sources WHERE source_kind = ? AND source_id = ?")
      .get(kind, id) !== undefined
  );
}

export function listForgottenSources(database: RuntimeDatabase): readonly ForgottenSource[] {
  // SAFETY: the columns selected are the ones the row type names.
  const rows = database
    .prepare(
      "SELECT source_kind, source_id, forgotten_at, reason FROM memory_forgotten_sources ORDER BY forgotten_at, source_id",
    )
    .all() as { source_kind: string; source_id: string; forgotten_at: number; reason: string }[];
  const kinds: readonly string[] = Object.values(FORGOTTEN_SOURCE_KIND);
  return rows.flatMap((row) =>
    kinds.includes(row.source_kind)
      ? [
          {
            // SAFETY: membership in the kind list was checked.
            kind: row.source_kind as ForgottenSourceKind,
            id: row.source_id,
            forgottenAt: row.forgotten_at,
            reason: row.reason,
          },
        ]
      : [],
  );
}

function seedForgotten(database: RuntimeDatabase, seed: CandidateSeed): boolean {
  if (
    seed.sourceSessionKey &&
    isForgottenSource(database, FORGOTTEN_SOURCE_KIND.CONVERSATION, seed.sourceSessionKey)
  ) {
    return true;
  }
  if (
    seed.sourceEventId &&
    isForgottenSource(database, FORGOTTEN_SOURCE_KIND.HISTORY_LINE, seed.sourceEventId)
  ) {
    return true;
  }
  if (isForgottenSource(database, FORGOTTEN_SOURCE_KIND.NOTE_PATH, seed.path)) return true;
  return isForgottenSource(
    database,
    FORGOTTEN_SOURCE_KIND.CANDIDATE,
    candidateKeyFor(seed.path, boundCandidateText(seed.text)),
  );
}

export interface MemoryRewriteRecord {
  readonly id: string;
  readonly path: string;
  readonly phase: ConsolidationPhase;
  readonly previous: string;
  readonly nextHash: string;
  readonly candidateKeys: readonly string[];
  readonly createdAt: number;
}

/** The candidate keys a rewrite row recorded, read back as strings and nothing else. */
function candidateKeysOf(stored: string): readonly string[] {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a wire value; the array and string checks below are the validation.
    parsed = JSON.parse(stored) as UnparsedWireValue;
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isWireString) : [];
}

export function listMemoryRewrites(database: RuntimeDatabase): readonly MemoryRewriteRecord[] {
  // SAFETY: the columns selected are the ones the row type names.
  const rows = database
    .prepare(
      `SELECT id, path, phase, previous, next_hash, candidate_keys, created_at
       FROM memory_rewrites ORDER BY created_at DESC, id`,
    )
    .all() as {
    id: string;
    path: string;
    phase: string;
    previous: string;
    next_hash: string;
    candidate_keys: string;
    created_at: number;
  }[];
  // A row whose phase this build does not name is left unread rather than guessed at.
  return rows.flatMap((row) => {
    const phase = PHASES.find((candidate) => candidate === row.phase);
    return phase
      ? [
          {
            id: row.id,
            path: row.path,
            phase,
            previous: row.previous,
            nextHash: row.next_hash,
            candidateKeys: candidateKeysOf(row.candidate_keys),
            createdAt: row.created_at,
          },
        ]
      : [];
  });
}

const DURABLE_FILES: readonly string[] = [WORKSPACE_FILE.MEMORY, DREAMS_FILE];

export interface MemoryRewriteAsk {
  readonly path: string;
  readonly phase: ConsolidationPhase;
  /** The hash of the content the rewrite was planned over; a file that reads otherwise refuses it. */
  readonly expectedHash: string;
  readonly next: string;
  readonly candidateKeys: readonly string[];
}

export const MEMORY_REWRITE_REFUSAL = {
  NOT_DURABLE_FILE: "only MEMORY.md and DREAMS.md are rewritten this way",
  CONFLICT: "the file changed since the rewrite was planned",
  TOO_LARGE: "the rewrite exceeds the file's budget",
  NOT_WRITTEN: "the file could not be written",
  NOT_RECORDED: "the rewrite could not be recorded; the file was put back",
} as const;

export type MemoryRewriteOutcome =
  | { readonly ok: true; readonly rewriteId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Publishes one durable rewrite: the file is read again and its hash must be
 * the one the plan was built over, the preimage is recorded in the same
 * transaction that marks the candidates promoted, and only then does the
 * file land whole. The index rows for the path are dropped so the next sync
 * reads the new content.
 */
export function publishMemoryRewrite(
  database: RuntimeDatabase,
  root: string,
  ask: MemoryRewriteAsk,
  now: number,
): MemoryRewriteOutcome {
  if (!DURABLE_FILES.includes(ask.path)) {
    return { ok: false, reason: MEMORY_REWRITE_REFUSAL.NOT_DURABLE_FILE };
  }
  if (ask.next.length > CONSOLIDATION_DEFAULTS.MEMORY_FILE_MAX_CHARS) {
    return { ok: false, reason: MEMORY_REWRITE_REFUSAL.TOO_LARGE };
  }
  const previous = readWorkspaceFileSync(root, ask.path);
  if (hashText(previous) !== ask.expectedHash) {
    return { ok: false, reason: MEMORY_REWRITE_REFUSAL.CONFLICT };
  }
  const rewriteId = randomUUID();
  // The file lands first: a write the disk refuses leaves the table saying
  // nothing was promoted, so the candidates are ranked again next sweep. A
  // table write that then fails puts the previous content back, and a crash
  // between the two leaves the file ahead of the table, which the sweep's
  // reconciliation reads back from the file's own promotion markers.
  try {
    writeWorkspaceFileSync(root, ask.path, ask.next);
  } catch (error) {
    return {
      ok: false,
      reason: `${MEMORY_REWRITE_REFUSAL.NOT_WRITTEN}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    database.transaction(() => {
      database
        .prepare(
          `INSERT INTO memory_rewrites (id, path, phase, previous, next_hash, candidate_keys, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rewriteId,
          ask.path,
          ask.phase,
          previous,
          hashText(ask.next),
          JSON.stringify(ask.candidateKeys),
          now,
        );
      if (ask.path === WORKSPACE_FILE.MEMORY) {
        setCandidateStatus(database, ask.candidateKeys, CANDIDATE_STATUS.PROMOTED, now);
      }
      removeIndexedPath(database, ask.path);
    });
  } catch (error) {
    writeWorkspaceFileSync(root, ask.path, previous);
    return {
      ok: false,
      reason: `${MEMORY_REWRITE_REFUSAL.NOT_RECORDED}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, rewriteId };
}

/**
 * Marks promoted every staged candidate whose promotion marker MEMORY.md
 * already carries: the repair for a rewrite that reached the file but not
 * the table, so the candidate is neither ranked again nor refused forever
 * for a marker the plan would find already present.
 */
export function reconcilePromotions(database: RuntimeDatabase, root: string, now: number): number {
  const memory = readDurableMemoryFile(root, WORKSPACE_FILE.MEMORY);
  if (!memory) return 0;
  const promoted = new Set(promotedCandidateKeys(memory.content));
  if (promoted.size === 0) return 0;
  const stale = listMemoryCandidates(database, CANDIDATE_STATUS.STAGED)
    .filter((candidate) => promoted.has(candidate.key))
    .map((candidate) => candidate.key);
  return setCandidateStatus(database, stale, CANDIDATE_STATUS.PROMOTED, now);
}

/** The current content and hash of a durable file, for a plan to be built over. */
export function readDurableMemoryFile(
  root: string,
  name: string,
): { content: string; hash: string } | undefined {
  if (!DURABLE_FILES.includes(name)) return undefined;
  const content = readWorkspaceFileSync(root, name);
  return { content, hash: hashText(content) };
}

/** A conversation's last recorded flush: the generation and compaction cycle it ran under, and how it ended. */
export interface FlushState {
  readonly generationId: string;
  readonly compactionCount: number;
  readonly outcome: MemoryHousekeepingOutcome;
  readonly flushedAt: number;
}

/** The conversation's flush marker, only when it was written under the generation asked about. */
export function flushState(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  generationId: string,
): FlushState | undefined {
  // SAFETY: the columns selected are the ones the row type names.
  const row = database
    .prepare(
      `SELECT generation_id, compaction_count, outcome, flushed_at FROM memory_flush_state
       WHERE session_key = ? AND generation_id = ?`,
    )
    .get(sessionKey, generationId) as
    | { generation_id: string; compaction_count: number; outcome: string; flushed_at: number }
    | undefined;
  if (!row) return undefined;
  const outcome = OUTCOMES.find((candidate) => candidate === row.outcome);
  // An outcome this build does not name reads as no recorded flush rather than as a failed one.
  if (!outcome) return undefined;
  return {
    generationId: row.generation_id,
    compactionCount: row.compaction_count,
    outcome,
    flushedAt: row.flushed_at,
  };
}

export function recordFlush(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  state: FlushState,
): void {
  database
    .prepare(
      `INSERT INTO memory_flush_state (session_key, generation_id, compaction_count, outcome, flushed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET generation_id = excluded.generation_id,
         compaction_count = excluded.compaction_count,
         outcome = excluded.outcome, flushed_at = excluded.flushed_at`,
    )
    .run(sessionKey, state.generationId, state.compactionCount, state.outcome, state.flushedAt);
}

export interface MemoryForgetAsk {
  /** Notebook entry ids to forget, each removed from USER.md and its provenance. */
  readonly entryIds?: readonly string[];
  /** Conversations whose lines must never be learned from again; their candidates and promotions go too. */
  readonly sessionKeys?: readonly SessionKey[];
  /** Individual candidate keys to drop and tombstone. */
  readonly candidateKeys?: readonly string[];
  readonly reason: string;
}

export interface MemoryForgetReport {
  readonly forgottenEntries: number;
  readonly removedCandidates: number;
  readonly removedMemoryEntries: number;
  readonly tombstoned: number;
  /** What could not be erased and why: promotions whose attribution a hand edit destroyed. */
  readonly limitations: readonly string[];
  readonly entries: readonly NotebookEntry[];
}

/**
 * Source-aware forgetting. Notebook entries named go through the notebook's
 * own forget; candidates from the conversations or keys named are removed
 * and their sources tombstoned; MEMORY.md loses the entries its promotion
 * markers attribute to those candidates, behind a recorded preimage; and the
 * index rows of every touched file are dropped for the next sync. An entry
 * whose marker a hand edit removed cannot be attributed and is reported,
 * never silently kept as if erased. The raw conversation's history is not
 * touched: deleting it is the separate, recoverable operation.
 */
export function forgetMemorySources(
  database: RuntimeDatabase,
  root: string,
  ask: MemoryForgetAsk,
  now: number,
): MemoryForgetReport {
  const limitations: string[] = [];
  let forgottenEntries = 0;
  let entries: readonly NotebookEntry[] = [];
  for (const id of ask.entryIds ?? []) {
    const mutation = forgetNotebookEntry(database, root, id, now);
    entries = mutation.entries;
    if (mutation.ok) forgottenEntries += 1;
    else limitations.push(`notebook entry ${id}: ${mutation.reason ?? "not forgotten"}`);
  }
  const sessionKeys = new Set<string>(ask.sessionKeys ?? []);
  const explicitKeys = new Set(ask.candidateKeys ?? []);
  const affected = listMemoryCandidates(database).filter(
    (candidate) =>
      explicitKeys.has(candidate.key) ||
      (candidate.sourceSessionKey !== undefined && sessionKeys.has(candidate.sourceSessionKey)),
  );
  const affectedKeys = new Set([...affected.map((candidate) => candidate.key), ...explicitKeys]);
  const memory = readDurableMemoryFile(root, WORKSPACE_FILE.MEMORY);
  let removedMemoryEntries = 0;
  if (memory) {
    const promoted = new Set(promotedCandidateKeys(memory.content));
    const toRemove = new Set([...affectedKeys].filter((key) => promoted.has(key)));
    const scrubbed = removePromotedEntries(memory.content, toRemove);
    if (scrubbed.unattributed > 0) {
      limitations.push(
        `${scrubbed.unattributed} MEMORY.md entr${scrubbed.unattributed === 1 ? "y" : "ies"} carr${scrubbed.unattributed === 1 ? "ies" : "y"} a source reference but no promotion marker; attribution was lost to a manual edit and they were left in place`,
      );
    }
    if (toRemove.size > 0 && scrubbed.content !== memory.content) {
      const published = publishMemoryRewrite(
        database,
        root,
        {
          path: WORKSPACE_FILE.MEMORY,
          phase: CONSOLIDATION_PHASE.DEEP,
          expectedHash: memory.hash,
          next: scrubbed.content,
          candidateKeys: [...toRemove],
        },
        now,
      );
      if (published.ok) removedMemoryEntries = scrubbed.removed;
      else limitations.push(`MEMORY.md: ${published.reason}`);
    }
  }
  const tombstones = [
    ...[...sessionKeys].map((id) => ({
      kind: FORGOTTEN_SOURCE_KIND.CONVERSATION,
      id,
      reason: ask.reason,
    })),
    ...[...affectedKeys].map((id) => ({
      kind: FORGOTTEN_SOURCE_KIND.CANDIDATE,
      id,
      reason: ask.reason,
    })),
    ...affected.flatMap((candidate) =>
      candidate.sourceEventId
        ? [
            {
              kind: FORGOTTEN_SOURCE_KIND.HISTORY_LINE,
              id: candidate.sourceEventId,
              reason: ask.reason,
            },
          ]
        : [],
    ),
  ];
  const removedCandidates = database.transaction(() => {
    const remove = database.prepare("DELETE FROM memory_candidates WHERE key = ?");
    let removed = 0;
    for (const key of affectedKeys) removed += Number(remove.run(key).changes);
    tombstoneSources(database, tombstones, now);
    for (const sessionKey of sessionKeys) {
      database
        .prepare("DELETE FROM memory_ingested_messages WHERE session_key = ?")
        .run(sessionKey);
    }
    if (forgottenEntries > 0) removeIndexedPath(database, WORKSPACE_FILE.USER);
    return removed;
  });
  return {
    forgottenEntries,
    removedCandidates,
    removedMemoryEntries,
    tombstoned: tombstones.length,
    limitations,
    entries,
  };
}
