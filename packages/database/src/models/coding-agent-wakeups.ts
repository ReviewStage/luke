/**
 * coding-agent-wakeups.ts -- the wakeups a native agent's released wait left, kept until the scheduled sweep delivers each.
 *
 * A release replaces the agent's wakeups whole, since the CLI's own list as
 * it waited is the whole of what it would have fired. The same call with no
 * wakeups deletes them: on a Stop, which ends a CLI's wakeups with it, and
 * as any launch starts, since the CLI restores on resume the tasks it can
 * and the agent then owns them again, a copy Luke kept would fire twice or
 * after the agent cancelled it (`../schemas/coding-agent-wakeup.ts`).
 *
 * A claim takes the wakeups due, the longest due first and at most a batch,
 * under row locks a concurrent claim skips rather than waits on, and moves
 * each one's next delivery on before the locks go: Vercel may call the
 * minute's sweep twice, and the second claim must find nothing left. A
 * delivery then takes its wakeup, deleting it, before it sends, so one a
 * Stop or a launch deleted since the claim is not sent; one whose send
 * fails is put back as claimed, to be claimed again at its next delivery,
 * until `attempts` reaches the bound the claim is handed, when the claim
 * deletes it instead. An archived agent takes no wakeup, so the claim
 * deletes its wakeups too.
 */

import { asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { codingAgentWakeup } from "../schemas/coding-agent-wakeup.js";

type WakeupEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** One wakeup as a release names it: the instant it comes due and the prompt delivered then. */
export interface CodingAgentWakeup {
  readonly at: Date;
  readonly prompt: string;
}

/** One wakeup a claim took: its row, the agent it is for and that agent's starter, and the prompt to deliver. */
export interface ClaimedCodingAgentWakeup {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly prompt: string;
  readonly dueAt: Date;
}

const deleteOfAgent = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db.delete(codingAgentWakeup).where(eq(codingAgentWakeup.agentId, agentId)),
    ),
});

const insertWakeups = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    wakeups: Schema.Array(Schema.Struct({ at: Schema.Date, prompt: Schema.String })),
  }),
  execute: ({ agentId, wakeups }) =>
    Database.use((db) =>
      db
        .insert(codingAgentWakeup)
        .values(wakeups.map(({ at, prompt }) => ({ agentId, prompt, dueAt: at }))),
    ),
});

/** The rows no claim delivers again: given up past the bound, or of an archived agent. */
const deleteSpent = SqlSchema.void({
  Request: Schema.Struct({ maxAttempts: Schema.Int }),
  execute: ({ maxAttempts }) =>
    Database.use((db) =>
      db
        .delete(codingAgentWakeup)
        .where(
          sql`${gte(codingAgentWakeup.attempts, maxAttempts)} or ${inArray(
            codingAgentWakeup.agentId,
            db
              .select({ id: codingAgent.id })
              .from(codingAgent)
              .where(isNotNull(codingAgent.archivedAt)),
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
          id: codingAgentWakeup.id,
          agentId: codingAgentWakeup.agentId,
          userId: codingAgent.userId,
          prompt: codingAgentWakeup.prompt,
          dueAt: codingAgentWakeup.dueAt,
        })
        .from(codingAgentWakeup)
        .innerJoin(codingAgent, eq(codingAgent.id, codingAgentWakeup.agentId))
        .where(lte(codingAgentWakeup.dueAt, now))
        .orderBy(asc(codingAgentWakeup.dueAt), asc(codingAgentWakeup.id))
        .limit(limit)
        .for("update", { of: codingAgentWakeup, skipLocked: true }),
    ),
});

const writeNextDelivery = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), next: Schema.Date }),
  execute: ({ ids, next }) =>
    Database.use((db) =>
      db
        .update(codingAgentWakeup)
        .set({ dueAt: next, attempts: sql`${codingAgentWakeup.attempts} + 1` })
        .where(inArray(codingAgentWakeup.id, ids)),
    ),
});

const TakenRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  prompt: Schema.String,
  dueAt: Schema.Date,
  attempts: Schema.Int,
});

const deleteReturning = SqlSchema.findAll({
  Request: Schema.Struct({ id: Schema.String }),
  Result: TakenRowSchema,
  execute: ({ id }) =>
    Database.use((db) =>
      db.delete(codingAgentWakeup).where(eq(codingAgentWakeup.id, id)).returning({
        id: codingAgentWakeup.id,
        agentId: codingAgentWakeup.agentId,
        prompt: codingAgentWakeup.prompt,
        dueAt: codingAgentWakeup.dueAt,
        attempts: codingAgentWakeup.attempts,
      }),
    ),
});

const insertTaken = SqlSchema.void({
  Request: TakenRowSchema,
  execute: (row) =>
    Database.use((db) => db.insert(codingAgentWakeup).values(row).onConflictDoNothing()),
});

/** The agent's wakeups replaced by those given, none deleting them all. */
export function replaceCodingAgentWakeups(
  agentId: string,
  wakeups: readonly CodingAgentWakeup[],
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

/**
 * Claims at most `limit` of the wakeups due at `now`, each next delivered at
 * `next` should this delivery fail, after deleting those claimed
 * `maxAttempts` times already and an archived agent's.
 */
export function claimDueCodingAgentWakeups(
  now: Date,
  next: Date,
  limit: number,
  maxAttempts: number,
): WakeupEffect<readonly ClaimedCodingAgentWakeup[]> {
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

/** A wakeup a claim took, as a delivery takes it, gone from the table until it is put back. */
export type TakenCodingAgentWakeup = typeof TakenRowSchema.Type;

/** The wakeup taken for its delivery, deleted so nothing else sends it; none where a Stop, a launch, or another delivery took it since the claim. */
export function takeCodingAgentWakeup(
  id: string,
): WakeupEffect<Option.Option<TakenCodingAgentWakeup>> {
  return Effect.map(deleteReturning({ id }), (rows) => Option.fromNullishOr(rows[0]));
}

/** A taken wakeup whose delivery failed, put back as the claim left it, for its next delivery. */
export function restoreCodingAgentWakeup(taken: TakenCodingAgentWakeup): WakeupEffect<void> {
  return insertTaken(taken);
}
