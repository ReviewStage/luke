import { toolPartType } from "@repo/features/turn-run";
import {
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type MessageRole,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "@repo/wire";
import {
  readStoredUIMessages,
  type StoredUIMessage,
  UNREGISTERED_TOOL_PART,
} from "@repo/wire/ui-messages";
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
  max,
  notExists,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import {
  conversations,
  messages,
  type StoredTurnUsage,
  standingLine,
  turnlessUserLine,
  turns,
} from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import {
  EpochMillisColumnSchema,
  InstantColumnSchema,
  optionalField,
  TurnUsageColumnSchema,
} from "./columns.js";
import { claimExpiredBefore } from "./dispatch-claim.js";

const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));
const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));
const MessageRoleSchema = Schema.Literals(Object.values(MESSAGE_ROLE));

const MAXIMUM_READ_PAGE = 200;

export interface StoredMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly placedAt: Date;
  readonly finishedAt?: Date;
  readonly revision?: number;
  readonly message: StoredUIMessage;
}

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

const MESSAGE_CONVERSATION_STANDS = and(
  eq(conversations.id, messages.conversationId),
  isNull(conversations.deletedAt),
  standingLine(messages),
);

const TURN_CONVERSATION_STANDS = and(
  eq(conversations.id, turns.conversationId),
  isNull(conversations.deletedAt),
);

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
    Database.use((db) =>
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
    ),
});

export function listRecentMessages(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  limit: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findRecentMessages({ conversationId, userId, limit: pageLimit({ limit }) }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findTurnOpeners = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    turnIds: Schema.Array(Schema.String),
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .selectDistinctOn([messages.turnId], MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            inArray(messages.turnId, [...options.turnIds]),
            isNotNull(messages.finishedAt),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
        .orderBy(messages.turnId, asc(messages.seq)),
    ),
});

export function listTurnOpeners(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  turnIds: readonly string[],
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  if (turnIds.length === 0) return Effect.succeed({ ok: true, value: [] });
  return Effect.flatMap(findTurnOpeners({ conversationId, userId, turnIds }), (selected) =>
    readSelected(
      selected.toSorted((first, second) => first.seq - second.seq),
      tools,
    ),
  );
}

const findMessagesBefore = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    before: Schema.Number,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            lt(messages.seq, options.before),
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(options.limit),
    ),
});

export function listMessagesBefore(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  before: number,
  limit?: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findMessagesBefore({
      conversationId,
      userId,
      before,
      limit: pageLimit({ ...(limit === undefined ? undefined : { limit }) }),
    }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findMessageSeq = SqlSchema.findOneOption({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    messageId: Schema.String,
    role: MessageRoleSchema,
  }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ seq: messages.seq })
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            eq(messages.id, options.messageId),
            eq(messages.role, options.role),
          ),
        ),
    ),
});

export function messageSeqOf(
  userId: string,
  conversationId: string,
  messageId: string,
  role: MessageRole,
): Effect.Effect<Option.Option<number>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findMessageSeq({ conversationId, userId, messageId, role }),
    Option.map((row) => row.seq),
  );
}

export interface MessageCursor {
  readonly seq: number;
  readonly revision: number;
}

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
    Database.use((db) =>
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
    ),
});

const findJournalRevision = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ journalRevision: EpochMillisColumnSchema }),
  execute: (options) =>
    Database.use((db) =>
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
    ),
});

export function listMessagesPast(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  cursor: MessageCursor,
  limit?: number,
): Effect.Effect<MessagePagePast, StoreFailure, DatabaseServices> {
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

const findHighestSeq = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ seq: sql<number>`coalesce(max(${messages.seq}), 0)`.mapWith(Number) })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
          ),
        ),
    ),
});

export function messageCursorNow(
  userId: string,
  conversationId: string,
): Effect.Effect<MessageCursor, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const standing = yield* findJournalRevision({ conversationId, userId });
    if (Option.isNone(standing)) return { seq: 0, revision: 0 };
    const [highest] = yield* findHighestSeq({ conversationId, userId });
    return { seq: highest?.seq ?? 0, revision: standing.value.journalRevision };
  });
}

