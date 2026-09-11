import type { ToolSet } from "ai";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  CONVERSATION_EVENT_KIND,
  type MessageRole,
  RATING_EVENT_PAYLOAD,
  type RatingEventPayload,
  readStoredUIMessages,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  type StoredUIMessage,
  unparsedWire,
  type WireBoundaryInput,
} from "../../core.js";
import { conversations, events, messages, turns } from "../../db/schema.js";
import { type HostedStoreDatabase, optionalField } from "./database.js";

/**
 * The per-resource reads a device polls with a cursor of its own — a
 * conversation's messages after a sequence, its events after a sequence, and
 * the account's turns after the instant one last changed — and the two
 * point reads a rating needs, a message's authorship and its latest rating. There is no feed;
 * every device keeps its own cursors, and the unique `(conversation_id, seq)`
 * pairs are what make every device converge on the same rows in the same
 * order. A conversation Clear soft-deleted is read by nothing here: each
 * read joins the conversation row and skips one stamped `deleted_at`, so a
 * cleared conversation is gone from every read from the call after the Clear.
 *
 * Messages are read back through `readStoredUIMessages`, never the SDK's
 * validator alone, because the SDK turns a terminal tool part naming a tool
 * the registry does not hold into a dynamic-tool part rather than refusing
 * it; a page holding a row this build cannot read is refused whole, naming
 * the row's sequence, rather than answered with the row silently reshaped.
 */

/** The most rows one read answers; a device with more to take asks again from the last sequence it took. */
const MAXIMUM_READ_PAGE = 200;

export interface SequenceCursor {
  /** Rows after this sequence; absent or zero for the conversation's beginning. */
  readonly after?: number;
  readonly limit?: number;
}

export interface StoredMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string;
  readonly clientId: string;
  readonly createdAt: Date;
  /** Absent while the message is still in flight and mutable. */
  readonly finishedAt?: Date;
  readonly message: StoredUIMessage;
}

/**
 * A refused page names the sequence of the first row this build could not
 * read and the path inside that row. The registry pre-check names the row
 * itself; the SDK's structural refusal names none, so the rows are then read
 * one at a time, in order, to find it, a cost paid only on the failure path.
 */
export type MessageListRead =
  | { readonly ok: true; readonly value: readonly StoredMessageRecord[] }
  | {
      readonly ok: false;
      readonly refusal: SchemaRefusal;
      readonly seq: number;
      readonly path: SchemaPath;
    };

type MessageRow = {
  readonly id: string;
  readonly seq: number;
  readonly turnId: string | null;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  /** The row's message as it was written, held to the vocabulary by the read and by nothing before it. */
  readonly stored: WireBoundaryInput;
};

type RefusedPage = Exclude<MessageListRead, { ok: true }>;

async function refusedRow(
  rows: readonly MessageRow[],
  read: Exclude<SchemaRead<unknown>, { ok: true }>,
  tools: ToolSet,
): Promise<RefusedPage> {
  const [index, ...path] = read.path;
  const named = rows.find((_, position) => position === index);
  if (named !== undefined) return { ok: false, refusal: read.refusal, seq: named.seq, path };
  for (const row of rows) {
    const single = await readStoredUIMessages(unparsedWire([row.stored]), tools);
    if (!single.ok) {
      const [, ...inner] = single.path;
      return { ok: false, refusal: single.refusal, seq: row.seq, path: inner };
    }
  }
  throw new Error("a page was refused whole and every row of it read alone");
}

function pageLimit(cursor: { readonly limit?: number }): number {
  return Math.min(Math.max(cursor.limit ?? MAXIMUM_READ_PAGE, 1), MAXIMUM_READ_PAGE);
}

/** The one statement of "a stamped conversation is read by nothing": the join every read makes to its conversation row. */
function standingConversation(table: { conversationId: AnyPgColumn }) {
  return and(eq(conversations.id, table.conversationId), isNull(conversations.deletedAt));
}

export async function listMessages(
  db: HostedStoreDatabase,
  userId: string,
  conversationId: string,
  tools: ToolSet,
  cursor: SequenceCursor = {},
): Promise<MessageListRead> {
  const selected = await db
    .select({
      id: messages.id,
      seq: messages.seq,
      turnId: messages.turnId,
      clientId: messages.clientId,
      role: messages.role,
      // The jsonb columns are selected as the unparsed boundary values they hold, since the read below is what holds them to the vocabulary; the driver hands jsonb back parsed either way.
      parts: sql<WireBoundaryInput>`${messages.parts}`,
      metadata: sql<WireBoundaryInput>`${messages.metadata}`,
      createdAt: messages.createdAt,
      finishedAt: messages.finishedAt,
    })
    .from(messages)
    .innerJoin(conversations, standingConversation(messages))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        gt(messages.seq, cursor.after ?? 0),
      ),
    )
    .orderBy(asc(messages.seq))
    .limit(pageLimit(cursor));
  const rows: MessageRow[] = selected.map(({ role, parts, metadata, ...row }) => ({
    ...row,
    stored: { id: row.id, role, parts, ...optionalField("metadata", metadata) },
  }));
  const read = await readStoredUIMessages(unparsedWire(rows.map((row) => row.stored)), tools);
  if (!read.ok) return refusedRow(rows, read, tools);
  return {
    ok: true,
    value: read.value.map((message, index) => {
      const row = rows[index];
      if (row === undefined) throw new Error("a read answered more messages than rows");
      return {
        id: row.id,
        conversationId,
        seq: row.seq,
        ...optionalField("turnId", row.turnId),
        clientId: row.clientId,
        createdAt: row.createdAt,
        ...optionalField("finishedAt", row.finishedAt),
        message,
      };
    }),
  };
}

