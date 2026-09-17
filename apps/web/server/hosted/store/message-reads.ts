import { readEither } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_ROLE,
  RATING_EVENT_PAYLOAD,
  type RatingEventPayload,
  readStoredUIMessages,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  UNREGISTERED_TOOL_PART,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "../../core.js";
import { db } from "../../db/query.js";
import { conversations, events, messages, turns } from "../../db/storage-schema.js";
import { EpochMillisColumnSchema, InstantColumnSchema, optionalField } from "./database.js";

/**
 * The per-resource reads a device polls with a cursor of its own — a
 * conversation's messages after a sequence, its events after a sequence, and
 * the account's turns after the instant one last changed — and the two
 * point reads a rating needs, a message's authorship and its latest rating. There is no feed;
 * every device keeps its own cursors, and the unique `(conversation_id, seq)`
 * pairs are what make every device converge on the same rows in the same
 * order: a row the writer moves takes a fresh position past every cursor
 * and is answered again there, so a device holds each message once, where
 * its latest delivery placed it. A conversation Clear soft-deleted is read by nothing here: each
 * read joins the conversation row and skips one stamped `deleted_at`, so a
 * cleared conversation is gone from every read from the call after the Clear.
 *
 * Messages are read back through `readStoredUIMessages`, never the SDK's
 * validator alone, because the SDK turns a terminal tool part naming a tool
 * the registry does not hold into a dynamic-tool part rather than refusing
 * it. A tool part naming a tool the catalog has since retired is dropped
 * from its row and the row is answered without it, because one retired call
 * must not leave a conversation unreadable on every device for as long as
 * the row stands; a page holding a row this build cannot read otherwise is
 * refused whole, naming the row's sequence, rather than answered with the
 * row silently reshaped.
 *
 * Every read below is an `Effect<A, SqlError | SchemaError, SqlClient>` over
 * the ambient client, its statement a Drizzle builder over the tables
 * `db/storage-schema.ts` declares and its row a `Schema` decodes rather than
 * trusts. Two things follow from the builder. A projection names its own
 * fields, so a result schema is spelled in the same words the rest of the
 * module is; and the vocabulary a text column holds — a turn's origin and
 * status, an event's kind, a message's role — is read as the literals the
 * writer alone spells into it, so a row holding a word this build does not
 * know is refused rather than trusted. What the builder cannot spell is a
 * named `sql` fragment inside the one rendered statement: the instant a turn
 * last changed, its text form, the jsonb key test behind `compaction`, and
 * the revision-first ordering of a messages page.
 */

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
type MessageReadFailure = SqlError | Schema.SchemaError;

/** The vocabularies the text columns hold, as the writer spells them; a row outside one is refused. */
const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));
const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));
const ConversationEventKindSchema = Schema.Literals(Object.values(CONVERSATION_EVENT_KIND));
const MessageRoleSchema = Schema.Literals(Object.values(MESSAGE_ROLE));

/** The most rows one read answers; a device with more to take asks again from the last sequence it took. */
const MAXIMUM_READ_PAGE = 200;

const SequenceCursorSchema = Schema.Struct({
  // Rows after this sequence; absent or zero for the conversation's beginning.
  after: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
});

export type SequenceCursor = typeof SequenceCursorSchema.Type;

/**
 * A message read's cursor, with the window a read may cut it to: only rows
 * written at or after `since`. A conversation numbers its rows as it writes
 * them, so the rows past the window are a tail of the sequence and the
 * cursor still lands on the last row taken; the rows before it are never
 * read and never travel, while the conversation itself stands untouched.
 */
const MessageCursorSchema = Schema.Struct({
  ...SequenceCursorSchema.fields,
  since: Schema.optionalKey(Schema.Date),
  // Also the rows at or before `after` written in place under a journal
  // revision past this one: the running turn's journal as it streams, and
  // once more as it finishes. Those rows are answered first, in the order
  // they were written, so a page cut among them can name where it stopped.
  revisionAfter: Schema.optionalKey(Schema.Number),
});

export type MessageCursor = typeof MessageCursorSchema.Type;

