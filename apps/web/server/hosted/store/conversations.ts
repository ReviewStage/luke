import { and, asc, eq, lte, sql } from "drizzle-orm";
import {
  type ConversationKind,
  type ConversationRecord,
  conversationKindOf,
  isConversationKind,
  type SessionKey,
} from "../../core.js";
import {
  compactionBoundary,
  conversation,
  conversationLine,
  conversationSession,
  transcriptEvent,
} from "../../db/schema.js";
import type { HostedStoreDatabase } from "./database.js";

/**
 * The conversation directory, one per user: every logical conversation the
 * account holds, with its kind and where it stands. A row outlives every
 * generation that runs under it — Start fresh replaces the session and keeps
 * the row and its lines — and is removed only by the hard delete below, which
 * takes everything under it with it and keeps no archive.
 */

export interface ConversationCreation {
  sessionKey: SessionKey;
  name: string;
  now: number;
  /** The kind the key says it is unless the caller names one. */
  kind?: ConversationKind;
}

type ConversationRow = {
  sessionKey: string;
  kind: string;
  name: string;
  createdAt: number;
  lastActivityAt: number;
  sessionId: string | null;
};

function recordFromRow(row: ConversationRow): ConversationRecord {
  const kind: ConversationKind = isConversationKind(row.kind)
    ? row.kind
    : conversationKindOf(row.sessionKey);
  return {
    // SAFETY: the column holds the key the constructor admitted when the row was written.
    sessionKey: row.sessionKey as SessionKey,
    kind,
    name: row.name,
    createdAt: row.createdAt,
    lastActivityAt: Math.max(row.lastActivityAt, row.createdAt),
    ...(row.sessionId !== null ? { sessionId: row.sessionId } : undefined),
  };
}

const CONVERSATION_COLUMNS = {
  sessionKey: conversation.sessionKey,
  kind: conversation.kind,
  name: conversation.name,
  createdAt: conversation.createdAt,
  lastActivityAt: conversation.lastActivityAt,
  sessionId: conversationSession.sessionId,
};

function conversationsQuery(db: HostedStoreDatabase) {
  return db
    .select(CONVERSATION_COLUMNS)
    .from(conversation)
    .leftJoin(
      conversationSession,
      and(
        eq(conversationSession.userId, conversation.userId),
        eq(conversationSession.sessionKey, conversation.sessionKey),
      ),
    );
}

export async function listConversations(
  db: HostedStoreDatabase,
  userId: string,
): Promise<readonly ConversationRecord[]> {
  const rows = await conversationsQuery(db)
    .where(eq(conversation.userId, userId))
    .orderBy(asc(conversation.createdAt), asc(conversation.sessionKey));
  return rows.map(recordFromRow);
}

async function conversationRecord(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<ConversationRecord | undefined> {
  const [row] = await conversationsQuery(db).where(
    and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)),
  );
  return row ? recordFromRow(row) : undefined;
}

/** Creates the conversation, or answers the one already standing at the key; idempotent. */
export async function createConversation(
  db: HostedStoreDatabase,
  userId: string,
  creation: ConversationCreation,
): Promise<ConversationRecord> {
  await db
    .insert(conversation)
    .values({
      userId,
      sessionKey: creation.sessionKey,
      kind: creation.kind ?? conversationKindOf(creation.sessionKey),
      name: creation.name,
      createdAt: creation.now,
      lastActivityAt: creation.now,
    })
    .onConflictDoNothing();
  const created = await conversationRecord(db, userId, creation.sessionKey);
  if (!created) throw new Error(`conversation ${creation.sessionKey} was not created`);
  return created;
}

/**
 * Takes the conversation's row lock for the rest of the transaction, so every
 * writer of the conversation — a checkpoint save, a Clear, a line append —
 * runs one at a time and the standing generation it reads afterwards is the
 * one it writes against. Postgres reads uncommitted-by-others nothing but
 * also locks nothing on a plain read, so without this two saves that both
 * observed one generation could both proceed. Answers whether the
 * conversation stands.
 */
export async function lockConversation(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<boolean> {
  const rows = await db
    .select({ sessionKey: conversation.sessionKey })
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)))
    .for("update");
  return rows.length > 0;
}

/** The conversation's durable Clear cutoff, which outlives the generation whose marker raised it. */
export async function conversationCutoff(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<number | undefined> {
  const [row] = await db
    .select({ clearedAt: conversation.clearedAt })
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)));
  return row?.clearedAt ?? undefined;
}

/** Raises the conversation's durable cutoff to `clearedAt`; never lowers it. */
async function raiseConversationCutoff(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  clearedAt: number,
): Promise<void> {
  await db
    .update(conversation)
    .set({
      clearedAt: sql`greatest(coalesce(${conversation.clearedAt}, ${clearedAt}), ${clearedAt})`,
    })
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)));
}

/** Moves the conversation's latest activity forward to `now`; never back. */
export async function touchConversation(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  now: number,
): Promise<void> {
  await db
    .update(conversation)
    .set({ lastActivityAt: sql`greatest(${conversation.lastActivityAt}, ${now})` })
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)));
}

/**
 * The Clear's erasure, and the one place the hosted store deletes a line: the
 * lines and transcript recorded at or before the instant, and the boundaries
 * folded by then, are removed outright, with no archive behind them, and the
 * cutoff is raised so a late line from before the instant is refused whatever
 * a client still holds. A line accepted after the instant is not the Clear's
 * to take. The generation is the caller's to replace, in the same transaction.
 */
export async function clearConversationRows(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  instant: number,
): Promise<void> {
  await db
    .delete(conversationLine)
    .where(
      and(
        eq(conversationLine.userId, userId),
        eq(conversationLine.sessionKey, sessionKey),
        lte(conversationLine.recordedAt, instant),
      ),
    );
  await db
    .delete(compactionBoundary)
    .where(
      and(
        eq(compactionBoundary.userId, userId),
        eq(compactionBoundary.sessionKey, sessionKey),
        lte(compactionBoundary.createdAt, instant),
      ),
    );
  await db
    .delete(transcriptEvent)
    .where(
      and(
        eq(transcriptEvent.userId, userId),
        eq(transcriptEvent.sessionKey, sessionKey),
        lte(transcriptEvent.recordedAt, instant),
      ),
    );
  await raiseConversationCutoff(db, userId, sessionKey, instant);
}

/**
 * Removes the conversation and everything under it: lines, transcript,
 * boundaries, and the standing generation with its rows, by cascade from the
 * conversation row, whose lock is taken first so a write racing the delete
 * lands before it and goes with it, or after and is refused.
 */
export function deleteConversation(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await lockConversation(tx, userId, sessionKey))) return false;
    const removed = await tx
      .delete(conversation)
      .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)))
      .returning({ sessionKey: conversation.sessionKey });
    return removed.length > 0;
  });
}
