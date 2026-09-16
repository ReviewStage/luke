import type { TextUIPart } from "ai";
import { and, asc, desc, eq, inArray, isNull, notExists, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  CHILD_STATUS,
  CHILDREN_READ_BOUNDS,
  type ChildStatus,
  MESSAGE_ROLE,
  TURN_STATUS,
  type TurnStatus,
} from "../../core.js";
import { user } from "../../db/auth-schema.js";
import { db } from "../../db/query.js";
import { conversations, messages, turns } from "../../db/storage-schema.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./database.js";
import type { ConversationTarget } from "./writer.js";

/**
 * The account's children: the conversations a delegation opened, each a row
 * of kind `child` under the conversation that delegated and the message that
 * spawned it. A child has no run record of its own — where it stands is
 * derived from its turns, so there is one place a run is written and no
 * second record to fall out of step with it: no turn yet, or one still
 * queued, is a task accepted; a running turn is a child running; and
 * otherwise the child stands where its latest turn settled. A row Clear
 * stamped went with its parent and is listed by nothing here.
 *
 * Every statement is a Drizzle builder over the tables `db/storage-schema.ts`
 * declares, yielded as the Effect `db/drizzle.ts`'s bridge makes it, so a
 * read is still an `Effect<A, SqlError | SchemaError, SqlClient>` and a
 * column renamed under `db/` is a type error here. What the builder cannot
 * spell — the task's excerpt over a `jsonb` array, the instant a child last
 * changed, and the guarded insert of a child — is a named `sql` fragment
 * inside one rendered statement.
 */

/** The kinds a delegation runs from: a child cannot open a child of its own, and a thread delegates nothing. */
const CHILD_PARENT_KINDS = [CONVERSATION_KIND.MAIN, CONVERSATION_KIND.OBSERVED] as const;

type ChildParentKind = (typeof CHILD_PARENT_KINDS)[number];

export interface ChildRecord {
  readonly id: string;
  readonly parentConversationId: string;
  readonly parentKind: ChildParentKind;
  /** The name the delegation gave the child, or none. */
  readonly label: string | null;
  /** The first words the parent handed the child, cut at the wire's excerpt bound; none before a line stands or where it holds no text. */
  readonly task: string | null;
  /** Whether the delegation waits on the child's completion coming back to the parent. */
  readonly expectsCompletion: boolean;
  readonly createdAt: Date;
  /** The eve session the child runs in, once its start or the opener claimed the row. */
  readonly runtimeSessionId: string | null;
  readonly status: ChildStatus;
  /** The latest turn, by the store's id and eve's own, each unset before one stands or before eve named it. */
  readonly turnId: string | null;
  readonly eveTurnId: string | null;
  /** The latest turn's stamps, each unset until the turn reached it, and all unset before a turn stands. */
  readonly startedAt: Date | null;
  readonly settledAt: Date | null;
  readonly failure: string | null;
}

/**
 * Where the account's children stand as one instant: the latest of any
 * child's stamps, the Clear that stamped one included, as Postgres renders it
 * to the microsecond, and that child's id to break a tie. Text rather than a
 * `Date` on the turn cursor's own terms: a millisecond cannot tell two stamps
 * set in the same millisecond apart.
 */
export interface ChildrenHeadPosition {
  readonly changedAt: string;
  readonly id: string;
}

type ChildReadFailure = SqlError | Schema.SchemaError;

/** The SDK's own name for a text part, which is what a task's words are read from. */
const TEXT_PART_TYPE: TextUIPart["type"] = "text";

/** The child's row and its parent's: the one table under the two names every read here joins it by. */
const child = alias(conversations, "child");
const parent = alias(conversations, "parent");

/** A lateral join's own predicate, which every lateral here holds to unconditionally. */
const ON_TRUE = sql`true`;

/**
 * The latest of a child's turns, by the instant it was queued and the id
 * breaking a tie. Joined to the child's own account, so a turn written under
 * another lends the child nothing whatever id it names.
 */
