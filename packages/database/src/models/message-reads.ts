import { toolPartType } from "@sidecar/brain";
import {
  readStoredUIMessages,
  type StoredUIMessage,
  UNREGISTERED_TOOL_PART,
} from "@sidecar/session/ui-messages";
import {
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "@sidecar/wire";
import type { ToolSet } from "ai";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../core/query.js";
import { conversations, messages, type StoredTurnUsage, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import {
  EpochMillisColumnSchema,
  InstantColumnSchema,
  optionalField,
  TurnUsageColumnSchema,
} from "./columns.js";

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
 * `schemas/storage.ts` declares and its row a `Schema` decodes rather than
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

/** Where a transcript reader stands: the highest message sequence it has, and the journal revision it read at. */
export interface MessageCursor {
  readonly seq: number;
  readonly revision: number;
}

/** A page of messages past a cursor, and the cursor to read on from. */
export interface MessagePagePast {
  readonly read: MessageListRead;
  readonly cursor: MessageCursor;
}

const findMessagesPast = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    seq: Schema.Number,
    revision: Schema.Number,
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
          or(gt(messages.seq, options.seq), gt(messages.revision, options.revision)),
        ),
      )
      .orderBy(asc(messages.seq))
      .limit(options.limit),
});

const findJournalRevision = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ journalRevision: EpochMillisColumnSchema }),
  execute: (options) =>
    db
      .select({ journalRevision: conversations.journalRevision })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, options.conversationId),
          eq(conversations.userId, options.userId),
          isNull(conversations.deletedAt),
        ),
      ),
});

/**
 * The messages a reader has not seen as they now stand: every row past the
 * cursor's sequence, and every row amended in place past its revision, in
 * sequence order, read back through the vocabulary. The cursor answered
 * is the highest sequence on the page or the one asked, and the
 * conversation's journal revision as it stands now, read before the page
 * so an amendment that lands between the two is heard again rather than
 * missed. A conversation that no longer stands answers no rows and the
 * cursor asked. A page holds at most `limit` rows, no more than any read
 * here answers, and fewer only once nothing more stands past the cursor.
 */
export function listMessagesPast(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  cursor: MessageCursor,
  limit?: number,
): Effect.Effect<MessagePagePast, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const standing = yield* findJournalRevision({ conversationId, userId });
    if (Option.isNone(standing)) return { read: { ok: true, value: [] }, cursor };
    const selected = yield* findMessagesPast({
      conversationId,
      userId,
      seq: cursor.seq,
      revision: cursor.revision,
      limit: pageLimit({ ...(limit === undefined ? undefined : { limit }) }),
    });
    const read = yield* readSelected(selected, tools);
    const seq = selected.reduce((highest, row) => Math.max(highest, row.seq), cursor.seq);
    return { read, cursor: { seq, revision: standing.value.journalRevision } };
  });
}

const findNewestJournals = SqlSchema.findAll({
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
          eq(messages.role, MESSAGE_ROLE.ASSISTANT),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(options.limit),
});

/**
 * The newest turn journals of a conversation, answered oldest first: each
 * turn's assistant message, a journal still being written included, which is
 * how a subagent's session is read while it runs. Answers an empty page for
 * a conversation that has none or does not stand.
 */