export interface MessageStanding {
  readonly cursor: MessageCursor;
  readonly rewound: Option.Option<number>;
}

const findMessageStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({
    seq: EpochMillisColumnSchema,
    revision: EpochMillisColumnSchema,
    rewound: Schema.NullOr(EpochMillisColumnSchema),
  }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({
          seq: sql<number>`(
            select coalesce(max(${messages.seq}), 0) from ${messages}
            where ${and(eq(messages.conversationId, conversations.id), eq(messages.userId, options.userId))}
          )`,
          revision: conversations.journalRevision,
          rewound: conversations.rewoundRevision,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, options.conversationId),
            eq(conversations.userId, options.userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

export function messageStandingNow(
  userId: string,
  conversationId: string,
): Effect.Effect<MessageStanding, StoreFailure, DatabaseServices> {
  return Effect.map(
    findMessageStanding({ conversationId, userId }),
    Option.match({
      onNone: () => ({ cursor: { seq: 0, revision: 0 }, rewound: Option.none() }),
      onSome: (row) => ({
        cursor: { seq: row.seq, revision: row.revision },
        rewound: Option.fromNullishOr(row.rewound),
      }),
    }),
  );
}

const findRunningChildTurns = SqlSchema.findAll({
  Request: Schema.Struct({ parentConversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .innerJoin(conversations, eq(turns.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.parentConversationId, options.parentConversationId),
            eq(conversations.userId, options.userId),
            isNull(conversations.deletedAt),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
          ),
        )
        .orderBy(asc(turns.id)),
    ),
});

export function runningChildTurns(
  userId: string,
  parentConversationId: string,
): Effect.Effect<readonly string[], StoreFailure, DatabaseServices> {
  return Effect.map(findRunningChildTurns({ parentConversationId, userId }), (rows) =>
    rows.map((row) => row.id),
  );
}

const findNewestJournals = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
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
    ),
});

export function listJournals(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  limit: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findNewestJournals({ conversationId, userId, limit: pageLimit({ limit }) }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findNewestJournalOf = SqlSchema.findAll({
  Request: Schema.Struct({ conversationIds: Schema.Array(Schema.String) }),
  Result: SelectedMessageRowSchema,
  execute: ({ conversationIds }) =>
    Database.use((db) =>
      db
        .selectDistinctOn([messages.conversationId], MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            inArray(messages.conversationId, [...conversationIds]),
            eq(messages.role, MESSAGE_ROLE.ASSISTANT),
          ),
        )
        .orderBy(messages.conversationId, desc(messages.seq)),
    ),
});

export function newestJournalsOfReached(
  conversationIds: readonly string[],
  tools: ToolSet,
): Effect.Effect<ReadonlyMap<string, StoredMessageRecord>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.flatMap(findNewestJournalOf({ conversationIds }), (selected) =>
    Effect.map(
      Effect.forEach(selected, (row) => readSelected([row], tools)),
      (reads) =>
        new Map(
          reads
            .flatMap((read) => (read.ok ? read.value : []))
            .map((record) => [record.conversationId, record]),
        ),
    ),
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
    Database.use((db) =>
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
    ),
});

export function readMessageByClientId(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  clientId: string,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
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
    Database.use((db) =>
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
    ),
});

export function readMessageById(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  messageId: string,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(findMessageByIdRow({ conversationId, userId, messageId }), (selected) =>
    readSelected(selected, tools),
  );
}

export interface LatestTurn {
  readonly conversationId: string;
  readonly id: string;
  readonly status: string;
  readonly eveTurnId: string | null;
  readonly failure: string | null;
  readonly failureDetail: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly settledAt: Date | null;
  readonly model: string | null;
  readonly usage: StoredTurnUsage | null;
  readonly fastRefused: boolean;
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
  fastRefused: Schema.Boolean,
});

const ConversationsReadSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  conversationIds: Schema.Array(Schema.String),
});

