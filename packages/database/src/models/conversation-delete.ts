import { inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations } from "../schemas/storage.js";

/**
 * The delete of a deleted task's or agent's conversations: their rows go at
 * once, in the transaction that deletes the task's or the agent's row
 * (`task-store.ts`, `agent-store.ts`), so the two deletes keep one promise
 * about when the words go. There is no archive, no registry, and no window:
 * the schema's own cascade takes each conversation's messages, turns, and
 * events, and every conversation delegated from it, a worker's under its
 * agent's, with it. Deleting the account cascades everything at once. The
 * sandbox a deleted conversation's session ran in is not deleted here: its
 * snapshots expire on Vercel's own schedule (`CODER.SANDBOX_SNAPSHOTS`),
 * seven days after it was last used.
 *
 * Note that the cascade's cost is the conversation's own size: each child
 * table finds the rows it deletes through its conversation's or its turn's
 * index (`__tests__/conversation-delete.test.ts`), so even a long agent's
 * transcript is a few indexed deletes, which is what the cron's purge ran for
 * each conversation before.
 */

const deleteRows = SqlSchema.void({
  Request: Schema.Array(Schema.String),
  execute: (conversationIds) =>
    Database.use((db) =>
      db.delete(conversations).where(inArray(conversations.id, conversationIds)),
    ),
});

/**
 * Deletes the conversations now, and with them, by the schema's cascade,
 * every conversation delegated from them and every row beneath each. By id
 * alone, so the caller has gated the rows that named them: a task's delete
 * its agents', an agent's delete its own.
 */
export function deleteConversations(
  conversationIds: readonly string[],
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.void;
  return deleteRows(conversationIds);
}
