import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  type SessionKey,
  type StoredTranscriptEvent,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
  transcriptEventFromPayload,
  transcriptPayload,
  type UnparsedWireValue,
} from "../../core.js";
import { compactionBoundary, conversation, transcriptEvent } from "../../db/schema.js";
import { touchConversation } from "./conversations.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The retained transcript: every input the context engine ingested, in
 * order, and every point the projection folded, per conversation. The rows
 * name the generation they were written under for attribution and never
 * cascade with it, so a Start fresh or a compaction erases nothing here; only
 * the Clear's hard delete removes them. Nothing here reads inside a
 * provider's item: a model's output is sealed as the opaque records it
 * arrived as.
 */

/** Appends events under the generation named, taking the next sequences from the conversation's counter. Runs in the caller's transaction. */
export async function appendTranscript(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  events: readonly TranscriptEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  let latest = 0;
  for (const event of events) {
    const sequence = await nextTranscriptSequence(db, userId, sessionKey);
    await db.insert(transcriptEvent).values({
      userId,
      sessionKey,
      sequence,
      sessionId: sessionId ?? null,
      kind: event.kind,
      recordedAt: event.recordedAt,
      sealedPayload: seal.seal(JSON.stringify(transcriptPayload(event))),
    });
    if (event.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
      await db.insert(compactionBoundary).values({
        userId,
        sessionKey,
        transcriptSequence: sequence,
        sessionId: sessionId ?? null,
        source: event.boundary.source,
        dropped: event.boundary.dropped,
        checkpointFormat: event.boundary.checkpointFormat ?? null,
        createdAt: event.recordedAt,
      });
    }
    latest = Math.max(latest, event.recordedAt);
  }
  await touchConversation(db, userId, sessionKey, latest);
  return events.length;
}

async function nextTranscriptSequence(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<number> {
  const [row] = await db
    .update(conversation)
    .set({ nextTranscriptSequence: sql`${conversation.nextTranscriptSequence} + 1` })
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, sessionKey)))
    .returning({ next: conversation.nextTranscriptSequence });
  if (!row) throw new Error(`no conversation stands at ${sessionKey}`);
  return row.next - 1;
}

export interface TranscriptListOptions {
  afterSequence?: number;
  limit?: number;
}

const DEFAULT_TRANSCRIPT_LIMIT = 10_000;

export async function listTranscript(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  options: TranscriptListOptions = {},
): Promise<readonly StoredTranscriptEvent[]> {
  const rows = await db
    .select({
      sequence: transcriptEvent.sequence,
      sessionId: transcriptEvent.sessionId,
      kind: transcriptEvent.kind,
      recordedAt: transcriptEvent.recordedAt,
      sealedPayload: transcriptEvent.sealedPayload,
    })
    .from(transcriptEvent)
    .where(
      and(
        eq(transcriptEvent.userId, userId),
        eq(transcriptEvent.sessionKey, sessionKey),
        gt(transcriptEvent.sequence, options.afterSequence ?? -1),
      ),
    )
    .orderBy(asc(transcriptEvent.sequence))
    .limit(options.limit ?? DEFAULT_TRANSCRIPT_LIMIT);
  const events: StoredTranscriptEvent[] = [];
  for (const row of rows) {
    const event = transcriptEventFromSealed(seal, row.kind, row.recordedAt, row.sealedPayload);
    if (!event) continue;
    events.push({
      sequence: row.sequence,
      ...(row.sessionId !== null ? { sessionId: row.sessionId } : undefined),
      event,
    });
  }
  return events;
}

/** A row read back as an event, or nothing for one this build cannot open or vouch for; a bad row drops the row, not the transcript. */
function transcriptEventFromSealed(
  seal: UserSeal,
  kind: string,
  recordedAt: number,
  sealedPayload: string,
): TranscriptEvent | undefined {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a wire value; the payload reader is the validation.
    parsed = JSON.parse(seal.open(sealedPayload)) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  return transcriptEventFromPayload(kind, recordedAt, parsed);
}

export interface StoredCompactionBoundary {
  transcriptSequence: number;
  sessionId?: string;
  source: string;
  dropped: number;
  checkpointFormat?: string;
  createdAt: number;
}

export async function listCompactionBoundaries(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<readonly StoredCompactionBoundary[]> {
  const rows = await db
    .select()
    .from(compactionBoundary)
    .where(
      and(eq(compactionBoundary.userId, userId), eq(compactionBoundary.sessionKey, sessionKey)),
    )
    .orderBy(asc(compactionBoundary.transcriptSequence));
  return rows.map((row) => ({
    transcriptSequence: row.transcriptSequence,
    ...(row.sessionId !== null ? { sessionId: row.sessionId } : undefined),
    source: row.source,
    dropped: row.dropped,
    ...(row.checkpointFormat !== null ? { checkpointFormat: row.checkpointFormat } : undefined),
    createdAt: row.createdAt,
  }));
}
