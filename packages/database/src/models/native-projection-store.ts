import { type WireValue, WireValueSchema } from "@luke/wire";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
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
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({
    sequence: Schema.NullOr(Schema.Number),
    projection: Schema.NullOr(WireValueSchema),
  }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          sequence: conversations.nativeSequence,
          projection: conversations.nativeProjection,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        )
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
 * made; nothing for a conversation the account does not hold or that was
 * cleared, where `apply` never runs.
 */
export function withNativeProjection<A, E, R>(
  target: ConversationTarget,
  apply: (held: NativeProjectionRow) => Effect.Effect<NativeProjectionApplied<A>, E, R>,
): Effect.Effect<Option.Option<A>, E | NativeProjectionFailure, R | DatabaseServices> {
  const locked = Effect.gen(function* () {
    const held = yield* lockProjectionRow(target);
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
