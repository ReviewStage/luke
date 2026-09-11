import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import type { Fragment } from "@effect/sql/Statement";
import type { ToolSet } from "ai";
import { Effect, type ParseResult, Schema } from "effect";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_ROLE,
  type MessageRole,
  RATING_EVENT_PAYLOAD,
  type RatingEventPayload,
  readStoredUIMessages,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  type StoredUIMessage,
  type TurnOrigin,
  type TurnStatus,
  unparsedWire,
  type WireBoundaryInput,
} from "../../core.js";
import { EpochMillisColumnSchema, optionalField } from "./database.js";

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
 *
 * Every read below is an `Effect<A, SqlError | ParseError, SqlClient>` over
 * the ambient client, its statement the client's own tagged template and its
 * row a `Schema` decodes rather than trusts; the standing-conversation join
 * and the turn's changed-at expression are the two fragments every query
 * needing them embeds through `sql.literal`, since neither takes a bound
 * parameter. The one thing still a `Promise` here is `readStoredUIMessages`
 * itself, an unrelated vocabulary reader a selected page is handed to.
 */

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
export type MessageReadFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** The most rows one read answers; a device with more to take asks again from the last sequence it took. */
export const MAXIMUM_READ_PAGE = 200;

export interface SequenceCursor {
  /** Rows after this sequence; absent or zero for the conversation's beginning. */
  readonly after?: number;
  readonly limit?: number;
}

/**
 * A message read's cursor, with the window a read may cut it to: only rows
 * written at or after `since`. A conversation numbers its rows as it writes
 * them, so the rows past the window are a tail of the sequence and the
 * cursor still lands on the last row taken; the rows before it are never
 * read and never travel, while the conversation itself stands untouched.
 */
export interface MessageCursor extends SequenceCursor {
  readonly since?: Date;
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

/** The row every message read selects, snake_case as `messages` holds it. */
const SelectedMessageRowSchema = Schema.Struct({
  id: Schema.String,
  seq: EpochMillisColumnSchema,
  turnId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(Schema.fromKey("turn_id")),
  clientId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("client_id")),
  role: Schema.String,
  parts: Schema.Any,
  metadata: Schema.NullOr(Schema.Any),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  finishedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("finished_at"),
  ),
});

type SelectedMessage = typeof SelectedMessageRowSchema.Type;

/** The columns a message read selects, held to the vocabulary by nothing until `readSelected` below. */
const MESSAGE_COLUMNS =
  "messages.id, messages.seq, messages.turn_id, messages.client_id, messages.role, " +
  "messages.parts, messages.metadata, messages.created_at, messages.finished_at";

/** The join every read here makes to its conversation row: a Clear-stamped conversation is read by nothing. */
const standingJoin = (sql: SqlClient.SqlClient, conversationColumn: string) =>
  sql.literal(
    `inner join conversations on conversations.id = ${conversationColumn} and conversations.deleted_at is null`,
  );

/** Selected rows read back through the vocabulary, in the order given, or the page refused at its first unreadable row. */
async function readSelected(
  conversationId: string,
  selected: readonly SelectedMessage[],
  tools: ToolSet,
): Promise<MessageListRead> {
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

const selectMessages = (options: {
  readonly conversationId: string;
  readonly userId: string;
  readonly cursor: MessageCursor;
}) =>
  statement((sql) => {
    const conditions = [
      sql`messages.conversation_id = ${options.conversationId}`,
      sql`messages.user_id = ${options.userId}`,
      sql`messages.seq > ${options.cursor.after ?? 0}`,
    ];
    if (options.cursor.since !== undefined) {
      conditions.push(sql`messages.created_at >= ${options.cursor.since}`);
    }
    return sql`
      select ${sql.literal(MESSAGE_COLUMNS)}
      from messages
      ${standingJoin(sql, "messages.conversation_id")}
      where ${sql.and(conditions)}
      order by messages.seq asc
      limit ${pageLimit(options.cursor)}
    `;
  });

const findSelectedMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    cursor: Schema.Any,
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
    Effect.promise(() => readSelected(conversationId, selected, tools)),
  );
}

