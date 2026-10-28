import { createHash } from "node:crypto";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Data, Effect } from "effect";
import type { SqlClient } from "effect/sql";

/**
 * poll-sealer.ts -- a live read answered polled: each statement's rows read inline with the digest Postgres computes of them, or that digest alone.
 *
 * Every live read is answered this way, at `LIVE_POLL_URL`, already
 * expired, with each statement's rows and a digest of where they stand
 * (`liveDigestOf` joins a read's digests into the one value a reader sends
 * back as `after`). Postgres computes the digest beside the rows, so a held
 * read can look at where its rows stand (`digest`) without one of them
 * leaving the database, and read them (`seal`) only once they moved. No
 * secret stands here, so the capability and fingerprint say only where to
 * poll.
 */

/** The column a sealed statement answers its digest under, beside the statement's own: no wire key starts with an underscore. */
const DIGEST_COLUMN = "_live_digest";

/** The digest of no rows: `md5` of the empty concatenation `digestOver` takes of them, which is what Postgres answers for none. */
export const NO_ROWS_DIGEST = createHash("md5").update("").digest("hex");

/** Why a statement could not be answered: its rows, or their digest, could not be read. */
export class SealRefused extends Data.TaggedError("SealRefused")<{ readonly reason: string }> {}

/** How a live read's statements are answered, and the address the answer names. */
export interface LiveSealer {
  readonly url: string;
  /** Where the statement's rows stand now, its digest and none of its rows, as an unchanged answer carries it. */
  readonly digest: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
  /** The statement's rows now, and their digest. */
  readonly seal: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
}

/**
 * The digest of the rows of `relation` as one SQL expression: an `md5` of
 * each row's own `md5` of its JSON text, joined in sorted order, so the same
 * rows in another order, which Postgres may answer, digest alike, and a
 * change to any column of any row moves it. The text is stable for the same
 * rows, since a live statement selects instants as epoch milliseconds and
 * calls only immutable functions (`live-statement.ts`).
 *
 * Note that the row is named `live_statement.*` rather than by its alias
 * alone, because a bare alias names the column of that name where the
 * statement selects one.
 */
function digestOver(relation: string): string {
  return `(select md5(coalesce(string_agg(live_row.digest, '' order by live_row.digest collate "C"), '')) from (select md5(row_to_json(live_statement.*)::text) as digest from ${relation} as live_statement) as live_row)`;
}

/** The statement as a subquery, its own `$n` placeholders kept, closed on a line of its own so nothing it ends with runs on past it. */
function subqueryOf(statement: LiveStatement): string {
  return `(${statement.sql}\n)`;
}

/**
 * The statement's rows and their digest, read from one statement: its rows
 * are read once into `live_rows`, and the digest is taken over those same
 * rows, so it is the digest of exactly the rows answered. It rides on the
 * first row alone, so it costs a row's bytes once rather than on every row.
 */
function sealedSql(statement: LiveStatement): string {
  return `with live_rows as materialized ${subqueryOf(statement)} select case when row_number() over () = 1 then ${digestOver("live_rows")} end as "${DIGEST_COLUMN}", live_rows.* from live_rows`;
}

/** The sealer that reads rather than seals, over the service's own database client. */
export function pollSealer(sql: SqlClient.SqlClient): LiveSealer {
  const refused = () => new SealRefused({ reason: "the statement could not be read" });
  return {
    url: LIVE_POLL_URL,
    digest: (statement) =>
      Effect.all({
        read: sql.unsafe<{ readonly digest: unknown }>(
          `select ${digestOver(subqueryOf(statement))} as digest`,
          statement.params,
        ),
        now: Clock.currentTimeMillis,
      }).pipe(
        Effect.mapError(refused),
        Effect.flatMap(({ read, now }) => {
          const digest = read[0]?.digest;
          if (typeof digest !== "string") return Effect.fail(refused());
          return Effect.succeed({
            capability: LIVE_POLL_URL,
            queryFingerprint: LIVE_POLL_URL,
            expiresAt: now,
            digest,
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
          const first = read[0];
          const digest = first === undefined ? NO_ROWS_DIGEST : first[DIGEST_COLUMN];
          if (typeof digest !== "string") return Effect.fail(refused());
          return Effect.succeed({
            capability: LIVE_POLL_URL,
            queryFingerprint: LIVE_POLL_URL,
            expiresAt: now,
            rows: read.map(({ [DIGEST_COLUMN]: _digest, ...row }) => row),
            digest,
          });
        }),
      ),
  };
}
