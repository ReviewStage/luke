/**
 * coding-agent-runner-lease.ts -- the lease a call takes on a native agent's runner before it reads where the runner stands and writes to it or launches it, and lets go after.
 *
 * A claim takes the agent's lease where no lease stands or the one standing
 * lapsed, in one statement, so of two claims at once exactly one holds it.
 * A release deletes the lease only while the holder named still holds it, so
 * a call whose lease lapsed and was taken by another never lets the other's
 * go (`../schemas/coding-agent-runner-lease.ts`).
 */

import { and, eq, lte } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgentRunnerLease } from "../schemas/coding-agent-runner-lease.js";

type LeaseEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

const claimOne = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    holder: Schema.String,
    now: Schema.Date,
    heldUntil: Schema.Date,
  }),
  Result: Schema.Struct({ holder: Schema.String }),
  execute: ({ agentId, holder, now, heldUntil }) =>
    Database.use((db) =>
      db
        .insert(codingAgentRunnerLease)
        .values({ agentId, holder, heldUntil })
        .onConflictDoUpdate({
          target: codingAgentRunnerLease.agentId,
          set: { holder, heldUntil },
          // Taken over only once the lease standing lapsed.
          setWhere: lte(codingAgentRunnerLease.heldUntil, now),
        })
        .returning({ holder: codingAgentRunnerLease.holder }),
    ),
});

const releaseOne = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, holder: Schema.String }),
  execute: ({ agentId, holder }) =>
    Database.use((db) =>
      db
        .delete(codingAgentRunnerLease)
        .where(
          and(
            eq(codingAgentRunnerLease.agentId, agentId),
            eq(codingAgentRunnerLease.holder, holder),
          ),
        ),
    ),
});

/** Whether the holder took the agent's runner lease at `now`, held until `heldUntil`: false while another's stands unlapsed. */
export function claimCodingAgentRunnerLease(
  agentId: string,
  holder: string,
  now: Date,
  heldUntil: Date,
): LeaseEffect<boolean> {
  return Effect.map(claimOne({ agentId, holder, now, heldUntil }), (rows) =>
    rows.some((row) => row.holder === holder),
  );
}

/** The agent's runner lease let go, where the holder named still holds it. */
export function releaseCodingAgentRunnerLease(agentId: string, holder: string): LeaseEffect<void> {
  return releaseOne({ agentId, holder });
}