const latest = db
  .select({
    id: turns.id,
    eveTurnId: turns.eveTurnId,
    status: turns.status,
    queuedAt: turns.queuedAt,
    startedAt: turns.startedAt,
    settledAt: turns.settledAt,
    failure: turns.failure,
  })
  .from(turns)
  .where(and(eq(turns.conversationId, child.id), eq(turns.userId, child.userId)))
  .orderBy(desc(turns.queuedAt), desc(turns.id))
  .limit(1)
  .as("latest");

/** The child's first user line, which is the task it was handed; held to the child's own account the same way. */
const firstLine = db
  .select({ parts: messages.parts, createdAt: messages.createdAt })
  .from(messages)
  .where(
    and(
      eq(messages.conversationId, child.id),
      eq(messages.userId, child.userId),
      eq(messages.role, MESSAGE_ROLE.USER),
    ),
  )
  .orderBy(asc(messages.seq))
  .limit(1)
  .as("first_line");

/**
 * The leading run a task's excerpt drops before it is cut: the whitespace
 * JavaScript's `trim` drops, spelled for Postgres's regex, so a line padded
 * with spaces of any kind spends none of the bound on them and the route's
 * own trim then finds nothing more to drop at the front.
 */
const LEADING_WHITESPACE_SQL_REGEX =
  "^[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+";

/**
 * The task's excerpt: the text parts of the child's first user line, in
 * their order, its leading whitespace dropped so it spends none of the bound,
 * cut to the wire's bound; null where no line stands, since a null holds no
 * elements. The cut is in characters where the wire's is in UTF-16 units, so
 * the read stays bounded and the route makes the exact cut. There is no
 * builder spelling for unnesting a `jsonb` array with ordinality, so the
 * whole projection is a fragment.
 */
const TASK_EXCERPT = sql<string | null>`
  (
    select left(
      regexp_replace(
        string_agg(part.value ->> 'text', ' ' order by part.ordinality),
        ${LEADING_WHITESPACE_SQL_REGEX},
        ''
      ),
      ${CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS}
    )
    from jsonb_array_elements(${firstLine.parts}) with ordinality as part(value, ordinality)
    where part.value ->> 'type' = ${TEXT_PART_TYPE}
  )
`;

/** The child's row joined to its parent's kind, its latest turn where one stands, and its task's excerpt. */
const ChildRowSchema = Schema.Struct({
  id: Schema.String,
  parentConversationId: Schema.String,
  parentKind: Schema.Literals(CHILD_PARENT_KINDS),
  label: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.Boolean,
  createdAt: InstantColumnSchema,
  runtimeSessionId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  eveTurnId: Schema.NullOr(Schema.String),
  turnStatus: Schema.NullOr(
    Schema.Literals([
      TURN_STATUS.QUEUED,
      TURN_STATUS.RUNNING,
      TURN_STATUS.SETTLED,
      TURN_STATUS.CANCELLED,
      TURN_STATUS.FAILED,
    ]),
  ),
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
});

type ChildRow = typeof ChildRowSchema.Type;

/**
 * The join that makes a row a child: its parent's, under the child's own
 * account. A child without a parent, or under a conversation of a kind no
 * delegation runs from, is a row no delegation wrote and is not a child; and
 * a parent written under another account lends the child nothing, whatever
 * id it names.
 */
const PARENT_OF_CHILD = and(
  eq(parent.id, child.parentConversationId),
  eq(parent.userId, child.userId),
);

/** A child of the account, under a parent of a kind a delegation runs from; whether a stamped one counts is the caller's. */
const childOf = (userId: string) =>
  and(
    eq(child.userId, userId),
    eq(child.kind, CONVERSATION_KIND.CHILD),
    inArray(parent.kind, [...CHILD_PARENT_KINDS]),
  );

