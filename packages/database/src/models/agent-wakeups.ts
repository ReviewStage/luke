import { asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentWakeupTable } from "../schemas/agent-wakeup.js";

type WakeupEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

export interface AgentWakeup {
  readonly at: Date;
  readonly prompt: string;
}

export interface ClaimedAgentWakeup {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly prompt: string;
  readonly dueAt: Date;
}

const deleteOfAgent = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) => db.delete(agentWakeupTable).where(eq(agentWakeupTable.agentId, agentId))),
});

const insertWakeups = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    wakeups: Schema.Array(Schema.Struct({ at: Schema.Date, prompt: Schema.String })),
  }),
  execute: ({ agentId, wakeups }) =>
    Database.use((db) =>
      db
        .insert(agentWakeupTable)
        .values(wakeups.map(({ at, prompt }) => ({ agentId, prompt, dueAt: at }))),
    ),
});

const deleteSpent = SqlSchema.void({
  Request: Schema.Struct({ maxAttempts: Schema.Int }),
  execute: ({ maxAttempts }) =>
    Database.use((db) =>
      db
        .delete(agentWakeupTable)
        .where(
          sql`${gte(agentWakeupTable.attempts, maxAttempts)} or ${inArray(
            agentWakeupTable.agentId,
            db
              .select({ id: agentTable.id })
              .from(agentTable)
              .where(isNotNull(agentTable.archivedAt)),
          )}`,
        ),
    ),
});

const ClaimedRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  userId: Schema.String,
  prompt: Schema.String,
  dueAt: Schema.Date,
});

const lockDue = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, limit: Schema.Int }),
  Result: ClaimedRowSchema,
  execute: ({ now, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: agentWakeupTable.id,
          agentId: agentWakeupTable.agentId,
          userId: agentTable.userId,
          prompt: agentWakeupTable.prompt,
          dueAt: agentWakeupTable.dueAt,
        })
        .from(agentWakeupTable)
        .innerJoin(agentTable, eq(agentTable.id, agentWakeupTable.agentId))
        .where(lte(agentWakeupTable.dueAt, now))
        .orderBy(asc(agentWakeupTable.dueAt), asc(agentWakeupTable.id))
        .limit(limit)
        .for("update", { of: agentWakeupTable, skipLocked: true }),
    ),
});

const writeNextDelivery = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), next: Schema.Date }),
  execute: ({ ids, next }) =>
    Database.use((db) =>
      db
        .update(agentWakeupTable)
        .set({ dueAt: next, attempts: sql`${agentWakeupTable.attempts} + 1` })
        .where(inArray(agentWakeupTable.id, ids)),
    ),
});

const standsOne = SqlSchema.findAll({
  Request: Schema.Struct({ id: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id }) =>
    Database.use((db) =>
      db
        .select({ id: agentWakeupTable.id })
        .from(agentWakeupTable)
        .where(eq(agentWakeupTable.id, id)),
    ),
});

const deleteOne = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String }),
  execute: ({ id }) =>
    Database.use((db) => db.delete(agentWakeupTable).where(eq(agentWakeupTable.id, id))),
});

export function replaceAgentWakeups(
  agentId: string,
  wakeups: readonly AgentWakeup[],
): WakeupEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* deleteOfAgent({ agentId });
        if (wakeups.length > 0) yield* insertWakeups({ agentId, wakeups });
      }),
    ),
  );
}

export function claimDueAgentWakeups(
  now: Date,
  next: Date,
  limit: number,
  maxAttempts: number,
): WakeupEffect<readonly ClaimedAgentWakeup[]> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* deleteSpent({ maxAttempts });
        const due = yield* lockDue({ now, limit });
        if (due.length > 0) yield* writeNextDelivery({ ids: due.map((row) => row.id), next });
        return due;
      }),
    ),
  );
}

export function agentWakeupStands(id: string): WakeupEffect<boolean> {
  return Effect.map(standsOne({ id }), (rows) => rows.length > 0);
}

export function deleteAgentWakeup(id: string): WakeupEffect<void> {
  return deleteOne({ id });
}
