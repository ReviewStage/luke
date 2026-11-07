/**
 * turn-lease.ts -- how long a coding agent's runner is held to be at work on a turn, and its renewal by the runner's posts.
 *
 * A turn queued or running carries a lease (`turns.lease_until`), set as it
 * is queued or started and pushed on by every post its runner makes, its
 * heartbeat among them (`@repo/agent-runner`'s `RUNNER_HEARTBEAT`), as a
 * queue's visibility timeout is pushed on by its consumer. Nothing watches
 * it: a reader takes a turn whose lease is past as its runner lost
 * (`@repo/features/agent-status`), and the next touch of the agent settles
 * it so (`./abandoned-turns.ts`'s `lapsedRunnerTurns`). The bound sits well
 * above the heartbeat, so a post or two lost on the way never lapses it.
 */

import { TURN_STATUS } from "@repo/wire";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { turns } from "../schemas/storage.js";

export const TURN_LEASE = {
  /** How long past the runner's last post its turn's lease runs: three heartbeats. */
  MS: 15 * 60 * 1000,
  /** How far a lease may run down before a post pushes it on, so a runner posting many batches a minute writes the row a few times an hour, never at each. */
  RENEW_AFTER_MS: 2 * 60 * 1000,
} as const;

/** The instant a lease taken at `at` runs until. */
export function leaseFrom(at: Date): Date {
  return new Date(at.getTime() + TURN_LEASE.MS);
}

/** The queued or running turns of the conversation whose lease runs out sooner than a renewal's worth from now, their leases pushed on; how many. */
const pushLeases = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    until: Schema.Date,
    before: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (request) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ leaseUntil: request.until })
        .where(
          and(
            eq(turns.conversationId, request.conversationId),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
            or(isNull(turns.leaseUntil), lt(turns.leaseUntil, request.before)),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

/**
 * Pushes on the lease of every turn still queued or running of the
 * conversation, as a post of its runner at `now` does; answers how many it
 * wrote. A lease with more than its renewal's worth still to run is left as
 * it stands, so most posts write nothing.
 */
export function renewTurnLease(
  conversationId: string,
  now: number,
): Effect.Effect<number, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    pushLeases({
      conversationId,
      until: new Date(now + TURN_LEASE.MS),
      before: new Date(now + TURN_LEASE.MS - TURN_LEASE.RENEW_AFTER_MS),
    }),
    (rows) => rows.length,
  );
}