const selectRecentMessages = (options: {
  readonly conversationId: string;
  readonly userId: string;
  readonly limit: number;
}) =>
  statement(
    (sql) => sql`
      select ${sql.literal(MESSAGE_COLUMNS)}
      from messages
      ${standingJoin(sql, "messages.conversation_id")}
      where messages.conversation_id = ${options.conversationId}
        and messages.user_id = ${options.userId}
        and messages.finished_at is not null
        and messages.role in ${sql.in([MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT])}
      order by messages.seq desc
      limit ${options.limit}
    `,
  );

const findRecentMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: selectRecentMessages,
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
    (selected) =>
      Effect.promise(() => readSelected(conversationId, [...selected].reverse(), tools)),
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
    statement(
      (sql) => sql`
        select ${sql.literal(MESSAGE_COLUMNS)}
        from messages
        ${standingJoin(sql, "messages.conversation_id")}
        where messages.conversation_id = ${options.conversationId}
          and messages.user_id = ${options.userId}
          and messages.client_id = ${options.clientId}
      `,
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
    (selected) => Effect.promise(() => readSelected(conversationId, selected, tools)),
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
    statement(
      (sql) => sql`
        select ${sql.literal(MESSAGE_COLUMNS)}
        from messages
        ${standingJoin(sql, "messages.conversation_id")}
        where messages.conversation_id = ${options.conversationId}
          and messages.user_id = ${options.userId}
          and messages.id = ${options.messageId}
      `,
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
    Effect.promise(() => readSelected(conversationId, selected, tools)),
  );
}

const FoundMessageIdSchema = Schema.Struct({ id: Schema.String });

const findMessageIdByClientId = SqlSchema.findOne({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    clientId: Schema.String,
  }),
  Result: FoundMessageIdSchema,
  execute: (options) =>
    statement(
      (sql) => sql`
        select messages.id as id
        from messages
        ${standingJoin(sql, "messages.conversation_id")}
        where messages.conversation_id = ${options.conversationId}
          and messages.user_id = ${options.userId}
          and messages.client_id = ${options.clientId}
      `,
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
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  seq: EpochMillisColumnSchema,
  messageId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("message_id")),
  kind: Schema.String,
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
  payload: Schema.NullOr(Schema.Any),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
});

type EventRow = typeof EventRowSchema.Type;

function toStoredEvent(row: EventRow): StoredEventRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    messageId: row.messageId,
    // SAFETY: the column is plain text; trusted the way Drizzle's `$type<>()` was, and no more validated here.
    kind: row.kind as StoredEventRecord["kind"],
    ...optionalField("deviceId", row.deviceId),
    ...optionalField("payload", row.payload),
    createdAt: row.createdAt,
  };
}

const EVENT_COLUMNS =
  "events.id, events.conversation_id, events.seq, events.message_id, events.kind, " +
  "events.device_id, events.payload, events.created_at";

/**
 * The events about the given messages, wherever their conversations number
 * them, so a page of the view can mark each announcement by the latest speech
 * event on its message without reading every event the conversations hold.
 */
const findEventsForMessages = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, messageIds: Schema.Array(Schema.String) }),
  Result: EventRowSchema,
  execute: (options) =>
    statement(
      (sql) => sql`
        select ${sql.literal(EVENT_COLUMNS)}
        from events
        ${standingJoin(sql, "events.conversation_id")}
        where events.user_id = ${options.userId}
          and events.message_id in ${sql.in(options.messageIds)}
        order by events.conversation_id asc, events.seq asc
      `,
    ),
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
    statement(
      (sql) => sql`
        select ${sql.literal(EVENT_COLUMNS)}
        from events
        ${standingJoin(sql, "events.conversation_id")}
        where events.conversation_id = ${options.conversationId}
          and events.user_id = ${options.userId}
          and events.seq > ${options.after}
        order by events.seq asc
        limit ${options.limit}
      `,
    ),
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
const TURN_CHANGED_AT_SQL =
  "greatest(turns.queued_at, coalesce(turns.started_at, turns.queued_at), " +
  "coalesce(turns.settled_at, turns.queued_at), coalesce(turns.cancel_requested_at, turns.queued_at))";

const turnChangedAt = (sql: SqlClient.SqlClient) => sql.literal(TURN_CHANGED_AT_SQL);