/** The rows the record reads list: the standing children, a Clear-stamped one gone with its parent. */
const STANDING_CHILD = isNull(child.deletedAt);

/** The columns both record reads project, the task's excerpt among them. */
const CHILD_FIELDS = {
  id: child.id,
  parentConversationId: child.parentConversationId,
  parentKind: parent.kind,
  label: child.label,
  task: TASK_EXCERPT,
  expectsCompletion: child.expectsCompletion,
  createdAt: child.createdAt,
  runtimeSessionId: child.runtimeSessionId,
  turnId: latest.id,
  eveTurnId: latest.eveTurnId,
  turnStatus: latest.status,
  startedAt: latest.startedAt,
  settledAt: latest.settledAt,
  failure: latest.failure,
};

/**
 * The one select every record read here shares: the account's children under
 * the caller's condition, each joined to its parent, to the latest of its
 * turns, and to its first user line, newest first and at most `limit` rows.
 */
const selectChildren = (where: SQL | undefined, limit: number) =>
  db
    .select(CHILD_FIELDS)
    .from(child)
    .innerJoin(parent, PARENT_OF_CHILD)
    .leftJoinLateral(latest, ON_TRUE)
    .leftJoinLateral(firstLine, ON_TRUE)
    .where(where)
    .orderBy(desc(child.createdAt), desc(child.id))
    .limit(limit);

const findChildren = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: ChildRowSchema,
  execute: (request) => selectChildren(and(childOf(request.userId), STANDING_CHILD), request.limit),
});

const findChildrenOf = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    limit: Schema.Number,
  }),
  Result: ChildRowSchema,
  execute: (request) =>
    selectChildren(
      and(
        childOf(request.userId),
        eq(child.parentConversationId, request.parentConversationId),
        STANDING_CHILD,
      ),
      request.limit,
    ),
});

const findChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: ChildRowSchema,
  execute: (request) =>
    selectChildren(and(childOf(request.userId), eq(child.id, request.childId), STANDING_CHILD), 1),
});

/**
 * The instant a child last changed: opened, handed its task, stamped by a
 * Clear, its completion delivered, or its latest turn queued, started, or
 * settled, whichever is latest. Each stamp the child has not reached falls
 * back to its opening, so the expression is never null. The task's line
 * counts because the list answers its excerpt; the stamping counts because it
 * takes the child out of the list, which is a change the list reads
 * differently under; and the purge that removes the row thirty days on moves
 * the head once more, to whatever then stands.
 */
const CHILD_CHANGED_AT = sql`
  greatest(
    ${child.createdAt},
    coalesce(${firstLine.createdAt}, ${child.createdAt}),
    coalesce(${child.deletedAt}, ${child.createdAt}),
    coalesce(${child.completionDeliveredAt}, ${child.createdAt}),
    coalesce(${latest.queuedAt}, ${child.createdAt}),
    coalesce(${latest.startedAt}, ${child.createdAt}),
    coalesce(${latest.settledAt}, ${child.createdAt})
  )
`;

// Rendered as the turn cursor's instant is: the UTC wall clock with the zone
// spelled here, so the text is a property of the query rather than of the
// connection's TimeZone.
const CHILD_CHANGED_AT_TEXT = sql<string>`((${CHILD_CHANGED_AT}) at time zone 'UTC')::text || '+00'`;

const findChildrenHead = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, changedAt: Schema.String }),
  execute: (request) =>
    db
      .select({ id: child.id, changedAt: CHILD_CHANGED_AT_TEXT })
      .from(child)
      .innerJoin(parent, PARENT_OF_CHILD)
      .leftJoinLateral(latest, ON_TRUE)
      .leftJoinLateral(firstLine, ON_TRUE)
      .where(childOf(request.userId))
      .orderBy(desc(CHILD_CHANGED_AT), desc(child.id))
      .limit(1),
});