export interface StoredEventRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly kind: (typeof events.$inferSelect)["kind"];
  readonly deviceId?: string;
  readonly payload?: unknown;
  readonly createdAt: Date;
}

export async function listEvents(
  db: HostedStoreDatabase,
  userId: string,
  conversationId: string,
  cursor: SequenceCursor = {},
): Promise<readonly StoredEventRecord[]> {
  const rows = await db
    .select({
      id: events.id,
      seq: events.seq,
      messageId: events.messageId,
      kind: events.kind,
      deviceId: events.deviceId,
      payload: events.payload,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(conversations, standingConversation(events))
    .where(
      and(
        eq(events.conversationId, conversationId),
        eq(events.userId, userId),
        gt(events.seq, cursor.after ?? 0),
      ),
    )
    .orderBy(asc(events.seq))
    .limit(pageLimit(cursor));
  return rows.map((row) => ({
    id: row.id,
    conversationId,
    seq: row.seq,
    messageId: row.messageId,
    kind: row.kind,
    ...optionalField("deviceId", row.deviceId),
    ...optionalField("payload", row.payload),
    createdAt: row.createdAt,
  }));
}

/**
 * Where a turn stands in the order of change: the latest instant any of its
 * stamps was set, as Postgres renders it to the microsecond, and its id to
 * break a tie. It is the instant's own text rather than a `Date` because a
 * JavaScript instant keeps milliseconds and a stamp set in the same
 * millisecond as the one a device already took would otherwise never read as
 * later; the text round-trips through `::timestamptz` exactly.
 */
interface TurnCursorPosition {
  readonly changedAt: string;
  readonly id: string;
}

export interface TurnCursor {
  /** Turns past this position, the last row a device took; absent for every turn the account holds. */
  readonly after?: TurnCursorPosition;
  readonly limit?: number;
}

export type StoredTurnRecord = typeof turns.$inferSelect & {
  /** The row's place in the order of change, handed back as the next read's `after`. */
  readonly cursor: TurnCursorPosition;
};

/** A turn row is mutable, so its order is the latest instant any of its stamps was set. */
const turnChangedAt = sql`greatest(${turns.queuedAt}, coalesce(${turns.startedAt}, ${turns.queuedAt}), coalesce(${turns.settledAt}, ${turns.queuedAt}), coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt}))`;

/** The rows past the position: changed later, or changed at the same instant with a greater id. */
function changedAfter(after: TurnCursorPosition) {
  const instant = sql`${after.changedAt}::timestamptz`;
  return or(gt(turnChangedAt, instant), and(eq(turnChangedAt, instant), gt(turns.id, after.id)));
}

/** The account's turns in the order they last changed, so a turn that settled since a device's last read is answered again with its new status; a page edge drops nothing, since the id breaks a tie. */
export async function listTurns(
  db: HostedStoreDatabase,
  userId: string,
  cursor: TurnCursor = {},
): Promise<readonly StoredTurnRecord[]> {
  const { after } = cursor;
  const rows = await db
    .select({ turn: turns, changedAt: sql<string>`(${turnChangedAt})::text` })
    .from(turns)
    .innerJoin(conversations, standingConversation(turns))
    .where(and(eq(turns.userId, userId), after === undefined ? undefined : changedAfter(after)))
    .orderBy(asc(turnChangedAt), asc(turns.id))
    .limit(pageLimit(cursor));
  return rows.map((row) => ({
    ...row.turn,
    cursor: { changedAt: row.changedAt, id: row.turn.id },
  }));
}

/**
 * Where one stored message stands, who wrote it, and whether it is a
 * compaction standing in for earlier rows, only where its conversation is
 * the caller's and still standing. Another account's message
 * and no message at all answer alike, so a caller learns nothing of rows it
 * does not own.
 */
export async function messageAuthorship(
  db: HostedStoreDatabase,
  userId: string,
  messageId: string,
): Promise<{ conversationId: string; role: MessageRole; compaction: boolean } | undefined> {
  const [row] = await db
    .select({
      conversationId: messages.conversationId,
      role: messages.role,
      compaction: sql<boolean>`${messages.metadata} ? 'compaction'`,
    })
    .from(messages)
    .innerJoin(conversations, standingConversation(messages))
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId)));
  return row;
}

/** One rating as the record holds it: the event's place, the verdict and note, and the device that gave it. */
export interface StoredRatingRecord extends RatingEventPayload {
  readonly id: string;
  readonly seq: number;
  readonly deviceId?: string;
  readonly ratedAt: Date;
}

/**
 * The newest rating on a message, or nothing. Every rating stands as its own
 * event, so the latest is the one with the highest sequence; a latest payload
 * the vocabulary cannot read answers nothing rather than an older verdict,
 * since the developer's last word is what a read is for.
 */
export async function latestMessageRating(
  db: HostedStoreDatabase,
  userId: string,
  messageId: string,
): Promise<StoredRatingRecord | undefined> {
  const [row] = await db
    .select({
      id: events.id,
      seq: events.seq,
      deviceId: events.deviceId,
      payload: sql<WireBoundaryInput>`${events.payload}`,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(conversations, standingConversation(events))
    .where(
      and(
        eq(events.messageId, messageId),
        eq(events.userId, userId),
        eq(events.kind, CONVERSATION_EVENT_KIND.RATING),
      ),
    )
    .orderBy(desc(events.seq))
    .limit(1);
  if (row === undefined) return undefined;
  const payload = RATING_EVENT_PAYLOAD.parse(unparsedWire(row.payload));
  if (payload === undefined) return undefined;
  return {
    ...payload,
    id: row.id,
    seq: row.seq,
    ...optionalField("deviceId", row.deviceId),
    ratedAt: row.createdAt,
  };
}
