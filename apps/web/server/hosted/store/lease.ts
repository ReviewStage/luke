import { and, eq, lte, sql } from "drizzle-orm";
import type { SessionKey } from "../../core.js";
import { conversationLease } from "../../db/schema.js";
import type { HostedStoreDatabase } from "./database.js";

/**
 * Who runs a conversation right now. A turn is run by whichever function
 * holds the conversation's lease: acquired in one statement that either
 * inserts the row or takes over one whose heartbeat stopped, moved along by
 * the holder while it works, and released when it is done. A holder that
 * dies leaves the row to expire, and the next request or tick that finds it
 * expired with a run unfinished takes it over and resumes the run from its
 * journal. Every transition names the owner, so a holder that lost the lease
 * learns so at its next heartbeat and a late release cannot take a successor's.
 */
export interface LeaseRecord {
  readonly ownerId: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
  readonly expiresAt: number;
}

/** Takes the lease if none stands or the standing one has expired; answers whether this owner now holds it. */
export async function acquireLease(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  ownerId: string,
  now: number,
  ttlMs: number,
): Promise<boolean> {
  const taken = await db
    .insert(conversationLease)
    .values({
      userId,
      sessionKey,
      ownerId,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    })
    .onConflictDoUpdate({
      target: [conversationLease.userId, conversationLease.sessionKey],
      set: { ownerId, acquiredAt: now, heartbeatAt: now, expiresAt: now + ttlMs },
      setWhere: lte(conversationLease.expiresAt, now),
    })
    .returning({ ownerId: conversationLease.ownerId });
  return taken.some((row) => row.ownerId === ownerId);
}

/** Moves the holder's lease along; answers false for a holder that no longer holds it. */
export async function heartbeatLease(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  ownerId: string,
  now: number,
  ttlMs: number,
): Promise<boolean> {
  const moved = await db
    .update(conversationLease)
    .set({
      heartbeatAt: now,
      expiresAt: sql`greatest(${conversationLease.expiresAt}, ${now + ttlMs})`,
    })
    .where(
      and(
        eq(conversationLease.userId, userId),
        eq(conversationLease.sessionKey, sessionKey),
        eq(conversationLease.ownerId, ownerId),
      ),
    )
    .returning({ ownerId: conversationLease.ownerId });
  return moved.length > 0;
}

/** Lets the lease go, only while this owner still holds it. */
export async function releaseLease(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  ownerId: string,
): Promise<boolean> {
  const released = await db
    .delete(conversationLease)
    .where(
      and(
        eq(conversationLease.userId, userId),
        eq(conversationLease.sessionKey, sessionKey),
        eq(conversationLease.ownerId, ownerId),
      ),
    )
    .returning({ ownerId: conversationLease.ownerId });
  return released.length > 0;
}

export async function readLease(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<LeaseRecord | undefined> {
  const [row] = await db
    .select()
    .from(conversationLease)
    .where(and(eq(conversationLease.userId, userId), eq(conversationLease.sessionKey, sessionKey)));
  if (!row) return undefined;
  return {
    ownerId: row.ownerId,
    acquiredAt: row.acquiredAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
  };
}
