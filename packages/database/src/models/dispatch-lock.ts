import { sql } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";

/**
 * The conversation's dispatch lock: a transaction-scoped advisory lock, one
 * per conversation, apart from the conversation's row lock. A hand-over to
 * eve holds it exclusively for as long as eve takes to answer, so one
 * conversation's dispatches run one at a time and in order, as they did
 * under the row lock; every other write that must not cross a hand-over
 * (taking a line into a turn, an archive, a native runner's events) holds it
 * shared before it takes the row lock, and so waits one out. The run
 * stream's journal never takes it, which is the point: it writes four times
 * a second, and a hand-over may take thirty seconds.
 *
 * Note that the order is always this lock, then the row lock, never the
 * reverse, so a dispatch that takes the row lock to write what eve answered
 * and a write waiting on the dispatch never wait on each other. A session
 * holding the lock exclusively takes it shared again at once, so a write the
 * dispatch makes through the writer passes. Both forms are released when the
 * transaction they ran in ends, and must run in one: outside one, the lock is
 * released as the statement ends.
 */

/** The advisory locks' first key, which no other lock in the store uses; the second is the conversation's id hashed. */
const DISPATCH_LOCK_CLASS = 4_351_001;

const DispatchLockSchema = Schema.Struct({ conversationId: Schema.String });

const lockExclusively = SqlSchema.void({
  Request: DispatchLockSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db.execute(
        sql`select pg_advisory_xact_lock(${DISPATCH_LOCK_CLASS}::int4, hashtext(${conversationId}))`,
      ),
    ),
});

const lockShared = SqlSchema.void({
  Request: DispatchLockSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db.execute(
        sql`select pg_advisory_xact_lock_shared(${DISPATCH_LOCK_CLASS}::int4, hashtext(${conversationId}))`,
      ),
    ),
});

/** Holds the conversation's dispatch lock for the rest of the transaction, alone: no other dispatch, and no write that waits one out, runs in the conversation meanwhile. */
export function holdConversationDispatch(
  conversationId: string,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return lockExclusively({ conversationId });
}

/** Waits out any hand-over to eve under way in the conversation, and keeps the next from starting until the transaction ends. */
export function waitOutConversationDispatch(
  conversationId: string,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return lockShared({ conversationId });
}
