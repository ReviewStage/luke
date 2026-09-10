import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import {
  type ConversationAppendOutcome,
  type ConversationEntry,
  conversationEntryIdentity,
  maximumStoredConversationEntries,
  recordedAfterClear,
  type SessionKey,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
  type UnparsedWireValue,
} from "../../core.js";
import { conversation, conversationLine } from "../../db/schema.js";
import { standingGeneration } from "./brain-envelope.js";
import { conversationCutoff, lockConversation } from "./conversations.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The conversation's lines as the panel draws them, kept apart from the
 * brain's generation: a line names the generation that stood when it was
 * written, for attribution alone, and answers to the thread's own retention
 * and to the Clear rather than to the generation's replacement.
 */

/**
 * The Clear cutoff before which no line may stand: the later of the standing
 * generation's marker and the conversation's own durable cutoff, which
 * outlives the generation.
 */
export async function conversationClearedAt(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<number | undefined> {
  const durable = await conversationCutoff(db, userId, sessionKey);
  const marker = (await standingGeneration(db, userId, sessionKey))?.resetClearedAt;
  if (durable === undefined) return marker;
  return marker === undefined ? durable : Math.max(durable, marker);
}

/**
 * Appends lines to the conversation, idempotently. A line the thread already
 * holds by identity is not written again — though it may now learn the run
 * it opened — and a run's ask or end already published is not published
 * twice however many clients report it. Each admitted line is stamped with
 * the generation standing at the write. Nothing is removed here: stored lines
 * answer to the Clear, and the bound is the projection's alone.
 */
export function appendConversationLines(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  entries: readonly ConversationEntry[],
  now: number,
): Promise<ConversationAppendOutcome<ConversationEntry>> {
  return db.transaction(async (tx) => {
    if (!(await lockConversation(tx, userId, sessionKey))) {
      throw new Error(`no conversation stands at ${sessionKey}`);
    }
    const standing = await standingGeneration(tx, userId, sessionKey);
    const clearedAt = await conversationClearedAt(tx, userId, sessionKey);
    let changed = false;
    for (const entry of entries) {
      if (!conversationEntryAdmitted(entry, now, clearedAt)) continue;
      if (await appendOne(tx, seal, userId, sessionKey, standing?.sessionId, entry)) changed = true;
    }
    return { changed, entries: await listRetained(tx, seal, userId, sessionKey, now, clearedAt) };
  });
}

async function appendOne(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): Promise<boolean> {
  const eventKey = conversationEventKey(entry);
  const [held] = await db
    .select({ sequence: conversationLine.sequence, requestId: conversationLine.requestId })
    .from(conversationLine)
    .where(
      and(
        eq(conversationLine.userId, userId),
        eq(conversationLine.sessionKey, sessionKey),
        eq(conversationLine.eventKey, eventKey),
      ),
    );
  // A run's line of this kind already standing elsewhere refuses the update
  // and the insert alike. Asked before either, under the conversation's row
  // lock, so the once-published index is the backstop rather than the path;
  // an insert it still refuses reads as already stored, never as a batch
  // rolled back.
  const alreadyPublished =
    entry.requestId !== undefined &&
    (await published(db, userId, sessionKey, entry.requestId, entry.kind));
  if (held) {
    if (held.requestId !== null || entry.requestId === undefined || alreadyPublished) return false;
    await db
      .update(conversationLine)
      .set({ requestId: entry.requestId, sealedPayload: seal.seal(conversationPayload(entry)) })
      .where(
        and(
          eq(conversationLine.userId, userId),
          eq(conversationLine.sessionKey, sessionKey),
          eq(conversationLine.sequence, held.sequence),
        ),
      );
    return true;
  }
  if (alreadyPublished) return false;
  const sequence = await nextLineSequence(db, userId, sessionKey);
  const inserted = await db
    .insert(conversationLine)
    .values({
      userId,
      sessionKey,
      sequence,
      sessionId: sessionId ?? null,
      eventKey,
      kind: entry.kind,
      recordedAt: entry.recordedAt,
      requestId: entry.requestId ?? null,
      providerId: entry.identity?.providerId ?? null,
      providerSessionId: entry.identity?.providerSessionId ?? null,
      sealedPayload: seal.seal(conversationPayload(entry)),
    })
    .onConflictDoNothing()
    .returning({ sequence: conversationLine.sequence });
  return inserted.length > 0;
}

/** The conversation's next sequence, taken from its counter so a number is never handed out twice. */
async function nextLineSequence(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<number> {
  const [row] = await db
    .update(conversation)
    .set({ nextLineSequence: sql`${conversation.nextLineSequence} + 1` })
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)))
    .returning({ next: conversation.nextLineSequence });
  if (!row) throw new Error(`no conversation stands at ${sessionKey}`);
  return row.next - 1;
}

