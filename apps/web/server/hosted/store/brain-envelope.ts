import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  type BrainJournalEntry,
  type BrainObservationEntry,
  type BrainPersistedState,
  type BrainRequestRecord,
  type BrainStateSave,
  type BrainTranscriptCursors,
  brainPersistedStateFromWire,
  SAVE_KIND,
  type SessionKey,
  type WireRecord,
  type WireValue,
} from "../../core.js";
import {
  actionReceipt,
  conversationRun,
  conversationSession,
  observationCaptureCursor,
  observationCursor,
  observationInboxEntry,
  runtimeCheckpoint,
} from "../../db/schema.js";
import { clearConversationRows, touchConversation } from "./conversations.js";
import { type HostedStoreDatabase, nullable, optionalField, type UserSeal } from "./database.js";
import { appendTranscript } from "./transcript.js";

/**
 * The brain's envelope across the hosted tables: the standing generation
 * and, under it, the model's checkpoint items, the transcript cursors, the
 * inbox, the runs, and the action receipts. One generation stands per
 * conversation per user, and replacing it cascades every row it owned away.
 * The rows and the saves are the SQLite store's, keyed by user; what differs
 * is that every user-derived column passes through the payload envelope on
 * the way in and out.
 */

/** What a load answers: the standing generation's id, readable or not, and its envelope when it could be read. */
export interface EnvelopeRead {
  generation?: string;
  state?: BrainPersistedState;
  unreadable?: boolean;
}

export interface StandingGeneration {
  sessionId: string;
  checkpointFormat: string | undefined;
  createdAt: number;
  expiresAt: number;
  resetClearedAt: number | undefined;
  resetGenerationId: string | undefined;
  compactionCount: number;
}