const TURN_COLUMNS =
  "turns.id, turns.user_id, turns.conversation_id, turns.origin, turns.status, turns.model, " +
  "turns.reasoning_effort, turns.prompt_hash, turns.tool_set_hash, turns.response_ids, " +
  "turns.usage, turns.queued_at, turns.started_at, turns.settled_at, turns.failure, " +
  "turns.cancel_requested_at";

const TurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  origin: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("reasoning_effort"),
  ),
  promptHash: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("prompt_hash"),
  ),
  toolSetHash: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("tool_set_hash"),
  ),
  responseIds: Schema.propertySignature(Schema.NullOr(Schema.Array(Schema.String))).pipe(
    Schema.fromKey("response_ids"),
  ),
  usage: Schema.NullOr(Schema.Any),
  queuedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("queued_at")),
  startedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("started_at"),
  ),
  settledAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("settled_at"),
  ),
  failure: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("cancel_requested_at"),
  ),
  changedAt: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("changed_at")),
});

type TurnRow = typeof TurnRowSchema.Type;

export type StoredTurnRecord = Omit<TurnRow, "changedAt" | "origin" | "status"> & {
  readonly origin: TurnOrigin;
  readonly status: TurnStatus;
  /** The row's place in the order of change, handed back as the next read's `after`. */
  readonly cursor: TurnCursorPosition;
};

function toStoredTurn({ changedAt, ...turn }: TurnRow): StoredTurnRecord {
  return {
    ...turn,
    // SAFETY: the column is plain text; trusted the way Drizzle's `$type<>()` was, and no more validated here.
    origin: turn.origin as TurnOrigin,
    // SAFETY: the column is plain text; trusted the way Drizzle's `$type<>()` was, and no more validated here.
    status: turn.status as TurnStatus,
    cursor: { changedAt, id: turn.id },
  };
}

/** The rows past the position: changed later, or changed at the same instant with a greater id. */
const changedAfterFragment = (sql: SqlClient.SqlClient, after: TurnCursorPosition) => {
  const changedAt = turnChangedAt(sql);
  return sql.or([
    sql`${changedAt} > ${after.changedAt}::timestamptz`,
    sql.and([sql`${changedAt} = ${after.changedAt}::timestamptz`, sql`turns.id > ${after.id}`]),
  ]);
};

/** The account's turns in the order they last changed, so a turn that settled since a device's last read is answered again with its new status; a page edge drops nothing, since the id breaks a tie. */
export function listTurns(
  userId: string,
  cursor: TurnCursor = {},
): Effect.Effect<readonly StoredTurnRecord[], MessageReadFailure, SqlClient.SqlClient> {
  return statement((sql) => {
    const conditions: Fragment[] = [sql`turns.user_id = ${userId}`];
    if (cursor.after !== undefined) conditions.push(changedAfterFragment(sql, cursor.after));
    return sql`
      select ${sql.literal(TURN_COLUMNS)}, (${turnChangedAt(sql)})::text as changed_at
      from turns
      ${standingJoin(sql, "turns.conversation_id")}
      where ${sql.and(conditions)}
      order by ${turnChangedAt(sql)} asc, turns.id asc
      limit ${pageLimit(cursor)}
    `;
  }).pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknown(Schema.Array(TurnRowSchema))(rows).pipe(
        Effect.map((decoded) => decoded.map(toStoredTurn)),
      ),
    ),
  );
}

/** The turn rows a page of messages names, whichever standing conversations they ran over, so the view can place each group under its turn. */
export function turnsNamed(
  userId: string,
  turnIds: readonly string[],
): Effect.Effect<readonly StoredTurnRecord[], MessageReadFailure, SqlClient.SqlClient> {
  if (turnIds.length === 0) return Effect.succeed([]);
  return statement(
    (sql) => sql`
      select ${sql.literal(TURN_COLUMNS)}, (${turnChangedAt(sql)})::text as changed_at
      from turns
      ${standingJoin(sql, "turns.conversation_id")}
      where turns.user_id = ${userId}
        and turns.id in ${sql.in([...turnIds])}
      order by ${turnChangedAt(sql)} asc, turns.id asc
    `,
  ).pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknown(Schema.Array(TurnRowSchema))(rows).pipe(
        Effect.map((decoded) => decoded.map(toStoredTurn)),
      ),
    ),
  );
}

