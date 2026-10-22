import { type WireValue, WireValueSchema } from "@luke/wire";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { conversations } from "../schemas/storage.js";
import { waitOutConversationDispatch } from "./dispatch-lock.js";
import type { ConversationTarget } from "./writer.js";

/**
 * native-projection-store.ts -- where the projection of a native harness's events keeps its place between the runner's batches.
 *
 * A runner posts its events in numbered batches and posts a batch again
 * until Luke takes it, so the projection keeps, on the conversation's own
 * row, the number of the last event it applied and what it holds of the
 * turn under way. Both are read under the row's lock and written in the
 * same transaction as everything the batch wrote, so a batch posted twice,
 * or two posts racing, apply each event once: the second waits on the lock
 * and finds the numbers already applied. The projection's own shape is the
 * service's; the store keeps it as the JSON it was handed and reads it back
 * unread.
 */

/** What the conversation keeps for its projection: the last event applied, and the projection's own state. */
export interface NativeProjectionRow {
  /** The number of the last event applied; null before the first. */
  readonly sequence: number | null;
  /** The projection's state as it was saved; null before the first save. */
  readonly projection: WireValue | null;
}

type NativeProjectionFailure = QueryError | Schema.SchemaError;

const lockProjectionRow = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    runnerTokenHash: Schema.String,
  }),
  Result: Schema.Struct({
    sequence: Schema.NullOr(Schema.Number),
    projection: Schema.NullOr(WireValueSchema),
  }),
  execute: ({ userId, conversationId, runnerTokenHash }) =>
    Database.use((db) =>
      db
        .select({
          sequence: conversations.nativeSequence,
          projection: conversations.nativeProjection,
        })
        .from(conversations)
        .innerJoin(codingAgent, eq(codingAgent.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            eq(codingAgent.runnerTokenHash, runnerTokenHash),
            isNull(conversations.deletedAt),
          ),
        )
        // Both rows: the conversation's for the projection, and the agent's, which a retire writes.
        .for("update"),
    ),
});

const findProjectionSequence = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ sequence: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ sequence: conversations.nativeSequence })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const findProjection = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ projection: Schema.NullOr(WireValueSchema) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ projection: conversations.nativeProjection })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const saveProjectionRow = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    sequence: Schema.Number,
    projection: WireValueSchema,
  }),
  execute: ({ userId, conversationId, sequence, projection }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeSequence: sequence, nativeProjection: projection })
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    ),
});

/** What one application of a batch answers: its own result, and the place to keep, where it moved. */
export interface NativeProjectionApplied<A> {
  readonly result: A;
  readonly saved?: { readonly sequence: number; readonly projection: WireValue };
}

/**
 * Runs `apply` over the conversation's projection row, under its lock, and
 * keeps the place it answers in the same transaction as every write `apply`
 * made; nothing for a conversation the account does not hold, that was
 * cleared, or whose runner holds a bearer of another digest by the time the
 * lock is taken, where `apply` never runs. Note that the digest is read
 * again under the lock, on the agent's row, which is locked with the
 * conversation's, because a bearer retired after the caller admitted it
 * takes that row's lock and must leave its runner writing nothing.
 */
export function withNativeProjection<A, E, R>(
  target: ConversationTarget,
  runnerTokenHash: string,
  apply: (held: NativeProjectionRow) => Effect.Effect<NativeProjectionApplied<A>, E, R>,
): Effect.Effect<Option.Option<A>, E | NativeProjectionFailure, R | DatabaseServices> {
  const locked = Effect.gen(function* () {
    // A line's hand-over to the runner under way is waited out, so the events it starts take the line in.
    yield* waitOutConversationDispatch(target.conversationId);
    const held = yield* lockProjectionRow({ ...target, runnerTokenHash });
    if (Option.isNone(held)) return Option.none<A>();
    const applied = yield* apply(held.value);
    if (applied.saved !== undefined) {
      yield* saveProjectionRow({ ...target, ...applied.saved });
    }
    return Option.some(applied.result);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/**
 * The number of the last event the conversation applied, which a relaunch
 * numbers its events after; nothing before the first, or for a conversation
 * the account does not hold or that was cleared.
 */
export function readNativeSequence(
  target: ConversationTarget,
): Effect.Effect<Option.Option<number>, NativeProjectionFailure, DatabaseServices> {
  return Effect.map(findProjectionSequence(target), (row) =>
    Option.flatMap(row, ({ sequence }) => Option.fromNullishOr(sequence)),
  );
}

/**
 * The projection's state as last saved, unread, for a reader outside the
 * events route (the MCP server reads which servers the turn under way took);
 * nothing before the first save, or for a conversation the account does not
 * hold or that was cleared.
 */
export function readNativeProjection(
  target: ConversationTarget,
): Effect.Effect<Option.Option<WireValue>, NativeProjectionFailure, DatabaseServices> {
  return Effect.map(findProjection(target), (row) =>
    Option.flatMap(row, ({ projection }) => Option.fromNullishOr(projection)),
  );
}

const dropProjectionTurn = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnIds: Schema.Array(Schema.String) }),
  execute: ({ conversationId, turnIds }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeProjection: sql`${conversations.nativeProjection} - 'turn'` })
        .where(
          and(
            eq(conversations.id, conversationId),
            inArray(sql<string>`${conversations.nativeProjection}->'turn'->>'id'`, [...turnIds]),
          ),
        ),
    ),
});

/**
 * Drops the turn the conversation's projection holds where it is one of the
 * turns named, settled apart from the runner's own end, so the next launch's
 * events open a turn of their own. Note that the projection's shape is the
 * service's, and this reads of it only the held turn's id (`turn.id`).
 */
export function dropNativeProjectionTurns(
  conversationId: string,
  turnIds: readonly string[],
): Effect.Effect<void, NativeProjectionFailure, DatabaseServices> {
  return turnIds.length === 0 ? Effect.void : dropProjectionTurn({ conversationId, turnIds });
}
