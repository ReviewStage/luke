import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { user } from "../../db/auth-schema.js";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";

/**
 * Clear as a soft delete, and the purge that follows it. Nothing is erased
 * at the Clear: the main conversation standing for the account is stamped
 * `deleted_at`, every descendant of it with it, and a new main row is
 * opened in the same transaction, so the reads — which skip a stamped row —
 * show an empty main from the call after the Clear while the rows stand
 * until the purge. The Clear takes the account's user row lock first, so two
 * Clears run one after the other and a child spawned mid-Clear is stamped
 * with its parent; the partial unique index over the standing main is what
 * refuses a second one however the lock is held. There is no archive, no registry, and no cutoff: the
 * stamp is the whole record of the Clear, and the cron's purge removes the
 * stamped conversations thirty days on, their messages, turns, events, and
 * children going with them by the schema's own cascade. A Clear reaches
 * neither the notebook nor any provider's file; deleting the account
 * cascades everything at once, stamped or not.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ClearOutcome {
  /** The main conversation the Clear stamped, and every descendant stamped with it; empty when none stood. */
  readonly cleared: readonly string[];
  /** The main conversation opened in its place. */
  readonly opened: string;
}

type ClearFailure = SqlError | Schema.SchemaError;

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** Takes the account's row lock for the transaction, so two Clears of one account run one after the other. */
const lockUser = (userId: string) =>
  db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");

const StampMainSchema = Schema.Struct({ userId: Schema.String, deletedAt: Schema.Date });

const stampMain = SqlSchema.findAll({
  Request: StampMainSchema,
  Result: IdRowSchema,
  execute: (write) =>
    db
      .update(conversations)
      .set({ deletedAt: write.deletedAt })
      .where(
        and(
          eq(conversations.userId, write.userId),
          eq(conversations.kind, CONVERSATION_KIND.MAIN),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
});

const StampChildrenSchema = Schema.Struct({
  parents: Schema.Array(Schema.String),
  deletedAt: Schema.Date,
});

const stampChildren = SqlSchema.findAll({
  Request: StampChildrenSchema,
  Result: IdRowSchema,
  execute: (write) =>
    db
      .update(conversations)
      .set({ deletedAt: write.deletedAt })
      .where(
        and(
          inArray(conversations.parentConversationId, [...write.parents]),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
});

/** Stamps every not-yet-stamped child of the given rows, level by level, and answers every id stamped. */
export const stampDescendants = /* @__PURE__ */ Effect.fn("stampDescendants")(function* (
  parents: readonly string[],
  deletedAt: Date,
): Effect.fn.Return<string[], ClearFailure, SqlClient.SqlClient> {
  const stamped: string[] = [];
  let frontier = parents;
  while (frontier.length > 0) {
    const children = yield* stampChildren({ parents: [...frontier], deletedAt });
    frontier = children.map((child) => child.id);
    stamped.push(...frontier);
  }
  return stamped;
});

const OpenMainSchema = Schema.Struct({ userId: Schema.String, now: Schema.Date });

const openMain = SqlSchema.findOneOption({
  Request: OpenMainSchema,
  Result: IdRowSchema,
  execute: (write) =>
    db
      .insert(conversations)
      .values({
        userId: write.userId,
        kind: CONVERSATION_KIND.MAIN,
        createdAt: write.now,
        lastActivityAt: write.now,
      })
      .returning({ id: conversations.id }),
});

export function clearMainConversation(
  userId: string,
  now: Date,
): Effect.Effect<ClearOutcome, ClearFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(userId);
        const stamped = yield* stampMain({ userId, deletedAt: now });
        const mainIds = stamped.map((row) => row.id);
        const descendants = yield* stampDescendants(mainIds, now);
        const opened = yield* openMain({ userId, now });
        if (Option.isNone(opened)) throw new Error("the Clear opened no main conversation");
        return { cleared: [...mainIds, ...descendants], opened: opened.value.id };
      }),
    ),
  );
}

const purgeRows = SqlSchema.findAll({
  Request: Schema.Date,
  Result: IdRowSchema,
  execute: (edge) =>
    db
      .delete(conversations)
      .where(lte(conversations.deletedAt, edge))
      .returning({ id: conversations.id }),
});

/**
 * Removes every conversation stamped at or before the retention window's
 * edge, across every account; the schema cascades the rows beneath each.
 * Answers how many conversations went, descendants counted where they were
 * stamped themselves and not where the cascade alone took them.
 */
export function purgeClearedConversations(
  now: Date,
): Effect.Effect<number, ClearFailure, SqlClient.SqlClient> {
  const edge = new Date(now.getTime() - CLEARED_CONVERSATION_RETENTION_MS);
  return Effect.map(purgeRows(edge), (rows) => rows.length);
}
