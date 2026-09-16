import type { TextUIPart } from "ai";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { Fragment } from "effect/unstable/sql/Statement";
import {
  CHILD_STATUS,
  CHILDREN_READ_BOUNDS,
  type ChildStatus,
  MESSAGE_ROLE,
  TURN_STATUS,
  type TurnStatus,
} from "../../core.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "./database.js";
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
 */

export { CHILD_STATUS };

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
  /** When the child's completion reached its parent as a turn of the parent's own; unset until it has. */
  readonly completionDeliveredAt: Date | null;
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
  /** The counters a page of the child's own rows is read against, as the standing conversations carry them. */
  readonly nextMessageSeq: number;
  readonly nextEventSeq: number;
  readonly journalRevision: number;
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

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** The SDK's own name for a text part, which is what a task's words are read from. */
const TEXT_PART_TYPE: TextUIPart["type"] = "text";

/** The child's row joined to its parent's kind, its latest turn where one stands, and its task's excerpt. */
const ChildRowSchema = Schema.Struct({
  id: Schema.String,
  parentConversationId: Schema.String,
  parentKind: Schema.Literals(CHILD_PARENT_KINDS),
  label: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.Boolean,
  createdAt: InstantColumnSchema,
  completionDeliveredAt: Schema.NullOr(InstantColumnSchema),
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
  nextMessageSeq: EpochMillisColumnSchema,
  nextEventSeq: EpochMillisColumnSchema,
  journalRevision: EpochMillisColumnSchema,
}).pipe(
  Schema.encodeKeys({
    parentConversationId: "parent_conversation_id",
    parentKind: "parent_kind",
    expectsCompletion: "expects_completion",
    createdAt: "created_at",
    completionDeliveredAt: "completion_delivered_at",
    runtimeSessionId: "runtime_session_id",
    turnId: "turn_id",
    eveTurnId: "eve_turn_id",
    turnStatus: "turn_status",
    startedAt: "started_at",
    settledAt: "settled_at",
    nextMessageSeq: "next_message_seq",
    nextEventSeq: "next_event_seq",
    journalRevision: "journal_revision",
  }),
);

type ChildRow = typeof ChildRowSchema.Type;

/**
 * The rows every read here selects from: the account's children under
 * `conditions`, each joined to its parent (a child without one, or under a
 * conversation of a kind no delegation runs from, is a row no delegation
 * wrote, and is not a child), to the latest of its turns by the instant it
 * was queued, the id breaking a tie, and to its first user line, which is
 * the task it was handed. Every join holds to the child's own account, so a
 * parent, a turn, or a line written under another lends the child nothing,
 * whatever id it names. Whether a stamped child is among the rows is
 * the caller's condition: the record reads list what stands, the head counts
 * the stamping as the change it is.
 */
const childrenFrom = (sql: SqlClient.SqlClient, conditions: readonly Fragment[]) =>
  sql`
    from conversations child
    join conversations parent
      on parent.id = child.parent_conversation_id and parent.user_id = child.user_id
    left join lateral (
      select id, eve_turn_id, status, queued_at, started_at, settled_at, failure
      from turns
      where turns.conversation_id = child.id and turns.user_id = child.user_id
      order by turns.queued_at desc, turns.id desc
      limit 1
    ) latest on true
    left join lateral (
      select parts, created_at
      from messages
      where messages.conversation_id = child.id
        and messages.user_id = child.user_id
        and messages.role = ${MESSAGE_ROLE.USER}
      order by messages.seq asc
      limit 1
    ) first_line on true
    where ${sql.and([
      sql`child.kind = ${CONVERSATION_KIND.CHILD}`,
      sql.in("parent.kind", CHILD_PARENT_KINDS),
      ...conditions,
    ])}
  `;

/** The rows the record reads list: the standing children, a Clear-stamped one gone with its parent. */
const standingChild = (sql: SqlClient.SqlClient) => sql`child.deleted_at is null`;

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
 * the read stays bounded and the route makes the exact cut.
 */
const taskExcerpt = (sql: SqlClient.SqlClient) =>
  sql`
    (
      select left(
        regexp_replace(
          string_agg(part.value ->> 'text', ' ' order by part.ordinality),
          ${LEADING_WHITESPACE_SQL_REGEX},
          ''
        ),
        ${CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS}
      )
      from jsonb_array_elements(first_line.parts) with ordinality as part(value, ordinality)
      where part.value ->> 'type' = ${TEXT_PART_TYPE}
    )
  `;