export async function standingGeneration(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<StandingGeneration | undefined> {
  const [row] = await db
    .select()
    .from(conversationSession)
    .where(
      and(eq(conversationSession.userId, userId), eq(conversationSession.sessionKey, sessionKey)),
    );
  if (!row) return undefined;
  return {
    sessionId: row.sessionId,
    checkpointFormat: row.checkpointFormat ?? undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resetClearedAt: row.resetClearedAt ?? undefined,
    resetGenerationId: row.resetGenerationId ?? undefined,
    compactionCount: row.compactionCount,
  };
}

/**
 * The envelope as the tables hold it, opened and rebuilt into the envelope's
 * wire shape and admitted by the brain's own reader, so a row this build
 * cannot open or vouch for makes the whole generation unreadable. The
 * standing generation's id travels beside the answer either way: it is the
 * token a writer names to replace it, so an unreadable generation can be
 * repaired by the store that loaded it and by nothing that did not.
 */
export async function loadBrainEnvelope(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
): Promise<EnvelopeRead> {
  const session = await standingGeneration(db, userId, sessionKey);
  if (!session) return {};
  const generation = session.sessionId;
  const bySession = (table: { userId: PgColumn; sessionId: PgColumn }) =>
    and(eq(table.userId, userId), eq(table.sessionId, generation));
  const items = await db
    .select({ sealedItem: runtimeCheckpoint.sealedItem })
    .from(runtimeCheckpoint)
    .where(bySession(runtimeCheckpoint))
    .orderBy(asc(runtimeCheckpoint.sequence));
  const cursorRows = await db.select().from(observationCursor).where(bySession(observationCursor));
  const captureRows = await db
    .select()
    .from(observationCaptureCursor)
    .where(bySession(observationCaptureCursor));
  const inboxRows = await db
    .select({ sealedPayload: observationInboxEntry.sealedPayload })
    .from(observationInboxEntry)
    .where(bySession(observationInboxEntry))
    .orderBy(asc(observationInboxEntry.ordinal));
  const requestRows = await db
    .select()
    .from(conversationRun)
    .where(bySession(conversationRun))
    .orderBy(asc(conversationRun.ordinal));
  const journalRows = await db
    .select()
    .from(actionReceipt)
    .where(bySession(actionReceipt))
    .orderBy(asc(actionReceipt.ordinal));
  let parsedItems: WireValue[];
  let inbox: WireValue[];
  let requests: WireRecord[];
  let journal: WireRecord[];
  try {
    // SAFETY: JSON.parse returns a wire value; the envelope reader below is the validation.
    parsedItems = items.map((row) => JSON.parse(seal.open(row.sealedItem)) as WireValue);
    // SAFETY: as above, for the inbox entries.
    inbox = inboxRows.map((row) => JSON.parse(seal.open(row.sealedPayload)) as WireValue);
    requests = requestRows.map((row) => requestWire(seal, row));
    journal = journalRows.map((row) => journalWire(seal, row));
  } catch {
    return { unreadable: true, generation };
  }
  const wire = {
    version: 2,
    generationId: session.sessionId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ...(session.checkpointFormat !== undefined
      ? { checkpointFormat: session.checkpointFormat }
      : undefined),
    items: parsedItems,
    compactionCount: session.compactionCount,
    cursors: cursorsFromRows(cursorRows),
    captureCursors: cursorsFromRows(captureRows),
    inbox,
    requests,
    journal,
    ...(session.resetClearedAt !== undefined
      ? {
          reset: {
            clearedAt: session.resetClearedAt,
            ...(session.resetGenerationId !== undefined
              ? { generationId: session.resetGenerationId }
              : undefined),
          },
        }
      : undefined),
  } satisfies WireRecord;
  const state = brainPersistedStateFromWire(wire);
  return state ? { state, generation } : { unreadable: true, generation };
}

/**
 * Makes the envelope given the one that stands, if the save's generation is
 * the one standing: the compare-and-set every save runs. A replacement
 * replaces the generation it expected, its rows cascading away with it; an
 * amendment changes the generation it names. A writer naming some other
 * generation — or none, when one stands — is stale, and is refused without
 * anything of what it carried touching the tables. The transcript the save
 * carries lands in the same transaction, so a checkpoint and its record of
 * what entered the context are one write or none; and a replacement carrying
 * the Clear's marker runs the Clear's hard delete of the conversation's rows
 * at or before the marker's instant in that same transaction.
 */
export function saveBrainEnvelope(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  save: BrainStateSave,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const standing = await standingGeneration(tx, userId, sessionKey);
    if (save.kind === SAVE_KIND.REPLACE) {
      if (standing?.sessionId !== save.expectGeneration) return false;
      await replaceGeneration(tx, seal, userId, sessionKey, save.state);
      await appendTranscript(
        tx,
        seal,
        userId,
        sessionKey,
        save.state.generationId,
        save.transcript ?? [],
      );
      await touchConversation(tx, userId, sessionKey, save.state.createdAt);
      return true;
    }
    if (standing?.sessionId !== save.generationId) return false;
    const { delta } = save;
    const sessionId = save.generationId;
    const owned = and(
      eq(conversationSession.userId, userId),
      eq(conversationSession.sessionId, sessionId),
    );
    await appendTranscript(tx, seal, userId, sessionKey, sessionId, save.transcript ?? []);
    if (delta.checkpointFormat) {
      await tx
        .update(conversationSession)
        .set({ checkpointFormat: nullable(delta.checkpointFormat.stamp) })
        .where(owned);
    }
    if (delta.compactionCount !== undefined) {
      await tx
        .update(conversationSession)
        .set({ compactionCount: delta.compactionCount })
        .where(owned);
    }
    if (delta.items) {
      await tx
        .delete(runtimeCheckpoint)
        .where(
          and(
            eq(runtimeCheckpoint.userId, userId),
            eq(runtimeCheckpoint.sessionId, sessionId),
            gte(runtimeCheckpoint.sequence, delta.items.keepPrefix),
          ),
        );
      await insertItems(tx, seal, userId, sessionId, delta.items.append, delta.items.keepPrefix);
    }
    if (delta.cursors) {
      await tx
        .delete(observationCursor)
        .where(
          and(eq(observationCursor.userId, userId), eq(observationCursor.sessionId, sessionId)),
        );
      await insertCursors(tx, observationCursor, userId, sessionId, delta.cursors);
    }
    if (delta.captureCursors) {
      await tx
        .delete(observationCaptureCursor)
        .where(
          and(
            eq(observationCaptureCursor.userId, userId),
            eq(observationCaptureCursor.sessionId, sessionId),
          ),
        );
      await insertCursors(tx, observationCaptureCursor, userId, sessionId, delta.captureCursors);
    }
    if (delta.inbox) {
      await tx
        .delete(observationInboxEntry)
        .where(
          and(
            eq(observationInboxEntry.userId, userId),
            eq(observationInboxEntry.sessionId, sessionId),
          ),
        );
      await insertInbox(tx, seal, userId, sessionId, delta.inbox);
    }
    if (delta.requests) {
      if (delta.requests.remove.length > 0) {
        await tx
          .delete(conversationRun)
          .where(
            and(
              eq(conversationRun.userId, userId),
              inArray(conversationRun.runId, [...delta.requests.remove]),
            ),
          );
      }
      for (const { ordinal, record } of delta.requests.upsert) {
        await upsertRequest(tx, seal, userId, sessionId, ordinal, record);
      }
    }
    if (delta.journal) {
      for (const { runId, callId } of delta.journal.remove) {
        await tx
          .delete(actionReceipt)
          .where(
            and(
              eq(actionReceipt.userId, userId),
              eq(actionReceipt.runId, runId),
              eq(actionReceipt.callId, callId),
            ),
          );
      }
      for (const { ordinal, entry } of delta.journal.upsert) {
        await upsertJournal(tx, seal, userId, sessionId, ordinal, entry);
      }
    }
    return true;
  });
}