export interface StoredMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string;
  readonly clientId: string;
  readonly createdAt: Date;
  /** Where the row stands in the Conversation: a spoken row at the instant its words began, any other where it was written. */
  readonly placedAt: Date;
  /** Absent while the message is still in flight and mutable. */
  readonly finishedAt?: Date;
  /** The conversation's journal revision at the row's last write in place; absent for a row never written in place. */
  readonly revision?: number;
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
      readonly conversationId: string;
      readonly seq: number;
      readonly path: SchemaPath;
    };

/**
 * Where a history read stands after a page: the oldest row it took, by the
 * instant it is placed at as the store renders it, and the row's conversation
 * and sequence to break a tie between two conversations' rows placed at one
 * instant. The next page reads the rows before it in the same order.
 */
const HistoryPositionSchema = Schema.Struct({
  placedAt: Schema.String,
  conversationId: Schema.String,
  seq: Schema.Number,
});

type HistoryPosition = typeof HistoryPositionSchema.Type;

/**
 * What a history read is over: each standing conversation, and for one under
 * the view's window, the instant its rows must have been written at or after.
 * The read is one select across them all, newest first, so a page holds the
 * newest rows of the view whichever conversation wrote them.
 */
const HistoryWindowSchema = Schema.Struct({
  conversationId: Schema.String,
  since: Schema.optionalKey(Schema.Date),
});

export type HistoryWindow = typeof HistoryWindowSchema.Type;

/** A history read's cursor: the rows before this position, or the newest rows where none is given. */
const HistoryCursorSchema = Schema.Struct({
  before: Schema.optionalKey(HistoryPositionSchema),
  limit: Schema.optionalKey(Schema.Number),
});

export type HistoryCursor = typeof HistoryCursorSchema.Type;

/**
 * A history page: its rows oldest first, as a forward page's are, the
 * position of the oldest so the next page reads on from it, and whether any
 * row stands before that; or the page refused at its first unreadable row.
 */
export type MessageHistoryRead =
  | {
      readonly ok: true;
      readonly value: readonly StoredMessageRecord[];
      readonly older: HistoryPosition | undefined;
      readonly hasOlder: boolean;
    }
  | Exclude<MessageListRead, { ok: true }>;

type MessageRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId: string | null;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly placedAt: Date;
  readonly finishedAt: Date | null;
  readonly revision: number | null;
  /** The row's message as it was written, held to the vocabulary by the read and by nothing before it. */
  readonly stored: WireBoundaryInput;
};

type RefusedPage = Exclude<MessageListRead, { ok: true }>;

function refusedRow(
  rows: readonly MessageRow[],
  read: Exclude<SchemaRead<unknown>, { ok: true }>,
  tools: ToolSet,
): Effect.Effect<RefusedPage> {
  const [index, ...path] = read.path;
  const named = rows.find((_, position) => position === index);
  if (named !== undefined) {
    return Effect.succeed({
      ok: false,
      refusal: read.refusal,
      conversationId: named.conversationId,
      seq: named.seq,
      path,
    });
  }
  // The reader named no row, so each is read alone until the unreadable one names itself.
  return Effect.gen(function* () {
    for (const row of rows) {
      const single = yield* readStoredUIMessages(
        unparsedWire([row.stored]),
        tools,
        UNREGISTERED_TOOL_PART.DROP,
      );
      if (!single.ok) {
        const [, ...inner] = single.path;
        return {
          ok: false,
          refusal: single.refusal,
          conversationId: row.conversationId,
          seq: row.seq,
          path: inner,
        };
      }
    }
    return yield* Effect.die(new Error("a page was refused whole and every row of it read alone"));
  });
}

function pageLimit(cursor: { readonly limit?: number }): number {
  return Math.min(Math.max(cursor.limit ?? MAXIMUM_READ_PAGE, 1), MAXIMUM_READ_PAGE);
}

/**
 * The join every read here makes to its conversation row, one per table
 * reached: the conversation the row belongs to, stamped by no Clear, so a
 * cleared conversation is read by nothing. It is spelled once per table
 * rather than once over a column handed in, because the column the join
 * holds to is what makes each one the join it is.
 */
const MESSAGE_CONVERSATION_STANDS = and(
  eq(conversations.id, messages.conversationId),
  isNull(conversations.deletedAt),
);

const EVENT_CONVERSATION_STANDS = and(
  eq(conversations.id, events.conversationId),
  isNull(conversations.deletedAt),
);

const TURN_CONVERSATION_STANDS = and(
  eq(conversations.id, turns.conversationId),
  isNull(conversations.deletedAt),
);