/** The one select both record reads share: newest first, at most `limit` rows. */
const selectChildren = (sql: SqlClient.SqlClient, conditions: readonly Fragment[], limit: number) =>
  sql`
    select child.id, child.parent_conversation_id, parent.kind as parent_kind, child.label,
           ${taskExcerpt(sql)} as task, child.expects_completion,
           child.created_at, child.completion_delivered_at, child.runtime_session_id,
           latest.id as turn_id, latest.eve_turn_id, latest.status as turn_status,
           latest.started_at, latest.settled_at, latest.failure,
           child.next_message_seq, child.next_event_seq, child.journal_revision
    ${childrenFrom(sql, conditions)}
    order by child.created_at desc, child.id desc
    limit ${limit}
  `;

const findChildren = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: ChildRowSchema,
  execute: (request) =>
    statement((sql) =>
      selectChildren(
        sql,
        [sql`child.user_id = ${request.userId}`, standingChild(sql)],
        request.limit,
      ),
    ),
});

const findChildrenOf = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    limit: Schema.Number,
  }),
  Result: ChildRowSchema,
  execute: (request) =>
    statement((sql) =>
      selectChildren(
        sql,
        [
          sql`child.user_id = ${request.userId}`,
          sql`child.parent_conversation_id = ${request.parentConversationId}`,
          standingChild(sql),
        ],
        request.limit,
      ),
    ),
});

const findChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: ChildRowSchema,
  execute: (request) =>
    statement((sql) =>
      selectChildren(
        sql,
        [
          sql`child.user_id = ${request.userId}`,
          sql`child.id = ${request.childId}`,
          standingChild(sql),
        ],
        1,
      ),
    ),
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
const CHILD_CHANGED_AT_SQL =
  "greatest(child.created_at, coalesce(first_line.created_at, child.created_at), " +
  "coalesce(child.deleted_at, child.created_at), " +
  "coalesce(child.completion_delivered_at, child.created_at), " +
  "coalesce(latest.queued_at, child.created_at), coalesce(latest.started_at, child.created_at), " +
  "coalesce(latest.settled_at, child.created_at))";

const childChangedAt = (sql: SqlClient.SqlClient) => sql.literal(CHILD_CHANGED_AT_SQL);

// Rendered as the turn cursor's instant is: the UTC wall clock with the zone
// spelled here, so the text is a property of the query rather than of the
// connection's TimeZone.
const CHILD_CHANGED_AT_TEXT_SQL = `((${CHILD_CHANGED_AT_SQL}) at time zone 'UTC')::text || '+00'`;
const childChangedAtText = (sql: SqlClient.SqlClient) => sql.literal(CHILD_CHANGED_AT_TEXT_SQL);

const findChildrenHead = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, changedAt: Schema.String }).pipe(
    Schema.encodeKeys({ changedAt: "changed_at" }),
  ),
  execute: (request) =>
    statement(
      (sql) => sql`
        select child.id, ${childChangedAtText(sql)} as changed_at
        ${childrenFrom(sql, [sql`child.user_id = ${request.userId}`])}
        order by ${childChangedAt(sql)} desc, child.id desc
        limit 1
      `,
    ),
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

/** Postgres reserves the word `user`, so the identity table's name is quoted wherever it is written by hand. */
const lockUser = (userId: string) =>
  statement((sql) => sql`select id from "user" where id = ${userId} for update`);