const findLatestTurns = SqlSchema.findAll({
  Request: ConversationsReadSchema,
  Result: LatestTurnRowSchema,
  execute: ({ userId, conversationIds }) =>
    Database.use((db) =>
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
          fastRefused: turns.fastRefused,
        })
        .from(turns)
        .where(
          and(
            userId === null ? undefined : eq(turns.userId, userId),
            inArray(turns.conversationId, [...conversationIds]),
          ),
        )
        .orderBy(turns.conversationId, desc(turns.queuedAt), desc(turns.id)),
    ),
});

export type TurnUsageRow = Pick<LatestTurn, "model" | "fastRefused"> & {
  readonly usage: StoredTurnUsage;
};

const TurnUsageRowSchema = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  usage: TurnUsageColumnSchema,
  fastRefused: Schema.Boolean,
});

const findTurnUsages = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: TurnUsageRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ model: turns.model, usage: turns.usage, fastRefused: turns.fastRefused })
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
    ),
});

export function turnUsagesOf(
  userId: string,
  conversationId: string,
): Effect.Effect<readonly TurnUsageRow[], StoreFailure, DatabaseServices> {
  return findTurnUsages({ userId, conversationId });
}

function latestTurnsRead(
  userId: string | null,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLatestTurns({ userId, conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row])),
  );
}

export function latestTurnsOf(
  userId: string,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  return latestTurnsRead(userId, conversationIds);
}

export function latestTurnsOfReached(
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  return latestTurnsRead(null, conversationIds);
}

const findTurnStoppedUnder = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, key }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.cancelRequestKey, key)))
        .limit(1),
    ),
});

export function turnStoppedUnderReached(
  conversationId: string,
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findTurnStoppedUnder({ conversationId, key }), (rows) => rows.length > 0);
}

export function lastSettledTurnAt(conversationId: SQLWrapper): SQL<Date | null> {
  return sql<Date | null>`(${queryBuilder
    .select({ settledAt: sql<Date | null>`max(${turns.settledAt})` })
    .from(turns)
    .where(eq(turns.conversationId, conversationId))})`;
}

const LastSettledTurnRowSchema = Schema.Struct({
  conversationId: Schema.String,
  settledAt: InstantColumnSchema,
});

const findLastSettledTurns = SqlSchema.findAll({
  Request: Schema.Struct({ conversationIds: Schema.Array(Schema.String) }),
  Result: LastSettledTurnRowSchema,
  execute: ({ conversationIds }) =>
    Database.use((db) =>
      db
        .select({ conversationId: turns.conversationId, settledAt: max(turns.settledAt) })
        .from(turns)
        .where(and(inArray(turns.conversationId, [...conversationIds]), isNotNull(turns.settledAt)))
        .groupBy(turns.conversationId),
    ),
});

export function lastSettledTurnsOfReached(
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, Date>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLastSettledTurns({ conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.settledAt])),
  );
}

const AwaitingLinesRowSchema = Schema.Struct({
  conversationId: Schema.String,
  newestAt: InstantColumnSchema,
});

export const COALESCED_LINE_SEPARATOR = "\n\n";

const receipt = alias(messages, "receipt");

const fencedWords = (parts: AnyPgColumn) =>
  sql`${COALESCED_LINE_SEPARATOR} || (${parts} -> 0 ->> 'text') || ${COALESCED_LINE_SEPARATOR}`;

