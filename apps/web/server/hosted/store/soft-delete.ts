import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { CONVERSATION_KIND, conversations, user } from "../../db/schema.js";
import type { HostedStoreDatabase } from "./database.js";

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

/** Stamps every not-yet-stamped child of the given rows, level by level, and answers every id stamped. */
async function stampDescendants(
  db: HostedStoreDatabase,
  parents: readonly string[],
  deletedAt: Date,
): Promise<string[]> {
  const stamped: string[] = [];
  let frontier = parents;
  while (frontier.length > 0) {
    const children = await db
      .update(conversations)
      .set({ deletedAt })
      .where(
        and(inArray(conversations.parentConversationId, frontier), isNull(conversations.deletedAt)),
      )
      .returning({ id: conversations.id });
    frontier = children.map((child) => child.id);
    stamped.push(...frontier);
  }
  return stamped;
}

export function clearMainConversation(
  db: HostedStoreDatabase,
  userId: string,
  now: Date,
): Promise<ClearOutcome> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const stamped = await tx
      .update(conversations)
      .set({ deletedAt: now })
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.kind, CONVERSATION_KIND.MAIN),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id });
    const mainIds = stamped.map((row) => row.id);
    const descendants = await stampDescendants(tx, mainIds, now);
    const [opened] = await tx
      .insert(conversations)
      .values({
        userId,
        kind: CONVERSATION_KIND.MAIN,
        createdAt: now,
        lastActivityAt: now,
      })
      .returning({ id: conversations.id });
    if (opened === undefined) throw new Error("the Clear opened no main conversation");
    return { cleared: [...mainIds, ...descendants], opened: opened.id };
  });
}

/**
 * Removes every conversation stamped at or before the retention window's
 * edge, across every account; the schema cascades the rows beneath each.
 * Answers how many conversations went, descendants counted where they were
 * stamped themselves and not where the cascade alone took them.
 */
export async function purgeClearedConversations(
  db: HostedStoreDatabase,
  now: Date,
): Promise<number> {
  const edge = new Date(now.getTime() - CLEARED_CONVERSATION_RETENTION_MS);
  const removed = await db
    .delete(conversations)
    .where(lte(conversations.deletedAt, edge))
    .returning({ id: conversations.id });
  return removed.length;
}