/** The rows at or before the position: changed earlier, or changed at the same instant with an id no greater. */
const changedAtOrBeforeFragment = (sql: SqlClient.SqlClient, position: TurnCursorPosition) => {
  const changedAt = turnChangedAt(sql);
  return sql.or([
    sql`${changedAt} < ${position.changedAt}::timestamptz`,
    sql.and([
      sql`${changedAt} = ${position.changedAt}::timestamptz`,
      sql`turns.id <= ${position.id}`,
    ]),
  ]);
};

const TurnPositionRowSchema = Schema.Struct({
  id: Schema.String,
  changedAt: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("changed_at")),
});

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
  return statement((sql) => {
    const conditions: Fragment[] = [sql`turns.user_id = ${userId}`];
    if (notAfter !== undefined) conditions.push(changedAtOrBeforeFragment(sql, notAfter));
    return sql`
      select turns.id as id, (${turnChangedAt(sql)})::text as changed_at
      from turns
      ${standingJoin(sql, "turns.conversation_id")}
      where ${sql.and(conditions)}
      order by ${turnChangedAt(sql)} desc, turns.id desc
      limit 1
    `;
  }).pipe(
    Effect.flatMap((rows) => Schema.decodeUnknown(Schema.Array(TurnPositionRowSchema))(rows)),
    Effect.map((rows) => rows[0]),
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
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  role: Schema.String,
  compaction: Schema.Boolean,
});

const findAuthorship = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, messageId: Schema.String }),
  Result: AuthorshipRowSchema,
  execute: (options) =>
    statement(
      (sql) => sql`
        select
          messages.conversation_id as conversation_id,
          messages.role as role,
          messages.metadata ? 'compaction' as compaction
        from messages
        ${standingJoin(sql, "messages.conversation_id")}
        where messages.id = ${options.messageId}
          and messages.user_id = ${options.userId}
      `,
    ),
});

export function messageAuthorship(
  userId: string,
  messageId: string,
): Effect.Effect<
  { conversationId: string; role: MessageRole; compaction: boolean } | undefined,
  MessageReadFailure,
  SqlClient.SqlClient
> {
  return Effect.map(findAuthorship({ userId, messageId }), (found) =>
    found._tag === "Some"
      ? {
          conversationId: found.value.conversationId,
          // SAFETY: the column is plain text; trusted the way Drizzle's `$type<>()` was, and no more validated here.
          role: found.value.role as MessageRole,
          compaction: found.value.compaction,
        }
      : undefined,
  );
}

/** One rating as the record holds it: the event's place, the verdict and note, and the device that gave it. */
export interface StoredRatingRecord extends RatingEventPayload {
  readonly id: string;
  readonly seq: number;
  readonly deviceId?: string;
  readonly ratedAt: Date;
}

const RatingRowSchema = Schema.Struct({
  id: Schema.String,
  seq: EpochMillisColumnSchema,
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
  payload: Schema.Any,
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
});

const findLatestRating = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, messageId: Schema.String }),
  Result: RatingRowSchema,
  execute: (options) =>
    statement(
      (sql) => sql`
        select events.id as id, events.seq as seq, events.device_id as device_id,
          events.payload as payload, events.created_at as created_at
        from events
        ${standingJoin(sql, "events.conversation_id")}
        where events.message_id = ${options.messageId}
          and events.user_id = ${options.userId}
          and events.kind = ${CONVERSATION_EVENT_KIND.RATING}
        order by events.seq desc
        limit 1
      `,
    ),
});

/**
 * The newest rating on a message, or nothing. Every rating stands as its own
 * event, so the latest is the one with the highest sequence; a latest payload
 * the vocabulary cannot read answers nothing rather than an older verdict,
 * since the developer's last word is what a read is for.
 */
export function latestMessageRating(
  userId: string,
  messageId: string,
): Effect.Effect<StoredRatingRecord | undefined, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.map(findLatestRating({ userId, messageId }), (found) => {
    if (found._tag === "None") return undefined;
    const row = found.value;
    const payload = RATING_EVENT_PAYLOAD.parse(unparsedWire(row.payload));
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
