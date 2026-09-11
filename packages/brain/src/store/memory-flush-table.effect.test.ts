import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import { MEMORY_HOUSEKEEPING_OUTCOME } from "@sidecar/memory";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { flushStateEffect, recordFlushEffect } from "./memory-flush-table.js";
import { NOW, overStore } from "./testing.js";

describe("the flush marker over the client", () => {
  it.effect("answers nothing until a flush is recorded, then the state as recorded", () =>
    overStore(
      Effect.gen(function* () {
        assert.equal(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-1"), undefined);

        yield* recordFlushEffect(MAIN_SESSION_KEY, {
          generationId: "gen-1",
          compactionCount: 2,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
          flushedAt: NOW,
        });

        assert.deepEqual(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-1"), {
          generationId: "gen-1",
          compactionCount: 2,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
          flushedAt: NOW,
        });
      }),
    ),
  );

  it.effect("answers nothing for a generation whose marker names a different one", () =>
    overStore(
      Effect.gen(function* () {
        yield* recordFlushEffect(MAIN_SESSION_KEY, {
          generationId: "gen-1",
          compactionCount: 0,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
          flushedAt: NOW,
        });

        assert.equal(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-2"), undefined);
      }),
    ),
  );

  it.effect("a second record for the same session replaces the marker, not adds one", () =>
    overStore(
      Effect.gen(function* () {
        yield* recordFlushEffect(MAIN_SESSION_KEY, {
          generationId: "gen-1",
          compactionCount: 0,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
          flushedAt: NOW,
        });
        yield* recordFlushEffect(MAIN_SESSION_KEY, {
          generationId: "gen-2",
          compactionCount: 1,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
          flushedAt: NOW + 1,
        });

        assert.equal(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-1"), undefined);
        assert.deepEqual(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-2"), {
          generationId: "gen-2",
          compactionCount: 1,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
          flushedAt: NOW + 1,
        });
      }),
    ),
  );

  it.effect("an outcome this build does not name reads as no recorded flush", () =>
    overStore(
      Effect.gen(function* () {
        const sql = yield* Client.SqlClient;
        yield* sql`INSERT INTO memory_flush_state
                     (session_key, generation_id, compaction_count, outcome, flushed_at)
                   VALUES (${MAIN_SESSION_KEY}, ${"gen-1"}, ${0}, ${"not-an-outcome"}, ${NOW})`;

        assert.equal(yield* flushStateEffect(MAIN_SESSION_KEY, "gen-1"), undefined);
      }),
    ),
  );
});