export function noReceiptOfLine() {
  return notExists(
    queryBuilder
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

function lineOfTheAgents(): SQL {
  return sql`(${messages.metadata} ->> 'channel' is distinct from ${MESSAGE_CHANNEL.VOICE} and ${messages.metadata} ->> 'voice_session_id' is null)`;
}

export function newestAwaitingLineAt(conversationId: SQLWrapper): SQL<Date | null> {
  return sql<Date | null>`(${queryBuilder
    .select({ newestAt: sql<Date | null>`max(${messages.createdAt})` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(conversations.kind, CONVERSATION_KIND.AGENT),
        turnlessUserLine(messages),
        isNull(messages.withdrawnAt),
        lineOfTheAgents(),
        noReceiptOfLine(),
      ),
    )})`;
}

const newestAwaitingLines = SqlSchema.findAll({
  Request: ConversationsReadSchema,
  Result: AwaitingLinesRowSchema,
  execute: ({ userId, conversationIds }) =>
    Database.use((db) =>
      db
        .select({
          conversationId: messages.conversationId,
          newestAt: max(messages.createdAt),
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            userId === null ? undefined : eq(messages.userId, userId),
            inArray(messages.conversationId, [...conversationIds]),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            turnlessUserLine(messages),
            isNull(messages.withdrawnAt),
            lineOfTheAgents(),
            noReceiptOfLine(),
          ),
        )
        .groupBy(messages.conversationId),
    ),
});

const findSentLine = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    clientId: Schema.String,
    claimExpiredBefore: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(messages.conversationId, key.conversationId),
            eq(messages.userId, key.userId),
            eq(messages.clientId, key.clientId),
            standingLine(messages),
            sql`not (${conversations.dispatchLine} is not distinct from ${messages.id} and ${conversations.dispatchClaimedAt} > ${key.claimExpiredBefore})`,
          ),
        )
        .limit(1),
    ),
});

export function sentLineStands(
  userId: string,
  conversationId: string,
  clientId: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      findSentLine({
        userId,
        conversationId,
        clientId,
        claimExpiredBefore: claimExpiredBefore(now),
      }),
      Option.isSome,
    ),
  );
}

function awaitingLinesRead(
  userId: string | null,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, Date>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    newestAwaitingLines({ userId, conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.newestAt])),
  );
}

export function awaitingLinesOf(
  userId: string,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, Date>, StoreFailure, DatabaseServices> {
  return awaitingLinesRead(userId, conversationIds);
}

export function awaitingLinesOfReached(
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, Date>, StoreFailure, DatabaseServices> {
  return awaitingLinesRead(null, conversationIds);
}

const TURN_CHANGED_AT = sql`
  greatest(
    ${turns.queuedAt},
    coalesce(${turns.startedAt}, ${turns.queuedAt}),
    coalesce(${turns.settledAt}, ${turns.queuedAt}),
    coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
  )
`;

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
  fastRefused: turns.fastRefused,
};

const TurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  origin: TurnOriginSchema,
  status: TurnStatusSchema,
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
  fastRefused: Schema.Boolean,
});

export type StoredTurnRecord = typeof TurnRowSchema.Type;

const TurnRowsSchema = Schema.Array(TurnRowSchema);

export function turnsNamed(
  userId: string,
  turnIds: readonly string[],
): Effect.Effect<readonly StoredTurnRecord[], StoreFailure, DatabaseServices> {
  if (turnIds.length === 0) return Effect.succeed([]);
  return Effect.flatMap(
    Database.use((db) =>
      db
        .select(TURN_FIELDS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION_STANDS)
        .where(and(eq(turns.userId, userId), inArray(turns.id, [...turnIds])))
        .orderBy(asc(TURN_CHANGED_AT), asc(turns.id)),
    ),
    (rows) => Schema.decodeUnknownEffect(TurnRowsSchema)(rows),
  );
}

const findTurnQueuedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
  }),
  Result: Schema.Struct({ queuedAt: InstantColumnSchema }),
  execute: ({ userId, conversationId, turnId }) =>
    Database.use((db) =>
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
    Database.use((db) =>
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
    ),
});

export interface TurnPage {
  readonly turns: readonly StoredTurnRecord[];
  readonly earlier: boolean;
}

export function turnsBefore(
  userId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Effect.Effect<TurnPage, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    let place: { queuedAt: Date; id: string } | undefined;
    if (before !== undefined) {
      const named = yield* findTurnQueuedAt({ userId, conversationId, turnId: before });
      if (Option.isNone(named)) return { turns: [], earlier: false };
      place = { queuedAt: named.value.queuedAt, id: before };
    }
    const size = pageLimit({ limit });
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
    Database.use((db) =>
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
    ),
});

export function listJournalsCalling(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  toolName: string,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
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
