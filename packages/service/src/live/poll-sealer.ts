import { createHash } from "node:crypto";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Data, Effect } from "effect";
import type { SqlClient } from "effect/sql";

/**
 * poll-sealer.ts -- a live read answered polled: each statement run now on the service's own database client, its rows inline and digested.
 *
 * Every live read is answered this way, at `LIVE_POLL_URL`, already
 * expired, with each statement's rows and a digest of where they stand
 * (`liveDigestOf` joins a read's digests into the one value a reader sends
 * back as `after`). No secret stands here, so the capability and
 * fingerprint say only where to poll.
 */

/** How many characters of a polled statement's digest it carries: far more than two readings of its rows could share by chance. */
const DIGEST_CHARS = 32;

/** Why a statement could not be answered: its rows could not be read. */
export class SealRefused extends Data.TaggedError("SealRefused")<{ readonly reason: string }> {}

/** How a live read's statements are answered, and the address the answer names. */
export interface LiveSealer {
  readonly url: string;
  readonly seal: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
}

/** The sealer that reads rather than seals, over the service's own database client. */
export function pollSealer(sql: SqlClient.SqlClient): LiveSealer {
  return {
    url: LIVE_POLL_URL,
    seal: (statement) =>
      Effect.all({
        rows: sql.unsafe<object>(statement.sql, statement.params),
        now: Clock.currentTimeMillis,
      }).pipe(
        Effect.map(({ rows, now }) => ({
          capability: LIVE_POLL_URL,
          queryFingerprint: LIVE_POLL_URL,
          expiresAt: now,
          rows,
          // Each row's text in sorted order, so the same rows in another order, which Postgres may answer, digest alike.
          digest: createHash("sha256")
            .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).toSorted()))
            .digest("hex")
            .slice(0, DIGEST_CHARS),
        })),
        Effect.mapError(() => new SealRefused({ reason: "the statement could not be read" })),
      ),
  };
}