export function listJournals(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  limit: number,
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(
    findNewestJournals({ conversationId, userId, limit: pageLimit({ limit }) }),
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

/** The newest turn of a conversation, as a coding agent's status is read from it. */
export interface LatestTurn {
  readonly conversationId: string;
  readonly id: string;
  readonly status: string;
  /** eve's own id for the turn, which a Stop names to eve; null for a row eve has not started. */
  readonly eveTurnId: string | null;
  /** The word for how a failed turn failed, and the detail behind it; null on a turn that did not. */
  readonly failure: string | null;
  readonly failureDetail: string | null;
  readonly cancelRequestedAt: Date | null;
  /** When the turn was queued, and when eve started it; null until it has. */
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  /** When the turn answered or ended; null while it runs. */
  readonly settledAt: Date | null;
  /** What the turn ran under and what it cost, as the row holds them; null where the row names no model, and until the turn settles. */
  readonly model: string | null;
  readonly usage: StoredTurnUsage | null;
}

const LatestTurnRowSchema = Schema.Struct({
  conversationId: Schema.String,
  id: Schema.String,
  status: Schema.String,
  eveTurnId: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  failureDetail: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  model: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(TurnUsageColumnSchema),
});

/** The newest turn of each conversation named, by the order the turns were queued; a conversation with none answers no row. */
const findLatestTurns = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, conversationIds: Schema.Array(Schema.String) }),
  Result: LatestTurnRowSchema,
  execute: ({ userId, conversationIds }) =>
    db
      .selectDistinctOn([turns.conversationId], {
        conversationId: turns.conversationId,
        id: turns.id,
        status: turns.status,
        eveTurnId: turns.eveTurnId,
        failure: turns.failure,
        failureDetail: turns.failureDetail,
        cancelRequestedAt: turns.cancelRequestedAt,
        queuedAt: turns.queuedAt,
        startedAt: turns.startedAt,
        settledAt: turns.settledAt,
        model: turns.model,
        usage: turns.usage,
      })
      .from(turns)
      .where(and(eq(turns.userId, userId), inArray(turns.conversationId, [...conversationIds])))
      .orderBy(turns.conversationId, desc(turns.queuedAt), desc(turns.id)),
});

/** What one settled turn ran under and cost, as a conversation's total is summed from it. */
export type TurnUsageRow = Pick<LatestTurn, "model"> & { readonly usage: StoredTurnUsage };

const TurnUsageRowSchema = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  usage: TurnUsageColumnSchema,
});

/**
 * Every turn with a recorded usage of the conversation named and of each
 * conversation delegated from it, which is where a coding agent's workers
 * run, so the agent's total is its own turns' and its workers'.
 */
const findTurnUsages = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: TurnUsageRowSchema,
  execute: ({ userId, conversationId }) =>
    db
      .select({ model: turns.model, usage: turns.usage })
      .from(turns)
      .where(
        and(
          eq(turns.userId, userId),
          isNotNull(turns.usage),
          or(
            eq(turns.conversationId, conversationId),
            inArray(
              turns.conversationId,
              db
                .select({ id: conversations.id })
                .from(conversations)
                .where(eq(conversations.parentConversationId, conversationId)),
            ),
          ),
        ),
      ),
});

/** The usage of every settled turn of the account's conversation and of the conversations delegated from it. */
export function turnUsagesOf(
  userId: string,
  conversationId: string,
): Effect.Effect<readonly TurnUsageRow[], MessageReadFailure, SqlClient.SqlClient> {
  return findTurnUsages({ userId, conversationId });
}

/** The newest turn of each of the account's conversations named, keyed by conversation; a conversation with no turn yet is absent. */
export function latestTurnsOf(
  userId: string,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, MessageReadFailure, SqlClient.SqlClient> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLatestTurns({ userId, conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row])),
  );
}

const AwaitingLinesRowSchema = Schema.Struct({
  conversationId: Schema.String,
  lines: Schema.Number,
});

/**
 * What eve puts between two messages it hands a turn as one: steers that
 * arrive while a step is under way are coalesced into the next step's input,
 * their words joined by a blank line (eve's `appendUserContent`), and the
 * turn receives the joined words as a single message.
 */
export const COALESCED_LINE_SEPARATOR = "\n\n";

/** A developer's line and the turn-owned row later in its conversation that may carry its words: one table under the two names the read takes it by. */
const receipt = alias(messages, "receipt");

/** The words of a row's one text part, as both the line and the receipt hold them, fenced by eve's separator so a whole coalesced segment is matched and never a fragment of one. */
const fencedWords = (parts: AnyPgColumn) =>
  sql`${COALESCED_LINE_SEPARATOR} || (${parts} -> 0 ->> 'text') || ${COALESCED_LINE_SEPARATOR}`;