function childStatus(turnStatus: TurnStatus | null): ChildStatus {
  return turnStatus === null || turnStatus === TURN_STATUS.QUEUED
    ? CHILD_STATUS.ACCEPTED
    : turnStatus;
}

function toChildRecord({ turnStatus, ...row }: ChildRow): ChildRecord {
  return { ...row, status: childStatus(turnStatus) };
}

/** The account's standing children, newest first and at most `limit` of them. */
export function listChildren(
  userId: string,
  limit: number,
): Effect.Effect<readonly ChildRecord[], ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(findChildren({ userId, limit }), (rows) => rows.map(toChildRecord));
}

/** One conversation's standing children, newest first and at most `limit` of them. */
export function listChildrenOf(
  userId: string,
  parentConversationId: string,
  limit: number,
): Effect.Effect<readonly ChildRecord[], ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(findChildrenOf({ userId, parentConversationId, limit }), (rows) =>
    rows.map(toChildRecord),
  );
}

/** What a delegation writes down as it opens a child: whose it is, what it hangs from, and how it was named. */
export interface ChildOpen {
  readonly userId: string;
  readonly parentConversationId: string;
  readonly spawnedByMessageId: string;
  /** The name the delegation gave the child, or none. */
  readonly label: string | null;
  /** Whether the delegation waits on the child's completion coming back to the parent. */
  readonly expectsCompletion: boolean;
  readonly now: Date;
}

const ChildIdRowSchema = Schema.Struct({ id: Schema.String });

/** Takes the account's user row lock for the transaction, the same lock Clear holds. */
const lockUser = (userId: string) =>
  db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");

/**
 * The insert selects from the parent's row, so a parent that does not stand
 * for the account — cleared, another account's, of a kind no delegation runs
 * from, or no row at all — or a spawning message that is not the parent's
 * own inserts nothing, and the delegation learns so from the empty answer
 * rather than from a child hanging under a conversation its account cannot
 * read.
 *
 * Note that the insert is a fragment standing as this statement's own CTE
 * rather than a builder insert, because the builder cannot spell an
 * `insert … select` over some of a table's columns: `PgInsertBuilder.select`
 * holds the selected fields to every insertable column of the table, in the
 * table's own order. The columns it names are the schema module's, so a
 * renamed column still moves this statement; what it returns is read back
 * through the builder's select over the CTE, which is what decodes the row.
 */
const insertedChild = (write: {
  readonly userId: string;
  readonly parentConversationId: string;
  readonly spawnedByMessageId: string;
  readonly label: string | null;
  readonly expectsCompletion: boolean;
  readonly now: Date;
}) =>
  db.$with("inserted", { id: conversations.id }).as(
    sql`
      insert into ${conversations} (
        ${sql.identifier(conversations.userId.name)},
        ${sql.identifier(conversations.kind.name)},
        ${sql.identifier(conversations.parentConversationId.name)},
        ${sql.identifier(conversations.spawnedByMessageId.name)},
        ${sql.identifier(conversations.label.name)},
        ${sql.identifier(conversations.expectsCompletion.name)},
        ${sql.identifier(conversations.createdAt.name)},
        ${sql.identifier(conversations.lastActivityAt.name)}
      )
      select ${parent.userId}, ${CONVERSATION_KIND.CHILD}, ${parent.id},
             ${write.spawnedByMessageId}, ${write.label}, ${write.expectsCompletion},
             ${write.now}, ${write.now}
      from ${conversations} ${parent}
      where ${and(
        eq(parent.id, write.parentConversationId),
        eq(parent.userId, write.userId),
        inArray(parent.kind, [...CHILD_PARENT_KINDS]),
        isNull(parent.deletedAt),
        sql`exists ${db
          .select({ spawned: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.id, write.spawnedByMessageId),
              eq(messages.conversationId, parent.id),
              eq(messages.userId, parent.userId),
            ),
          )}`,
      )}
      returning ${conversations.id}
    `,
  );