async function replaceGeneration(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  state: BrainPersistedState,
): Promise<void> {
  await db
    .delete(conversationSession)
    .where(
      and(eq(conversationSession.userId, userId), eq(conversationSession.sessionKey, sessionKey)),
    );
  await db.insert(conversationSession).values({
    userId,
    sessionId: state.generationId,
    sessionKey,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    resetClearedAt: nullable(state.reset?.clearedAt),
    resetGenerationId: nullable(state.reset?.generationId),
    checkpointFormat: nullable(state.checkpointFormat),
    compactionCount: state.compactionCount,
  });
  if (state.reset) await clearConversationRows(db, userId, sessionKey, state.reset.clearedAt);
  await insertItems(db, seal, userId, state.generationId, state.items, 0);
  await insertCursors(db, observationCursor, userId, state.generationId, state.cursors);
  await insertCursors(
    db,
    observationCaptureCursor,
    userId,
    state.generationId,
    state.captureCursors,
  );
  await insertInbox(db, seal, userId, state.generationId, state.inbox);
  for (const [ordinal, record] of state.requests.entries()) {
    await upsertRequest(db, seal, userId, state.generationId, ordinal, record);
  }
  for (const [ordinal, entry] of state.journal.entries()) {
    await upsertJournal(db, seal, userId, state.generationId, ordinal, entry);
  }
}

async function insertItems(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionId: string,
  items: readonly unknown[],
  from: number,
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(runtimeCheckpoint).values(
    items.map((item, offset) => ({
      userId,
      sessionId,
      sequence: from + offset,
      sealedItem: seal.seal(JSON.stringify(item)),
    })),
  );
}

async function insertCursors(
  db: HostedStoreDatabase,
  table: typeof observationCursor | typeof observationCaptureCursor,
  userId: string,
  sessionId: string,
  cursors: BrainTranscriptCursors,
): Promise<void> {
  const rows = Object.entries(cursors).flatMap(([providerId, sessions]) =>
    Object.entries(sessions).map(([providerSessionId, cursor]) => ({
      userId,
      sessionId,
      providerId,
      providerSessionId,
      cursor,
    })),
  );
  if (rows.length === 0) return;
  await db.insert(table).values(rows);
}