/**
 * Whether a turnless user row of `messages` still awaits its turn: no later
 * user row of a turn in its conversation carries its words, whole or as one
 * of the segments eve coalesced. Such a row is eve's own receipt of the
 * line, written by the relay where the line was not taken into the turn, so
 * the line awaits nothing: it must not read the agent as running forever,
 * and no later turn may take it in the place of the line it did receive.
 */
export function noReceiptOfLine() {
  return notExists(
    db
      .select({ id: receipt.id })
      .from(receipt)
      .where(
        and(
          eq(receipt.conversationId, messages.conversationId),
          eq(receipt.role, MESSAGE_ROLE.USER),
          isNotNull(receipt.turnId),
          gt(receipt.seq, messages.seq),
          sql`strpos(${fencedWords(receipt.parts)}, ${fencedWords(messages.parts)}) > 0`,
        ),
      ),
  );
}

/**
 * How many of the developer's lines stand in each coding-agent conversation
 * named with no turn yet: each is a message the session took and the next
 * turn will receive, which is what reads an idle agent as running again
 * until that turn opens. The kind is held here as the writer holds it when
 * it takes such a line, since a planning conversation's turnless user rows
 * are its spoken asks and wait for no turn of eve's. A line a turn already
 * received under another row (`noReceiptOfLine`) is not counted.
 */
const countAwaitingLines = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, conversationIds: Schema.Array(Schema.String) }),
  Result: AwaitingLinesRowSchema,
  execute: ({ userId, conversationIds }) =>
    db
      .select({
        conversationId: messages.conversationId,
        lines: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(messages.userId, userId),
          inArray(messages.conversationId, [...conversationIds]),
          eq(conversations.kind, CONVERSATION_KIND.CODING_AGENT),
          eq(messages.role, MESSAGE_ROLE.USER),
          isNull(messages.turnId),
          noReceiptOfLine(),
        ),
      )
      .groupBy(messages.conversationId),
});

const findSentLine = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    clientId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId, clientId }) =>
    db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.userId, userId),
          eq(messages.clientId, clientId),
        ),
      )
      .limit(1),
});

/** Whether a row of the account's conversation stands under the client id: the line a send repeated after a lost answer already wrote, read before anything is sent again. */
export function sentLineStands(
  userId: string,
  conversationId: string,
  clientId: string,
): Effect.Effect<boolean, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.map(findSentLine({ userId, conversationId, clientId }), Option.isSome);
}

/** The conversations among those named in which a developer's line awaits its turn; one with none is absent. */
export function awaitingLinesOf(
  userId: string,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlySet<string>, MessageReadFailure, SqlClient.SqlClient> {
  if (conversationIds.length === 0) return Effect.succeed(new Set());
  return Effect.map(
    countAwaitingLines({ userId, conversationIds }),
    (rows) => new Set(rows.filter((row) => row.lines > 0).map((row) => row.conversationId)),
  );
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
});

export type StoredTurnRecord = typeof TurnRowSchema.Type;

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
    (rows) => Schema.decodeUnknownEffect(TurnRowsSchema)(rows),
  );
}

const findSpokenAskRows = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    turnIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ turnId: Schema.String, clientId: Schema.String }),
  execute: ({ userId, conversationId, turnIds }) =>
    db
      .select({ turnId: messages.turnId, clientId: messages.clientId })
      .from(messages)
      .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.conversationId, conversationId),
          inArray(messages.turnId, [...turnIds]),
          eq(messages.role, MESSAGE_ROLE.USER),
          sql`${messages.metadata}->>'channel' = ${MESSAGE_CHANNEL.VOICE}`,
        ),
      )
      .orderBy(asc(messages.seq)),
});

/**
 * The developer's spoken lines each of the turns named took as its ask, by
 * the client id the voice's ledger minted for each line, in the order the
 * conversation holds them: the rows a delegation's attach or the turn's
 * receipt took into the turn. A turn no spoken line opened names none.
 */