const insertChild = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    spawnedByMessageId: Schema.String,
    label: Schema.NullOr(Schema.String),
    expectsCompletion: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: ChildIdRowSchema,
  execute: (write) => {
    const inserted = insertedChild(write);
    return db.with(inserted).select({ id: inserted.id }).from(inserted);
  },
});

/**
 * Opens a child under the account's standing parent, answering its id;
 * nothing where the parent or its spawning message does not stand for the
 * account. The open takes the account's user row lock first, the same lock
 * Clear holds, so a child opened beside a Clear is either stamped with its
 * parent or refused against the parent Clear stamped, and never left
 * standing under a cleared one.
 */
export function openChildConversation(
  open: ChildOpen,
): Effect.Effect<string | undefined, ChildReadFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(open.userId);
        const inserted = yield* insertChild(open);
        return Option.getOrUndefined(Option.map(inserted, (row) => row.id));
      }),
    ),
  );
}

const abandonChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String, now: Schema.Date }),
  Result: ChildIdRowSchema,
  execute: (request) =>
    db
      .update(conversations)
      .set({ deletedAt: request.now })
      .where(
        and(
          eq(conversations.id, request.childId),
          eq(conversations.userId, request.userId),
          eq(conversations.kind, CONVERSATION_KIND.CHILD),
          isNull(conversations.deletedAt),
          isNull(conversations.runtimeSessionId),
        ),
      )
      .returning({ id: conversations.id }),
});

/**
 * Stamps a child no session has claimed, the row a delegation opened and
 * then heard no session for from eve, so it is listed by nothing and the
 * purge takes it with the rest; a session that starts for it after the
 * stamp finds a cleared conversation and is refused. Answers whether the
 * row was stamped: a child a session has claimed meanwhile is left standing
 * whatever the caller heard, since the claim is the truth that a session
 * runs it.
 */
export function abandonChildConversation(
  userId: string,
  childId: string,
  now: Date,
): Effect.Effect<boolean, ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(abandonChild({ userId, childId, now }), Option.isSome);
}

/** The child's own row lock, the one every turn write takes for its transaction; nothing where the child does not stand for the account. */
const lockChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: ChildIdRowSchema,
  execute: (request) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, request.childId),
          eq(conversations.userId, request.userId),
          eq(conversations.kind, CONVERSATION_KIND.CHILD),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update"),
});

const dropChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String, now: Schema.Date }),
  Result: ChildIdRowSchema,
  execute: (request) =>
    db
      .update(conversations)
      .set({ deletedAt: request.now })
      .where(
        and(
          eq(conversations.id, request.childId),
          eq(conversations.userId, request.userId),
          notExists(
            db
              .select({ ran: turns.id })
              .from(turns)
              .where(
                and(eq(turns.conversationId, request.childId), eq(turns.userId, request.userId)),
              ),
          ),
        ),
      )
      .returning({ id: conversations.id }),
});

/**
 * Stamps a standing child no turn has run for, whatever session it records,
 * the same stamp Clear sets: a child accepted but never started, which eve
 * took the open of and ran nothing for, and which a cancel could otherwise
 * end by nothing eve names. A session that starts for it late finds a
 * cleared conversation and is refused at admission. Answers whether the row
 * was stamped. The child's row lock is taken first, in its own statement,
 * because every turn write holds that lock for its transaction: once it is
 * held no turn is in flight, the check that follows reads under a snapshot
 * of its own and sees any turn committed meanwhile (a lock waited on
 * refreshes an update's own row but not its subquery), and a turn write
 * waiting behind the stamp finds the child gone. A turn that started leaves
 * the child standing, as the running child it is.
 */
export function dropChildConversation(
  userId: string,
  childId: string,
  now: Date,
): Effect.Effect<boolean, ChildReadFailure, SqlClient.SqlClient> {
  const request = { userId, childId };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockChild(request))) return false;
        return Option.isSome(yield* dropChild({ ...request, now }));
      }),
    ),
  );
}