async function published(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
  requestId: string,
  kind: string,
): Promise<boolean> {
  const [row] = await db
    .select({ sequence: conversationLine.sequence })
    .from(conversationLine)
    .where(
      and(
        eq(conversationLine.userId, userId),
        eq(conversationLine.sessionKey, sessionKey),
        eq(conversationLine.requestId, requestId),
        eq(conversationLine.kind, kind),
      ),
    );
  return row !== undefined;
}

/** The thread as the panel draws it: retained lines in the order they happened, oldest first. */
export async function listConversationLines(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  now: number,
): Promise<readonly ConversationEntry[]> {
  return listRetained(
    db,
    seal,
    userId,
    sessionKey,
    now,
    await conversationClearedAt(db, userId, sessionKey),
  );
}

async function listRetained(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  now: number,
  clearedAt: number | undefined,
): Promise<readonly ConversationEntry[]> {
  const rows = await db
    .select({ sealedPayload: conversationLine.sealedPayload })
    .from(conversationLine)
    .where(
      and(
        eq(conversationLine.userId, userId),
        eq(conversationLine.sessionKey, sessionKey),
        lte(conversationLine.recordedAt, now),
        gte(conversationLine.recordedAt, now - storedConversationMaximumAgeMs),
        gt(conversationLine.recordedAt, clearedAt ?? -1),
      ),
    )
    .orderBy(desc(conversationLine.recordedAt), desc(conversationLine.sequence))
    .limit(maximumStoredConversationEntries);
  const entries: ConversationEntry[] = [];
  for (const row of rows.reverse()) {
    const entry = conversationEntryFromSealed(seal, row.sealedPayload);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Whether a canonical line may stand now: recorded no later than now and after any Clear. */
function conversationEntryAdmitted(
  entry: ConversationEntry,
  now: number,
  clearedAt: number | undefined,
): entry is ConversationEntry & { recordedAt: number } {
  if (!recordedAfterClear(entry, clearedAt)) return false;
  return entry.recordedAt <= now;
}

const EXPLICIT_EVENT_KEY_PREFIX = "event:";
const VALUE_EVENT_KEY_PREFIX = "value:";

/**
 * What an append is idempotent on: the line's identity, prefixed by which
 * kind it is so an id can never collide with a value key, and hashed, because
 * a value-keyed line's identity is its words and the key column is indexed
 * in the clear.
 */
export function conversationEventKey(entry: ConversationEntry): string {
  const identity = conversationEntryIdentity(entry);
  const prefixed =
    entry.eventId !== undefined
      ? `${EXPLICIT_EVENT_KEY_PREFIX}${identity}`
      : `${VALUE_EVENT_KEY_PREFIX}${identity}`;
  return createHash("sha256").update(prefixed, "utf8").digest("hex");
}

/** The payload a line is kept as, exactly the entry, so the projection is the record read back. */
function conversationPayload(entry: ConversationEntry): string {
  return JSON.stringify(entry);
}

/** A payload read back, or nothing for one this build cannot open or vouch for. */
function conversationEntryFromSealed(
  seal: UserSeal,
  sealedPayload: string,
): ConversationEntry | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the stored-entry reader is the validation.
    return storedConversationEntry(JSON.parse(seal.open(sealedPayload)) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}
