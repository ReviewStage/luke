import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import { MEMORY_HOUSEKEEPING_OUTCOME, type MemoryHousekeepingOutcome } from "@sidecar/memory";
import type { SessionKey } from "@sidecar/runtime/vocabulary";
import { Effect, Option, Schema } from "effect";
import { columnsDecoded } from "./rows.js";

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

const FlushRow = Schema.Struct({
  generation_id: Schema.String,
  compaction_count: Schema.Number,
  outcome: Schema.String,
  flushed_at: Schema.Number,
});

const flushRowAt = SqlSchema.findOne({
  Request: Schema.Struct({ sessionKey: Schema.String, generationId: Schema.String }),
  Result: FlushRow,
  execute: ({ sessionKey, generationId }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT generation_id, compaction_count, outcome, flushed_at FROM memory_flush_state
            WHERE session_key = ${sessionKey} AND generation_id = ${generationId}`,
    ),
});

/** The conversation's flush marker, only when it was written under the generation asked about. */
export const flushStateEffect = (
  sessionKey: SessionKey,
  generationId: string,
): Effect.Effect<FlushState | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(flushRowAt({ sessionKey, generationId })), (row) =>
    Option.match(row, {
      onNone: () => undefined,
      onSome: (found) => {
        const outcome = OUTCOMES.find((candidate) => candidate === found.outcome);
        // An outcome this build does not name reads as no recorded flush rather than as a failed one.
        if (!outcome) return undefined;
        return {
          generationId: found.generation_id,
          compactionCount: found.compaction_count,
          outcome,
          flushedAt: found.flushed_at,
        };
      },
    }),
  );

export const recordFlushEffect = (
  sessionKey: SessionKey,
  state: FlushState,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT INTO memory_flush_state (session_key, generation_id, compaction_count, outcome, flushed_at)
          VALUES (${sessionKey}, ${state.generationId}, ${state.compactionCount}, ${state.outcome},
                  ${state.flushedAt})
          ON CONFLICT(session_key) DO UPDATE SET generation_id = excluded.generation_id,
            compaction_count = excluded.compaction_count,
            outcome = excluded.outcome, flushed_at = excluded.flushed_at`,
  ).pipe(Effect.asVoid);