/** One of the account's standing children by id, or none. */
export function readChild(
  userId: string,
  childId: string,
): Effect.Effect<Option.Option<ChildRecord>, ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(findChild({ userId, childId }), Option.map(toChildRecord));
}

/** Where the account's children stand: the child that changed last and the instant it did, a stamped child counted; none while no child was ever opened. */
export function childrenHead(
  userId: string,
): Effect.Effect<Option.Option<ChildrenHeadPosition>, ChildReadFailure, SqlClient.SqlClient> {
  return findChildrenHead({ userId });
}

const SpawningMessageRowSchema = Schema.Struct({ id: Schema.String });

const findSpawningMessage = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
  }),
  Result: SpawningMessageRowSchema,
  execute: (request) =>
    db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, request.conversationId),
          eq(messages.userId, request.userId),
          sql`(${eq(messages.clientId, request.turnId)} or ${eq(messages.turnId, request.turnId)})`,
        ),
      )
      .orderBy(desc(eq(messages.clientId, request.turnId)), desc(messages.seq))
      .limit(1),
});

/**
 * The message a turn's delegation spawns its child from: the turn's own
 * journal, the row whose client id is the turn's id, where the relay has
 * opened it; otherwise the newest row the turn has, the line it was handed,
 * since the relay writes the journal on its own fiber and a call may run
 * before it lands. Nothing where the turn has no row yet.
 */
export function readSpawningMessage(
  target: ConversationTarget,
  turnId: string,
): Effect.Effect<string | undefined, ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(
    findSpawningMessage({ userId: target.userId, conversationId: target.conversationId, turnId }),
    (found) => Option.getOrUndefined(Option.map(found, (row) => row.id)),
  );
}

/** The turn statuses a child's run has ended in; a completion is owed at one of these and at nothing before. */
const TERMINAL_TURN_STATUS = [
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
] as const;

type TerminalTurnStatus = (typeof TERMINAL_TURN_STATUS)[number];

function isTerminal(status: TurnStatus): status is TerminalTurnStatus {
  return (
    status === TURN_STATUS.SETTLED ||
    status === TURN_STATUS.CANCELLED ||
    status === TURN_STATUS.FAILED
  );
}

/** What the completion's words need of a child, read as its row is stamped. */
export interface ClaimedChildCompletion {
  /** The conversation that delegated, which the completion is a turn of. */
  readonly parent: ConversationTarget;
  readonly label: string | null;
  /** Whether the delegation waits on the completion; a stamped row that expected none sends nothing. */
  readonly expectsCompletion: boolean;
  /** The child's latest turn, the run the completion reports: its id, the journal's key, and how it ended. */
  readonly turnId: string;
  readonly status: TerminalTurnStatus;
  readonly failure: string | null;
}

const ParentLockRowSchema = Schema.Struct({ parentConversationId: Schema.String });

/**
 * The parent's row lock, the same one an ask's dispatch takes on the
 * conversation it writes into, taken through the child so the child, its
 * parent, and the account are one row's word; nothing where the child or
 * its parent does not stand for the account.
 */
const lockParentOf = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: ParentLockRowSchema,
  execute: (request) =>
    db
      .select({ parentConversationId: parent.id })
      .from(child)
      .innerJoin(parent, PARENT_OF_CHILD)
      .where(
        and(
          eq(child.id, request.childId),
          eq(child.userId, request.userId),
          eq(child.kind, CONVERSATION_KIND.CHILD),
          isNull(child.deletedAt),
          isNull(parent.deletedAt),
        ),
      )
      .for("update", { of: parent }),
});

const CompletionRowSchema = Schema.Struct({
  label: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.NullOr(Schema.Boolean),
  completionDeliveredAt: Schema.NullOr(InstantColumnSchema),
  turnId: Schema.NullOr(Schema.String),
  turnStatus: Schema.NullOr(Schema.Literals(Object.values(TURN_STATUS))),
  failure: Schema.NullOr(Schema.String),
});

