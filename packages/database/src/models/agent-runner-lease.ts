import { and, eq, lte } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentRunnerLeaseTable } from "../schemas/agent-runner-lease.js";

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
        .insert(agentRunnerLeaseTable)
        .values({ agentId, holder, heldUntil })
        .onConflictDoUpdate({
          target: agentRunnerLeaseTable.agentId,
          set: { holder, heldUntil },
          setWhere: lte(agentRunnerLeaseTable.heldUntil, now),
        })
        .returning({ holder: agentRunnerLeaseTable.holder }),
    ),
});

const releaseOne = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, holder: Schema.String }),
  execute: ({ agentId, holder }) =>
    Database.use((db) =>
      db
        .delete(agentRunnerLeaseTable)
        .where(
          and(eq(agentRunnerLeaseTable.agentId, agentId), eq(agentRunnerLeaseTable.holder, holder)),
        ),
    ),
});

export function claimAgentRunnerLease(
  agentId: string,
  holder: string,
  now: Date,
  heldUntil: Date,
): LeaseEffect<boolean> {
  return Effect.map(claimOne({ agentId, holder, now, heldUntil }), (rows) =>
    rows.some((row) => row.holder === holder),
  );
}

export function releaseAgentRunnerLease(agentId: string, holder: string): LeaseEffect<void> {
  return releaseOne({ agentId, holder });
}