export function spokenAskRowsOf(
  userId: string,
  conversationId: string,
  turnIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly string[]>, MessageReadFailure, SqlClient.SqlClient> {
  if (turnIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(findSpokenAskRows({ userId, conversationId, turnIds }), (rows) => {
    const asked = new Map<string, string[]>();
    for (const row of rows) asked.set(row.turnId, [...(asked.get(row.turnId) ?? []), row.clientId]);
    return asked;
  });
}

const findTurnQueuedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
  }),
  Result: Schema.Struct({ queuedAt: InstantColumnSchema }),
  execute: ({ userId, conversationId, turnId }) =>
    db
      .select({ queuedAt: turns.queuedAt })
      .from(turns)
      .where(
        and(
          eq(turns.userId, userId),
          eq(turns.conversationId, conversationId),
          eq(turns.id, turnId),
        ),
      ),
});

const findTurnsBefore = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    limit: Schema.Number,
    before: Schema.optionalKey(Schema.Struct({ queuedAt: Schema.Date, id: Schema.String })),
  }),
  Result: TurnRowSchema,
  execute: ({ userId, conversationId, limit, before }) =>
    db
      .select(TURN_FIELDS)
      .from(turns)
      .innerJoin(conversations, TURN_CONVERSATION_STANDS)
      .where(
        and(
          eq(turns.userId, userId),
          eq(turns.conversationId, conversationId),
          before === undefined
            ? undefined
            : or(
                lt(turns.queuedAt, before.queuedAt),
                and(eq(turns.queuedAt, before.queuedAt), lt(turns.id, before.id)),
              ),
        ),
      )
      .orderBy(desc(turns.queuedAt), desc(turns.id))
      .limit(limit),
});

/** A page of a conversation's turns, oldest first, and whether older ones stand. */
export interface TurnPage {
  readonly turns: readonly StoredTurnRecord[];
  readonly earlier: boolean;
}

/**
 * The newest turns of the account's standing conversation queued before the
 * turn `before` names, or the newest of all with none, answered oldest
 * first by when each was queued. A turn the conversation does not hold
 * names no place, and answers an empty page.
 */
export function turnsBefore(
  userId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Effect.Effect<TurnPage, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    let place: { queuedAt: Date; id: string } | undefined;
    if (before !== undefined) {
      const named = yield* findTurnQueuedAt({ userId, conversationId, turnId: before });
      if (Option.isNone(named)) return { turns: [], earlier: false };
      place = { queuedAt: named.value.queuedAt, id: before };
    }
    const size = pageLimit({ limit });
    // One more than the page is asked for, so the read can tell whether older turns stand.
    const newestFirst = yield* findTurnsBefore({
      userId,
      conversationId,
      limit: size + 1,
      ...(place === undefined ? undefined : { before: place }),
    });
    return { turns: newestFirst.slice(0, size).reverse(), earlier: newestFirst.length > size };
  });
}

const findJournalsCalling = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    partType: Schema.String,
    seq: Schema.Number,
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
          eq(messages.role, MESSAGE_ROLE.ASSISTANT),
          gt(messages.seq, options.seq),
          sql`${messages.parts} @> ${JSON.stringify([{ type: options.partType }])}::jsonb`,
        ),
      )
      .orderBy(asc(messages.seq))
      .limit(options.limit),
});

/**
 * Every turn journal of the account's standing conversation that holds a
 * call of the tool named, oldest first, read a page at a time. Note that the
 * journals are picked by their parts in the statement, because a long
 * conversation's other journals are most of its bytes and none of the
 * answer. A page holding a row this build cannot read refuses the read, as
 * every page here does.
 */
export function listJournalsCalling(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  toolName: string,
): Effect.Effect<MessageListRead, MessageReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const read: StoredMessageRecord[] = [];
    let seq = -1;
    let full = true;
    while (full) {
      const selected = yield* findJournalsCalling({
        userId,
        conversationId,
        partType: toolPartType(toolName),
        seq,
        limit: MAXIMUM_READ_PAGE,
      });
      const page = yield* readSelected(selected, tools);
      if (!page.ok) return page;
      read.push(...page.value);
      seq = selected.at(-1)?.seq ?? seq;
      full = selected.length === MAXIMUM_READ_PAGE;
    }
    return { ok: true, value: read };
  });
}