/** The child's row and its latest turn, read under the parent's lock. */
const readCompletion = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: CompletionRowSchema,
  execute: (request) =>
    db
      .select({
        label: child.label,
        expectsCompletion: child.expectsCompletion,
        completionDeliveredAt: child.completionDeliveredAt,
        turnId: latest.id,
        turnStatus: latest.status,
        failure: latest.failure,
      })
      .from(child)
      .leftJoinLateral(latest, ON_TRUE)
      .where(and(eq(child.id, request.childId), eq(child.userId, request.userId))),
});

const stampCompletion = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String, now: Schema.Date }),
  execute: (request) =>
    db
      .update(conversations)
      .set({ completionDeliveredAt: request.now })
      .where(
        and(
          eq(conversations.id, request.childId),
          eq(conversations.userId, request.userId),
          isNull(conversations.completionDeliveredAt),
        ),
      ),
});

/**
 * Claims a child's completion: in one transaction, under the account's user
 * row lock and then the parent's row lock, reads the child and its latest
 * turn, and where the run has ended and no completion is stamped yet stamps
 * `completion_delivered_at` and answers what the words need; nothing where
 * the child does not stand for the account, is still running, or is stamped
 * already. The locks are taken in the order Clear and the child open take
 * theirs, the user row first, so a claim beside either waits rather than
 * deadlocks. The stamp is the mark that precedes the send, so two callers
 * finding the same ended child — the relay on the turn's end and the sweep
 * a minute later — claim it once between them, and what is guaranteed is at
 * most one completion turn per child, never that it arrived.
 */
export function claimChildCompletion(
  target: ConversationTarget,
  now: Date,
): Effect.Effect<ClaimedChildCompletion | undefined, ChildReadFailure, SqlClient.SqlClient> {
  const request = { userId: target.userId, childId: target.conversationId };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(target.userId);
        const locked = yield* lockParentOf(request);
        if (Option.isNone(locked)) return undefined;
        const read = yield* readCompletion(request);
        if (Option.isNone(read)) return undefined;
        const row = read.value;
        if (row.completionDeliveredAt !== null) return undefined;
        if (row.turnId === null || row.turnStatus === null || !isTerminal(row.turnStatus)) {
          return undefined;
        }
        yield* stampCompletion({ ...request, now });
        return {
          parent: { userId: target.userId, conversationId: locked.value.parentConversationId },
          label: row.label,
          expectsCompletion: row.expectsCompletion ?? true,
          turnId: row.turnId,
          status: row.turnStatus,
          failure: row.failure,
        };
      }),
    ),
  );
}

const UndeliveredChildRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
});

const findUndeliveredChildren = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: UndeliveredChildRowSchema,
  execute: (request) =>
    db
      .select({ id: child.id, userId: child.userId })
      .from(child)
      .innerJoin(parent, PARENT_OF_CHILD)
      .innerJoinLateral(latest, ON_TRUE)
      .where(
        and(
          eq(child.userId, request.userId),
          eq(child.kind, CONVERSATION_KIND.CHILD),
          isNull(child.deletedAt),
          isNull(parent.deletedAt),
          isNull(child.completionDeliveredAt),
          inArray(latest.status, [...TERMINAL_TURN_STATUS]),
        ),
      )
      .orderBy(asc(latest.settledAt), asc(child.createdAt), asc(child.id))
      .limit(request.limit),
});

/**
 * The account's standing children whose run has ended and whose completion
 * is not stamped, oldest run first and at most `limit` of them: what the
 * sweep visits for the completions the relay did not deliver.
 */
export function undeliveredChildren(
  userId: string,
  limit: number,
): Effect.Effect<readonly ConversationTarget[], ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(findUndeliveredChildren({ userId, limit }), (rows) =>
    rows.map((row) => ({ userId: row.userId, conversationId: row.id })),
  );
}
