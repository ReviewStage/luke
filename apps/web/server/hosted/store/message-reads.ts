import type { ToolSet } from "ai";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  MESSAGE_ROLE,
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
import { conversations, messages, turns } from "../../db/storage-schema.js";
import { EpochMillisColumnSchema, InstantColumnSchema, optionalField } from "./database.js";

/**
 * The conversation reads the brain and the voice make: a turn's journal by
 * its client id, a row by its id, the rows a standing context recalls, and
 * the turn rows an id names. A soft-deleted conversation is read by nothing
 * here: each read joins the conversation row and skips one stamped
 * `deleted_at`, so it is gone from every read from the call after the stamp.
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
 * last changed and its text form.
 */

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
type MessageReadFailure = SqlError | Schema.SchemaError;

/** The vocabularies the text columns hold, as the writer spells them; a row outside one is refused. */
const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));
const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));
const MessageRoleSchema = Schema.Literals(Object.values(MESSAGE_ROLE));

/** The most rows one read answers. */
const MAXIMUM_READ_PAGE = 200;

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

const findMessagesByIdRows = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    messageIds: Schema.Array(Schema.String),
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    db
      .select(MESSAGE_FIELDS)
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(eq(messages.userId, options.userId), inArray(messages.id, [...options.messageIds])),
      )
      .orderBy(asc(messages.createdAt), asc(messages.conversationId), asc(messages.seq)),
});

/**
 * The account's messages the given ids name, across their standing
 * conversations, read back under the registry like a page: the announcing
 * rows a standing context recalls briefings from, in one statement rather
 * than one per row. Nothing for no ids; an id naming no standing row of the
 * account's is absent from the answer rather than refused.
 */
export function readMessagesByIds(
  userId: string,
  tools: ToolSet,
  messageIds: readonly string[],
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  if (messageIds.length === 0) return Effect.succeed({ ok: true, value: [] });
  return Effect.flatMap(findMessagesByIdRows({ userId, messageIds }), (selected) =>
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

/** The turn rows the ids name, whichever standing conversations they ran over, in the order they last changed. */
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
