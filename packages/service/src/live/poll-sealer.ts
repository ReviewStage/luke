import { createHash } from "node:crypto";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@repo/features/live-wire";
import { Clock, Data, Effect } from "effect";
import type { SqlClient } from "effect/sql";

const DIGEST_COLUMN = "_live_digest";
const SNAPSHOT_COLUMN = "_live_snapshot";
const SNAPSHOT = "pg_current_snapshot()::text";

export const NO_ROWS_DIGEST = createHash("md5").update("").digest("hex");

export class SealRefused extends Data.TaggedError("SealRefused")<{ readonly reason: string }> {}

export interface LiveSealer {
  readonly url: string;
  readonly digest: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
  readonly seal: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
}

function digestOver(relation: string): string {
  return `(select md5(coalesce(string_agg(live_row.digest, '' order by live_row.digest collate "C"), '')) from (select md5(row_to_json(live_statement.*)::text) as digest from ${relation} as live_statement) as live_row)`;
}

function subqueryOf(statement: LiveStatement): string {
  return `(${statement.sql}\n)`;
}

function sealedSql(statement: LiveStatement): string {
  const first = (column: string) =>
    `case when row_number() over () = 1 then live_seal."${column}" end as "${column}"`;
  return `with live_rows as materialized ${subqueryOf(statement)} select ${first(DIGEST_COLUMN)}, ${first(SNAPSHOT_COLUMN)}, live_rows.* from (select ${digestOver("live_rows")} as "${DIGEST_COLUMN}", ${SNAPSHOT} as "${SNAPSHOT_COLUMN}") as live_seal left join live_rows on true`;
}

export function pollSealer(sql: SqlClient.SqlClient): LiveSealer {
  const refused = () => new SealRefused({ reason: "the statement could not be read" });
  return {
    url: LIVE_POLL_URL,
    digest: (statement) =>
      Effect.all({
        read: sql.unsafe<{ readonly digest: unknown; readonly snapshot: unknown }>(
          `select ${digestOver(subqueryOf(statement))} as digest, ${SNAPSHOT} as snapshot`,
          statement.params,
        ),
        now: Clock.currentTimeMillis,
      }).pipe(
        Effect.mapError(refused),
        Effect.flatMap(({ read, now }) => {
          const digest = read[0]?.digest;
          const snapshot = read[0]?.snapshot;
          if (typeof digest !== "string" || typeof snapshot !== "string") {
            return Effect.fail(refused());
          }
          return Effect.succeed({
            capability: LIVE_POLL_URL,
            queryFingerprint: LIVE_POLL_URL,
            expiresAt: now,
            digest,
            snapshot,
          });
        }),
      ),
    seal: (statement) =>
      Effect.all({
        read: sql.unsafe<Readonly<Record<string, unknown>>>(sealedSql(statement), statement.params),
        now: Clock.currentTimeMillis,
      }).pipe(
        Effect.mapError(refused),
        Effect.flatMap(({ read, now }) => {
          const digest = read[0]?.[DIGEST_COLUMN];
          const snapshot = read[0]?.[SNAPSHOT_COLUMN];
          if (typeof digest !== "string" || typeof snapshot !== "string") {
            return Effect.fail(refused());
          }
          const rows =
            digest === NO_ROWS_DIGEST
              ? []
              : read.map(
                  ({ [DIGEST_COLUMN]: _digest, [SNAPSHOT_COLUMN]: _snapshot, ...row }) => row,
                );
          return Effect.succeed({
            capability: LIVE_POLL_URL,
            queryFingerprint: LIVE_POLL_URL,
            expiresAt: now,
            rows,
            digest,
            snapshot,
          });
        }),
      ),
  };
}