/**
 * The insert selects from the parent's row, so a parent that does not stand
 * for the account — cleared, another account's, or no row at all — or a
 * spawning message that is not the parent's own inserts nothing, and the
 * delegation learns so from the empty answer rather than from a child
 * hanging under a conversation its account cannot read.
 */
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
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into conversations (
          user_id, kind, parent_conversation_id, spawned_by_message_id, label,
          expects_completion, created_at, last_activity_at
        )
        select parent.user_id, ${CONVERSATION_KIND.CHILD}, parent.id, ${write.spawnedByMessageId},
               ${write.label}, ${write.expectsCompletion}, ${write.now}, ${write.now}
        from conversations parent
        where parent.id = ${write.parentConversationId}
          and parent.user_id = ${write.userId}
          and parent.deleted_at is null
          and exists (
            select 1 from messages
            where messages.id = ${write.spawnedByMessageId}
              and messages.conversation_id = parent.id
              and messages.user_id = parent.user_id
          )
        returning id
      `,
    ),
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
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
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
    statement(
      (sql) => sql`
        update conversations
        set deleted_at = ${request.now}
        where id = ${request.childId}
          and user_id = ${request.userId}
          and kind = ${CONVERSATION_KIND.CHILD}
          and deleted_at is null
          and runtime_session_id is null
        returning id
      `,
    ),
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
    statement(
      (sql) => sql`
        select id
        from messages
        where messages.conversation_id = ${request.conversationId}
          and messages.user_id = ${request.userId}
          and (messages.client_id = ${request.turnId} or messages.turn_id = ${request.turnId}::uuid)
        order by (messages.client_id = ${request.turnId}) desc, messages.seq desc
        limit 1
      `,
    ),
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

const ParentLockRowSchema = Schema.Struct({ parentConversationId: Schema.String }).pipe(
  Schema.encodeKeys({ parentConversationId: "parent_conversation_id" }),
);

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
    statement(
      (sql) => sql`
        select parent.id as parent_conversation_id
        from conversations child
        join conversations parent
          on parent.id = child.parent_conversation_id and parent.user_id = child.user_id
        where child.id = ${request.childId}
          and child.user_id = ${request.userId}
          and child.kind = ${CONVERSATION_KIND.CHILD}
          and child.deleted_at is null
          and parent.deleted_at is null
        for update of parent
      `,
    ),
});

const CompletionRowSchema = Schema.Struct({
  label: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.NullOr(Schema.Boolean),
  completionDeliveredAt: Schema.NullOr(InstantColumnSchema),
  turnId: Schema.NullOr(Schema.String),
  turnStatus: Schema.NullOr(Schema.Literals(Object.values(TURN_STATUS))),
  failure: Schema.NullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    expectsCompletion: "expects_completion",
    completionDeliveredAt: "completion_delivered_at",
    turnId: "turn_id",
    turnStatus: "turn_status",
  }),
);

/** The child's row and its latest turn, read under the parent's lock. */
const readCompletion = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: CompletionRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select child.label, child.expects_completion, child.completion_delivered_at,
               latest.id as turn_id, latest.status as turn_status, latest.failure
        from conversations child
        left join lateral (
          select id, status, failure
          from turns
          where turns.conversation_id = child.id and turns.user_id = child.user_id
          order by turns.queued_at desc, turns.id desc
          limit 1
        ) latest on true
        where child.id = ${request.childId} and child.user_id = ${request.userId}
      `,
    ),
});

const stampCompletion = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String, now: Schema.Date }),
  execute: (request) =>
    statement(
      (sql) => sql`
        update conversations
        set completion_delivered_at = ${request.now}
        where id = ${request.childId}
          and user_id = ${request.userId}
          and completion_delivered_at is null
      `,
    ),
});

/**
 * Claims a child's completion: in one transaction, under the parent's row
 * lock, reads the child and its latest turn, and where the run has ended
 * and no completion is stamped yet stamps `completion_delivered_at` and
 * answers what the words need; nothing where the child does not stand for
 * the account, is still running, or is stamped already. The stamp is the
 * mark that precedes the send, so two callers finding the same ended child
 * — the relay on the turn's end and the sweep a minute later — claim it
 * once between them, and what is guaranteed is at most one completion turn
 * per child, never that it arrived.
 */
export function claimChildCompletion(
  child: ConversationTarget,
  now: Date,
): Effect.Effect<ClaimedChildCompletion | undefined, ChildReadFailure, SqlClient.SqlClient> {
  const request = { userId: child.userId, childId: child.conversationId };
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
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
          parent: { userId: child.userId, conversationId: locked.value.parentConversationId },
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
}).pipe(Schema.encodeKeys({ userId: "user_id" }));

const findUndeliveredChildren = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: UndeliveredChildRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select child.id, child.user_id
        from conversations child
        join conversations parent
          on parent.id = child.parent_conversation_id and parent.user_id = child.user_id
        join lateral (
          select status, settled_at
          from turns
          where turns.conversation_id = child.id and turns.user_id = child.user_id
          order by turns.queued_at desc, turns.id desc
          limit 1
        ) latest on true
        where ${sql.and([
          sql`child.user_id = ${request.userId}`,
          sql`child.kind = ${CONVERSATION_KIND.CHILD}`,
          sql`child.deleted_at is null`,
          sql`parent.deleted_at is null`,
          sql`child.completion_delivered_at is null`,
          sql`latest.status in ${sql.in([...TERMINAL_TURN_STATUS])}`,
        ])}
        order by latest.settled_at asc, child.created_at asc, child.id asc
        limit ${request.limit}
      `,
    ),
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