/** The columns a message read selects, held to the vocabulary by nothing until `readSelected` below. */
const MESSAGE_FIELDS = {
  id: messages.id,
  conversationId: messages.conversationId,
  seq: messages.seq,
  turnId: messages.turnId,
  clientId: messages.clientId,
  role: messages.role,
  parts: messages.parts,
  metadata: messages.metadata,
  createdAt: messages.createdAt,
  placedAt: messages.placedAt,
  finishedAt: messages.finishedAt,
  revision: messages.revision,
};

/** The row every message read selects, in the fields the projection above names. */
const SELECTED_MESSAGE_FIELDS = {
  id: Schema.String,
  conversationId: Schema.String,
  seq: EpochMillisColumnSchema,
  turnId: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  role: MessageRoleSchema,
  parts: WireValueSchema,
  metadata: Schema.NullOr(WireValueSchema),
  createdAt: InstantColumnSchema,
  placedAt: InstantColumnSchema,
  finishedAt: Schema.NullOr(InstantColumnSchema),
  revision: Schema.NullOr(EpochMillisColumnSchema),
} as const;

const SelectedMessageRowSchema = Schema.Struct(SELECTED_MESSAGE_FIELDS);

type SelectedMessage = typeof SelectedMessageRowSchema.Type;

// A history cursor's instant travels as text, for the reason a turn cursor's
// does (a millisecond number cannot tell two rows placed in one millisecond
// apart), rendered as the UTC wall clock with the zone spelled so the text is
// a property of the query rather than of the connection's TimeZone.
const PLACED_AT_TEXT = sql<string>`(${messages.placedAt} at time zone 'UTC')::text || '+00'`;

/** A history read's row: the message row with the instant it is placed at rendered as the cursor carries it. */
const SelectedHistoryRowSchema = Schema.Struct({
  ...SELECTED_MESSAGE_FIELDS,
  placedAtText: Schema.String,
});

type SelectedHistoryRow = typeof SelectedHistoryRowSchema.Type;

/** Selected rows read back through the vocabulary, in the order given, or the page refused at its first unreadable row. */
function readSelected(
  selected: readonly SelectedMessage[],
  tools: ToolSet,
): Effect.Effect<MessageListRead> {
  const rows: MessageRow[] = selected.map(({ role, parts, metadata, ...row }) => ({
    ...row,
    stored: { id: row.id, role, parts, ...optionalField("metadata", metadata) },
  }));
  const read = readStoredUIMessages(
    unparsedWire(rows.map((row) => row.stored)),
    tools,
    UNREGISTERED_TOOL_PART.DROP,
  );
  return Effect.flatMap(read, (read): Effect.Effect<MessageListRead> => {
    if (!read.ok) return refusedRow(rows, read, tools);
    return Effect.succeed({
      ok: true,
      value: read.value.map((message, index) => {
        const row = rows[index];
        if (row === undefined) throw new Error("a read answered more messages than rows");
        return {
          id: row.id,
          conversationId: row.conversationId,
          seq: row.seq,
          ...optionalField("turnId", row.turnId),
          clientId: row.clientId,
          createdAt: row.createdAt,
          placedAt: row.placedAt,
          ...optionalField("finishedAt", row.finishedAt),
          ...optionalField("revision", row.revision),
          message,
        };
      }),
    });
  });
}

/**
 * The rows written in place stand at or before `after` and come first, in
 * the order they were written; the rows past `after` follow in sequence.
 * Either run is a prefix a cut page can name the end of. There is no builder
 * spelling for ordering by a predicate or a `case`, so both keys are
 * fragments over the builder's own comparison.
 */
const revisionFirstOrder = (after: number): readonly SQL[] => {
  const past = gt(messages.seq, after);
  return [
    asc(sql`(${past})`),
    asc(sql`case when ${past} then ${messages.seq} else ${messages.revision} end`),
  ];
};

const selectMessages = (options: {
  readonly conversationId: string;
  readonly userId: string;
  readonly cursor: MessageCursor;
}) => {
  const after = options.cursor.after ?? 0;
  const { revisionAfter, since } = options.cursor;
  const conditions = [
    eq(messages.conversationId, options.conversationId),
    eq(messages.userId, options.userId),
    revisionAfter === undefined
      ? gt(messages.seq, after)
      : or(gt(messages.seq, after), gt(messages.revision, revisionAfter)),
  ];
  if (since !== undefined) conditions.push(gte(messages.createdAt, since));
  return db
    .select(MESSAGE_FIELDS)
    .from(messages)
    .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
    .where(and(...conditions))
    .orderBy(...(revisionAfter === undefined ? [asc(messages.seq)] : revisionFirstOrder(after)))
    .limit(pageLimit(options.cursor));
};

const findSelectedMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    cursor: MessageCursorSchema,
  }),
  Result: SelectedMessageRowSchema,
  execute: selectMessages,
});

export function listMessages(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  cursor: MessageCursor = {},
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(findSelectedMessages({ conversationId, userId, cursor }), (selected) =>
    readSelected(selected, tools),
  );
}

/** One window's rows: the conversation's, and where the view cuts it, only those written at or after the cut. */
const windowStands = (window: HistoryWindow) =>
  window.since === undefined
    ? eq(messages.conversationId, window.conversationId)
    : and(
        eq(messages.conversationId, window.conversationId),
        gte(messages.createdAt, window.since),
      );

/** The rows before the position in the history's order: placed earlier, or at the same instant under a lesser conversation, or under the same one at a lesser sequence. */
const placedBefore = (before: HistoryPosition) => {
  const sameInstant = sql`${messages.placedAt} = ${before.placedAt}::timestamptz`;
  return or(
    sql`${messages.placedAt} < ${before.placedAt}::timestamptz`,
    and(sameInstant, lt(messages.conversationId, before.conversationId)),
    and(
      sameInstant,
      eq(messages.conversationId, before.conversationId),
      lt(messages.seq, before.seq),
    ),
  );
};

const findSelectedMessagesBefore = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    windows: Schema.Array(HistoryWindowSchema),
    cursor: HistoryCursorSchema,
  }),
  Result: SelectedHistoryRowSchema,
  execute: (options: {
    readonly userId: string;
    readonly windows: readonly HistoryWindow[];
    readonly cursor: HistoryCursor;
  }) => {
    const conditions: Array<SQL | undefined> = [
      eq(messages.userId, options.userId),
      or(...options.windows.map(windowStands)),
    ];
    if (options.cursor.before !== undefined) conditions.push(placedBefore(options.cursor.before));
    // One row past the bound, so the page can say whether older rows stand
    // without a count of its own; it is taken off before the rows are read back.
    return db
      .select({ ...MESSAGE_FIELDS, placedAtText: PLACED_AT_TEXT })
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(and(...conditions))
      .orderBy(desc(messages.placedAt), desc(messages.conversationId), desc(messages.seq))
      .limit(pageLimit(options.cursor) + 1);
  },
});

/**
 * The view's rows before a position, newest first across every window given
 * and cut at the page bound, answered oldest first as a forward page is so
 * the same projection reads either: how a device draws a long Conversation
 * from its tail and reads back only as far as its reader looks. The order is
 * the instant a row is placed at, then its conversation, then its sequence,
 * a total order every device walks the same way, and the position handed
 * back is the oldest row taken, so the next page starts exactly where this
 * one stopped whatever was written in between. A row written since the tail
 * was read is the forward read's to answer, whatever instant it was placed
 * at. Nothing to read over answers an empty page with nothing older.
 */
export function listMessagesBefore(
  userId: string,
  windows: readonly HistoryWindow[],
  tools: ToolSet,
  cursor: HistoryCursor = {},
): Effect.Effect<MessageHistoryRead, MessageReadFailure, SqlClient.SqlClient> {
  if (windows.length === 0) {
    return Effect.succeed({ ok: true, value: [], older: undefined, hasOlder: false });
  }
  const limit = pageLimit(cursor);
  return Effect.flatMap(findSelectedMessagesBefore({ userId, windows, cursor }), (selected) =>
    Effect.gen(function* () {
      const hasOlder = selected.length > limit;
      const taken: readonly SelectedHistoryRow[] = selected.slice(0, limit);
      const oldest = taken.at(-1);
      const read = yield* readSelected(
        taken.map(({ placedAtText: _text, ...row }) => row).reverse(),
        tools,
      );
      if (!read.ok) return read;
      return {
        ok: true,
        value: read.value,
        older:
          oldest === undefined
            ? undefined
            : {
                placedAt: oldest.placedAtText,
                conversationId: oldest.conversationId,
                seq: oldest.seq,
              },
        hasOlder,
      };
    }),
  );
}

const findRecentMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    db
      .select(MESSAGE_FIELDS)
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(
          eq(messages.conversationId, options.conversationId),
          eq(messages.userId, options.userId),
          isNotNull(messages.finishedAt),
          inArray(messages.role, [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT]),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(options.limit),
});

/**
 * The newest finished messages of the two speaking roles, answered oldest
 * first: what a turn's standing context and a rotated session's seed read
 * back. A row still in flight says nothing finished yet, and a system row
 * says nothing a speaker said, so neither is answered.
 */
export function listRecentMessages(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  limit: number,
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(
    findRecentMessages({ conversationId, userId, limit: pageLimit({ limit }) }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findMessageByClientIdRow = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    clientId: Schema.String,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    db
      .select(MESSAGE_FIELDS)
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(
          eq(messages.conversationId, options.conversationId),
          eq(messages.userId, options.userId),
          eq(messages.clientId, options.clientId),
        ),
      ),
});

/**
 * The one message a writer's own client id names in a conversation, read back
 * under the registry like a page: a turn's journal is the row whose client id
 * is the turn's id. Answers an empty page where none stands.
 */
export function readMessageByClientId(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  clientId: string,
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(
    findMessageByClientIdRow({ conversationId, userId, clientId }),
    (selected) => readSelected(selected, tools),
  );
}

const findMessageByIdRow = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    messageId: Schema.String,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    db
      .select(MESSAGE_FIELDS)
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(
          eq(messages.conversationId, options.conversationId),
          eq(messages.userId, options.userId),
          eq(messages.id, options.messageId),
        ),
      ),
});

/**
 * The one message of a conversation its own id names, read back under the
 * registry like a page: the announcement a speech offer hangs on is the row
 * the offer's event names. Answers an empty page where none stands.
 */
export function readMessageById(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  messageId: string,
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(findMessageByIdRow({ conversationId, userId, messageId }), (selected) =>
    readSelected(selected, tools),
  );
}

const FoundMessageIdSchema = Schema.Struct({ id: Schema.String });

const findMessageIdByClientId = SqlSchema.findOneOption({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    clientId: Schema.String,
  }),
  Result: FoundMessageIdSchema,
  execute: (options) =>
    db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(
          eq(messages.conversationId, options.conversationId),
          eq(messages.userId, options.userId),
          eq(messages.clientId, options.clientId),
        ),
      ),
});

/** The row a writer's own client id names in a conversation, by its id alone; nothing where none stands. */
export function findMessageByClientId(
  userId: string,
  conversationId: string,
  clientId: string,
): Effect.Effect<{ readonly id: string } | undefined, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.map(findMessageIdByClientId({ conversationId, userId, clientId }), (found) =>
    found._tag === "Some" ? found.value : undefined,
  );
}

export interface StoredEventRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly kind: (typeof CONVERSATION_EVENT_KIND)[keyof typeof CONVERSATION_EVENT_KIND];
  readonly deviceId?: string;
  readonly payload?: unknown;
  readonly createdAt: Date;
}

const EventRowSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  seq: EpochMillisColumnSchema,
  messageId: Schema.String,
  kind: ConversationEventKindSchema,
  deviceId: Schema.NullOr(Schema.String),
  payload: Schema.NullOr(WireValueSchema),
  createdAt: InstantColumnSchema,
});

type EventRow = typeof EventRowSchema.Type;

function toStoredEvent(row: EventRow): StoredEventRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    kind: row.kind,
    messageId: row.messageId,
    ...optionalField("deviceId", row.deviceId),
    ...optionalField("payload", row.payload),
    createdAt: row.createdAt,
  };
}

/** The columns an event read selects, in the fields `EventRowSchema` names. */
const EVENT_FIELDS = {
  id: events.id,
  conversationId: events.conversationId,
  seq: events.seq,
  messageId: events.messageId,
  kind: events.kind,
  deviceId: events.deviceId,
  payload: events.payload,
  createdAt: events.createdAt,
};

/**
 * The events about the given messages, wherever their conversations number
 * them, so a page of the view can mark each announcement by the latest speech
 * event on its message without reading every event the conversations hold.
 */
