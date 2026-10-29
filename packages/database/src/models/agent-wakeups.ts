/**
 * agent-wakeups.ts -- the wakeups a native agent's released wait left, kept until the scheduled sweep delivers each.
 *
 * A release replaces the agent's wakeups whole, since the CLI's own list as
 * it waited is the whole of what it would have fired. The same call with no
 * wakeups deletes them: on a Stop, which ends a CLI's wakeups with it, and
 * as any launch starts, since the CLI restores on resume the tasks it can
 * and the agent then owns them again, a copy Luke kept would fire twice or
 * after the agent cancelled it (`../schemas/agent-wakeup.ts`).
 *
 * A claim takes the wakeups due, the longest due first and at most a batch,
 * under row locks a concurrent claim skips rather than waits on, and moves
 * each one's next delivery on before the locks go: Vercel may call the
 * minute's sweep twice, and the second claim must find nothing left. The
 * claim's move is the delivery's lease: a delivery asks just before it sends
 * whether its wakeup still stands, so one a Stop or a launch deleted since
 * the claim is not sent, and deletes it once the send landed. One whose send
 * failed, or whose sweep ended mid-send, stands to be claimed again at its
 * next delivery, its message sent under the same key so a send that did land
 * is told once (`native-wakeup-sweep.ts`), until `attempts` reaches the bound
 * the claim is handed, when the claim deletes it instead. An archived agent
 * takes no wakeup, so the claim deletes its wakeups too. A wakeup of an
 * agent on a child task of a pilot tree whose Running switch is off
 * (`readTreeStopped`) is held: not handed out, its next delivery moved on
 * without counting an attempt, so it fires once Running is on again.
 */

import { asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentWakeupTable } from "../schemas/agent-wakeup.js";
import { readTreeStopped } from "./task-store.js";

type WakeupEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** How many batches one claim locks at most, so wakeups held for a stopped tree free their places for others without the claim's work growing unbounded. */
const MAX_CLAIM_ROUNDS = 5;

/** One wakeup as a release names it: the instant it comes due and the prompt delivered then. */
export interface AgentWakeup {
  readonly at: Date;
  readonly prompt: string;
}

/** One wakeup a claim took: its row, the agent it is for and that agent's starter, and the prompt to deliver. */
export interface ClaimedAgentWakeup {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly prompt: string;
  readonly dueAt: Date;
  /** The task the agent works on; null for one on none. */
  readonly taskId: string | null;
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

/** The rows no claim delivers again: given up past the bound, or of an archived agent. */
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
  taskId: Schema.NullOr(Schema.String),
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
          taskId: agentTable.taskId,
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

const holdDelivery = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), next: Schema.Date }),
  execute: ({ ids, next }) =>
    Database.use((db) =>
      db.update(agentWakeupTable).set({ dueAt: next }).where(inArray(agentWakeupTable.id, ids)),
    ),
});

/** The wakeups among those due whose agent works on a child task of a stopped pilot tree, each task read once as its account. */
const heldOf = (due: readonly ClaimedAgentWakeup[]) =>
  Effect.gen(function* () {
    const stopped = new Map<string, boolean>();
    const held = new Set<string>();
    for (const { id, taskId, userId } of due) {
      if (taskId === null) continue;
      if (!stopped.has(taskId)) stopped.set(taskId, yield* readTreeStopped(userId, taskId));
      if (stopped.get(taskId) === true) held.add(id);
    }
    return held;
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

/** The agent's wakeups replaced by those given, none deleting them all. */
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

/**
 * Claims at most `limit` of the wakeups due at `now`, each next delivered at
 * `next` should this delivery fail, after deleting those claimed
 * `maxAttempts` times already and an archived agent's. A wakeup held while
 * its agent's pilot tree is stopped is not claimed: it is due again at
 * `next`, its attempts as they stood, and its place in the batch goes to the
 * next wakeup due, over at most `MAX_CLAIM_ROUNDS` batches, so held wakeups
 * never starve the others.
 */
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
        const claimed: ClaimedAgentWakeup[] = [];
        // Every row a batch locked moves past `now` before the next, so no batch locks it again.
        for (let round = 0; round < MAX_CLAIM_ROUNDS && claimed.length < limit; round++) {
          const due = yield* lockDue({ now, limit: limit - claimed.length });
          const held = yield* heldOf(due);
          const taken = due.filter((row) => !held.has(row.id));
          if (taken.length > 0) yield* writeNextDelivery({ ids: taken.map((row) => row.id), next });
          claimed.push(...taken);
          if (held.size === 0) break;
          yield* holdDelivery({ ids: [...held], next });
        }
        return claimed;
      }),
    ),
  );
}

/** Whether the wakeup still stands, as a delivery asks just before it sends: a Stop or a launch since its claim deleted it. */
export function agentWakeupStands(id: string): WakeupEffect<boolean> {
  return Effect.map(standsOne({ id }), (rows) => rows.length > 0);
}

/** The wakeup delivered, so no claim takes it again. */
export function deleteAgentWakeup(id: string): WakeupEffect<void> {
  return deleteOne({ id });
}