async function insertInbox(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionId: string,
  inbox: readonly BrainObservationEntry[],
): Promise<void> {
  if (inbox.length === 0) return;
  await db.insert(observationInboxEntry).values(
    inbox.map((entry, ordinal) => ({
      userId,
      sessionId,
      ordinal,
      entryId: entry.id,
      sealedPayload: seal.seal(JSON.stringify(entry)),
    })),
  );
}

function cursorsFromRows(
  rows: readonly { providerId: string; providerSessionId: string; cursor: string }[],
): BrainTranscriptCursors {
  const cursors: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    cursors[row.providerId] ??= {};
    const provider = cursors[row.providerId];
    if (provider) provider[row.providerSessionId] = row.cursor;
  }
  return cursors;
}

/**
 * The record's own columns, and only those: the about-fields beside them on
 * the run row are written by `recordRunAbout` and a record upsert leaves them
 * as they are.
 */
async function upsertRequest(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionId: string,
  ordinal: number,
  record: BrainRequestRecord,
): Promise<void> {
  const columns = {
    sessionId,
    ordinal,
    submissionId: record.submissionId,
    origin: record.origin,
    sealedQuestion: seal.seal(record.question),
    status: record.status,
    revision: record.revision,
    acceptedAt: record.acceptedAt,
    startedAt: nullable(record.startedAt),
    settledAt: nullable(record.settledAt),
    sealedText: record.text === undefined ? null : seal.seal(record.text),
    failure: nullable(record.failure),
    performedActions: record.performedActions,
    unknownActions: record.unknownActions,
    askRecordedAt: nullable(record.askRecordedAt),
    conversationRecordedAt: nullable(record.conversationRecordedAt),
  };
  await db
    .insert(conversationRun)
    .values({ userId, runId: record.runId, ...columns })
    .onConflictDoUpdate({ target: [conversationRun.userId, conversationRun.runId], set: columns });
}

async function upsertJournal(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionId: string,
  ordinal: number,
  entry: BrainJournalEntry,
): Promise<void> {
  const columns = {
    sessionId,
    ordinal,
    name: entry.name,
    sealedArguments: seal.seal(entry.argumentsJson),
    startedAt: entry.startedAt,
    sealedOutput: entry.outputJson === undefined ? null : seal.seal(entry.outputJson),
    settledAt: nullable(entry.settledAt),
  };
  await db
    .insert(actionReceipt)
    .values({ userId, runId: entry.runId, callId: entry.callId, ...columns })
    .onConflictDoUpdate({
      target: [actionReceipt.userId, actionReceipt.runId, actionReceipt.callId],
      set: columns,
    });
}

function requestWire(seal: UserSeal, row: typeof conversationRun.$inferSelect): WireRecord {
  return {
    runId: row.runId,
    submissionId: row.submissionId,
    origin: row.origin,
    question: seal.open(row.sealedQuestion),
    status: row.status,
    revision: row.revision,
    acceptedAt: row.acceptedAt,
    performedActions: row.performedActions,
    unknownActions: row.unknownActions,
    ...optionalField("startedAt", row.startedAt),
    ...optionalField("settledAt", row.settledAt),
    ...optionalField("text", row.sealedText === null ? null : seal.open(row.sealedText)),
    ...optionalField("failure", row.failure),
    ...optionalField("askRecordedAt", row.askRecordedAt),
    ...optionalField("conversationRecordedAt", row.conversationRecordedAt),
  };
}

function journalWire(seal: UserSeal, row: typeof actionReceipt.$inferSelect): WireRecord {
  return {
    runId: row.runId,
    callId: row.callId,
    name: row.name,
    argumentsJson: seal.open(row.sealedArguments),
    startedAt: row.startedAt,
    ...optionalField("outputJson", row.sealedOutput === null ? null : seal.open(row.sealedOutput)),
    ...optionalField("settledAt", row.settledAt),
  };
}