const findEventsForMessages = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, messageIds: Schema.Array(Schema.String) }),
  Result: EventRowSchema,
  execute: (options) =>
    db
      .select(EVENT_FIELDS)
      .from(events)
      .innerJoin(conversations, EVENT_CONVERSATION_STANDS)
      .where(
        and(eq(events.userId, options.userId), inArray(events.messageId, [...options.messageIds])),
      )
      .orderBy(asc(events.conversationId), asc(events.seq)),
});

export function eventsForMessages(
  userId: string,
  messageIds: readonly string[],
): Effect.Effect<readonly StoredEventRecord[], MessageReadFailure, SqlClient.SqlClient> {
  if (messageIds.length === 0) return Effect.succeed([]);
  return Effect.map(findEventsForMessages({ userId, messageIds: [...messageIds] }), (rows) =>
    rows.map(toStoredEvent),
  );
}

const findEvents = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    after: Schema.Number,
    limit: Schema.Number,
  }),
  Result: EventRowSchema,
  execute: (options) =>
    db
      .select(EVENT_FIELDS)
      .from(events)
      .innerJoin(conversations, EVENT_CONVERSATION_STANDS)
      .where(
        and(
          eq(events.conversationId, options.conversationId),
          eq(events.userId, options.userId),
          gt(events.seq, options.after),
        ),
      )
      .orderBy(asc(events.seq))
      .limit(options.limit),
});

export function listEvents(
  userId: string,
  conversationId: string,
  cursor: SequenceCursor = {},
): Effect.Effect<readonly StoredEventRecord[], MessageReadFailure, SqlClient.SqlClient> {
  return Effect.map(
    findEvents({
      conversationId,
      userId,
      after: cursor.after ?? 0,
      limit: pageLimit(cursor),
    }),
    (rows) => rows.map(toStoredEvent),
  );
}

/**
 * Where a turn stands in the order of change: the latest instant any of its
 * stamps was set, as Postgres renders it to the microsecond, and its id to
 * break a tie. It is the instant's own text rather than a `Date` because a
 * JavaScript instant keeps milliseconds and a stamp set in the same
 * millisecond as the one a device already took would otherwise never read as
 * later; the text round-trips through `::timestamptz` exactly.
 */
export interface TurnCursorPosition {
  readonly changedAt: string;
  readonly id: string;
}

export interface TurnCursor {
  /** Turns past this position, the last row a device took; absent for every turn the account holds. */
  readonly after?: TurnCursorPosition | undefined;
  readonly limit?: number;
}

/** A turn row is mutable, so its order is the latest instant any of its stamps was set. */
const TURN_CHANGED_AT = sql`
  greatest(
    ${turns.queuedAt},
    coalesce(${turns.startedAt}, ${turns.queuedAt}),
    coalesce(${turns.settledAt}, ${turns.queuedAt}),
    coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
  )
`;

// The cursor's instant travels as text (a millisecond number cannot tell two
// stamps in one millisecond apart), and `timestamptz::text` renders in the
// session's TimeZone, so the same instant would read as two strings on two
// connections. Rendering the UTC wall clock and spelling the zone ourselves
// makes the text a property of the query rather than of the connection.
const TURN_CHANGED_AT_TEXT = sql<string>`((${TURN_CHANGED_AT}) at time zone 'UTC')::text || '+00'`;

/** The columns a turn read selects, in the fields `TurnRowSchema` names. */
const TURN_FIELDS = {
  id: turns.id,
  userId: turns.userId,
  conversationId: turns.conversationId,
  origin: turns.origin,
  status: turns.status,
  eveTurnId: turns.eveTurnId,
  model: turns.model,
  reasoningEffort: turns.reasoningEffort,
  promptHash: turns.promptHash,
  toolSetHash: turns.toolSetHash,
  responseIds: turns.responseIds,
  usage: turns.usage,
  queuedAt: turns.queuedAt,
  startedAt: turns.startedAt,
  settledAt: turns.settledAt,
  failure: turns.failure,
  cancelRequestedAt: turns.cancelRequestedAt,
  changedAt: TURN_CHANGED_AT_TEXT,
};

const TurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  origin: TurnOriginSchema,
  status: TurnStatusSchema,
  /** eve's own id for the turn, `turn_<n>` within its session, where the relay queued the row at eve's start; the opener's inbox row and a row from before the column names none. */
  eveTurnId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  promptHash: Schema.NullOr(Schema.String),
  toolSetHash: Schema.NullOr(Schema.String),
  responseIds: Schema.NullOr(Schema.Array(Schema.String)),
  usage: Schema.NullOr(WireValueSchema),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
  changedAt: Schema.String,
});

