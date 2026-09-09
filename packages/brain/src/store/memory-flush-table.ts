import { MEMORY_HOUSEKEEPING_OUTCOME, type MemoryHousekeepingOutcome } from "@sidecar/memory";
import type { SessionKey } from "@sidecar/runtime/vocabulary";
import type { StoreDatabase } from "./database.js";

/**
 * Where one conversation's flush marker outlives the process: the generation
 * and compaction cycle its last completed pre-compaction flush ran under, so
 * a relaunch neither flushes a cycle twice nor skips one.
 */

const OUTCOMES: readonly MemoryHousekeepingOutcome[] = Object.values(MEMORY_HOUSEKEEPING_OUTCOME);

/** A conversation's last recorded flush: the generation and compaction cycle it ran under, and how it ended. */
export interface FlushState {
  readonly generationId: string;
  readonly compactionCount: number;
  readonly outcome: MemoryHousekeepingOutcome;
  readonly flushedAt: number;
}

/** The conversation's flush marker, only when it was written under the generation asked about. */
export function flushState(
  database: StoreDatabase,
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
  database: StoreDatabase,
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