type TurnRow = typeof TurnRowSchema.Type;

export type StoredTurnRecord = Omit<TurnRow, "changedAt"> & {
  /** The row's place in the order of change, handed back as the next read's `after`. */
  readonly cursor: TurnCursorPosition;
};

function toStoredTurn({ changedAt, ...turn }: TurnRow): StoredTurnRecord {
  return { ...turn, cursor: { changedAt, id: turn.id } };
}

const TurnRowsSchema = Schema.Array(TurnRowSchema);

/** The rows past the position: changed later, or changed at the same instant with a greater id. */
const changedAfter = (after: TurnCursorPosition) =>
  or(
    sql`${TURN_CHANGED_AT} > ${after.changedAt}::timestamptz`,
    and(sql`${TURN_CHANGED_AT} = ${after.changedAt}::timestamptz`, gt(turns.id, after.id)),
  );

/** The rows at or before the position: changed earlier, or changed at the same instant with an id no greater. */
const changedAtOrBefore = (position: TurnCursorPosition) =>
  or(
    sql`${TURN_CHANGED_AT} < ${position.changedAt}::timestamptz`,
    and(
      sql`${TURN_CHANGED_AT} = ${position.changedAt}::timestamptz`,
      sql`${turns.id} <= ${position.id}`,
    ),
  );

/**
 * A turn the record answers: one that has started, whatever it came to. A
 * queued row is the opener's inbox and never the run's record — it says a
 * turn is owed, not that one ran — so a device is never shown a turn with
 * nothing in it that then goes; it meets the turn once the relay has moved
 * it to running.
 */
const STARTED_TURN = ne(turns.status, TURN_STATUS.QUEUED);

/** The account's turns in the order they last changed, so a turn that settled since a device's last read is answered again with its new status; a page edge drops nothing, since the id breaks a tie. */
export function listTurns(
  userId: string,
  cursor: TurnCursor = {},
): Effect.Effect<readonly StoredTurnRecord[], MessageReadFailure, SqlClient.SqlClient> {
  const conditions: Array<SQL | undefined> = [eq(turns.userId, userId), STARTED_TURN];
  if (cursor.after !== undefined) conditions.push(changedAfter(cursor.after));
  return Effect.flatMap(
    db
      .select(TURN_FIELDS)
      .from(turns)
      .innerJoin(conversations, TURN_CONVERSATION_STANDS)
      .where(and(...conditions))
      .orderBy(asc(TURN_CHANGED_AT), asc(turns.id))
      .limit(pageLimit(cursor)),
    (rows) =>
      Effect.map(Schema.decodeUnknownEffect(TurnRowsSchema)(rows), (decoded) =>
        decoded.map(toStoredTurn),
      ),
  );
}

/** The turn rows a page of messages names, whichever standing conversations they ran over, so the view can place each group under its turn. */
export function turnsNamed(
  userId: string,
  turnIds: readonly string[],
): Effect.Effect<readonly StoredTurnRecord[], MessageReadFailure, SqlClient.SqlClient> {
  if (turnIds.length === 0) return Effect.succeed([]);
  return Effect.flatMap(
    db
      .select(TURN_FIELDS)
      .from(turns)
      .innerJoin(conversations, TURN_CONVERSATION_STANDS)
      .where(and(eq(turns.userId, userId), inArray(turns.id, [...turnIds])))
      .orderBy(asc(TURN_CHANGED_AT), asc(turns.id)),
    (rows) =>
      Effect.map(Schema.decodeUnknownEffect(TurnRowsSchema)(rows), (decoded) =>
        decoded.map(toStoredTurn),
      ),
  );
}

const TurnPositionRowSchema = Schema.Struct({ id: Schema.String, changedAt: Schema.String });

/**
 * Where the account's turns stand: the cursor of the turn that changed last,
 * or, given a position, of the last turn at or before it — the place a
 * cursor naming a turn a Clear has since taken falls back to, which skips
 * nothing because every turn after the position would have been answered
 * from it. Nothing while no such turn stands.
 */
export function latestTurnPosition(
  userId: string,
  notAfter?: TurnCursorPosition,
): Effect.Effect<TurnCursorPosition | undefined, MessageReadFailure, SqlClient.SqlClient> {
  const conditions: Array<SQL | undefined> = [eq(turns.userId, userId), STARTED_TURN];
  if (notAfter !== undefined) conditions.push(changedAtOrBefore(notAfter));
  return Effect.flatMap(
    db
      .select({ id: turns.id, changedAt: TURN_CHANGED_AT_TEXT })
      .from(turns)
      .innerJoin(conversations, TURN_CONVERSATION_STANDS)
      .where(and(...conditions))
      .orderBy(desc(TURN_CHANGED_AT), desc(turns.id))
      .limit(1),
    (rows) =>
      Effect.map(
        Schema.decodeUnknownEffect(Schema.Array(TurnPositionRowSchema))(rows),
        (decoded) => decoded[0],
      ),
  );
}

/**
 * Where one stored message stands, who wrote it, and whether it is a
 * compaction standing in for earlier rows, only where its conversation is
 * the caller's and still standing. Another account's message
 * and no message at all answer alike, so a caller learns nothing of rows it
 * does not own.
 */
const AuthorshipRowSchema = Schema.Struct({
  conversationId: Schema.String,
  role: MessageRoleSchema,
  compaction: Schema.Boolean,
});

/** Whether the row's metadata holds the compaction key at all, which the builder has no operator for. */
const IS_COMPACTION = sql<boolean>`${messages.metadata} ? 'compaction'`;

const findAuthorship = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, messageId: Schema.String }),
  Result: AuthorshipRowSchema,
  execute: (options) =>
    db
      .select({
        conversationId: messages.conversationId,
        role: messages.role,
        compaction: IS_COMPACTION,
      })
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(and(eq(messages.id, options.messageId), eq(messages.userId, options.userId))),
});

export function messageAuthorship(
  userId: string,
  messageId: string,
): Effect.Effect<
  | { conversationId: string; role: (typeof messages.$inferSelect)["role"]; compaction: boolean }
  | undefined,
  MessageReadFailure,
  SqlClient.SqlClient
> {
  return Effect.map(findAuthorship({ userId, messageId }), (found) =>
    found._tag === "Some" ? found.value : undefined,
  );
}

/** One rating as the record holds it: the event's place, its word (a verdict, or the withdrawal of one) and note, and the device that gave it. */
export interface StoredRatingRecord extends RatingEventPayload {
  readonly id: string;
  readonly seq: number;
  readonly deviceId?: string;
  readonly ratedAt: Date;
}

const RatingRowSchema = Schema.Struct({
  id: Schema.String,
  seq: EpochMillisColumnSchema,
  deviceId: Schema.NullOr(Schema.String),
  payload: WireValueSchema,
  createdAt: InstantColumnSchema,
});

const findLatestRating = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, messageId: Schema.String }),
  Result: RatingRowSchema,
  execute: (options) =>
    db
      .select({
        id: events.id,
        seq: events.seq,
        deviceId: events.deviceId,
        payload: events.payload,
        createdAt: events.createdAt,
      })
      .from(events)
      .innerJoin(conversations, EVENT_CONVERSATION_STANDS)
      .where(
        and(
          eq(events.messageId, options.messageId),
          eq(events.userId, options.userId),
          eq(events.kind, CONVERSATION_EVENT_KIND.RATING),
        ),
      )
      .orderBy(desc(events.seq))
      .limit(1),
});

/**
 * The newest rating on a message, or nothing. Every rating stands as its own
 * event, a withdrawal among them, so the latest is the one with the highest
 * sequence; a latest payload the vocabulary cannot read answers nothing
 * rather than an older verdict, since the developer's last word is what a
 * read is for.
 */
export function latestMessageRating(
  userId: string,
  messageId: string,
): Effect.Effect<StoredRatingRecord | undefined, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.map(findLatestRating({ userId, messageId }), (found) => {
    if (found._tag === "None") return undefined;
    const row = found.value;
    const payload = Result.getOrUndefined(
      readEither(RATING_EVENT_PAYLOAD)(unparsedWire(row.payload)),
    );
    if (payload === undefined) return undefined;
    return {
      ...payload,
      id: row.id,
      seq: row.seq,
      ...optionalField("deviceId", row.deviceId),
      ratedAt: row.createdAt,
    };
  });
}
