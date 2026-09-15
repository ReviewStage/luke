import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { Fragment } from "effect/unstable/sql/Statement";
import { TURN_STATUS, type TurnStatus } from "../../core.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./database.js";

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

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

/** Where a child stands, derived from its latest turn: accepted before one runs, then the turn's own status. */
export const CHILD_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: TURN_STATUS.RUNNING,
  SETTLED: TURN_STATUS.SETTLED,
  CANCELLED: TURN_STATUS.CANCELLED,
  FAILED: TURN_STATUS.FAILED,
} as const;

type ChildStatus = (typeof CHILD_STATUS)[keyof typeof CHILD_STATUS];

export interface ChildRecord {
  readonly id: string;
  readonly parentConversationId: string;
  readonly parentKind: ConversationKind;
  /** The name the delegation gave the child, or none. */
  readonly label: string | null;
  readonly createdAt: Date;
  /** When the child's completion reached its parent as a turn of the parent's own; unset until it has. */
  readonly completionDeliveredAt: Date | null;
  readonly status: ChildStatus;
  /** The latest turn's stamps, each unset until the turn reached it, and all unset before a turn stands. */
  readonly startedAt: Date | null;
  readonly settledAt: Date | null;
  readonly failure: string | null;
}

type ChildReadFailure = SqlError | Schema.SchemaError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** The child's row joined to its parent's kind and its latest turn, where one stands. */
const ChildRowSchema = Schema.Struct({
  id: Schema.String,
  parentConversationId: Schema.String,
  parentKind: Schema.Literals([
    CONVERSATION_KIND.MAIN,
    CONVERSATION_KIND.OBSERVED,
    CONVERSATION_KIND.CHILD,
    CONVERSATION_KIND.THREAD,
  ]),
  label: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  completionDeliveredAt: Schema.NullOr(InstantColumnSchema),
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
}).pipe(
  Schema.encodeKeys({
    parentConversationId: "parent_conversation_id",
    parentKind: "parent_kind",
    createdAt: "created_at",
    completionDeliveredAt: "completion_delivered_at",
    turnStatus: "turn_status",
    startedAt: "started_at",
    settledAt: "settled_at",
  }),
);

type ChildRow = typeof ChildRowSchema.Type;

/**
 * The one select both reads share: the account's standing children under
 * `conditions`, newest first, each joined to its parent (a child without
 * one is a row no delegation wrote, and is not a child) and to the latest of
 * its turns by the instant it was queued, the id breaking a tie. Both joins
 * hold to the child's own account, so a parent or a turn written under
 * another lends the child nothing, whatever id it names.
 */
const selectChildren = (sql: SqlClient.SqlClient, conditions: readonly Fragment[], limit: number) =>
  sql`
    select child.id, child.parent_conversation_id, parent.kind as parent_kind, child.label,
           child.created_at, child.completion_delivered_at,
           latest.status as turn_status, latest.started_at, latest.settled_at, latest.failure
    from conversations child
    join conversations parent
      on parent.id = child.parent_conversation_id and parent.user_id = child.user_id
    left join lateral (
      select status, started_at, settled_at, failure
      from turns
      where turns.conversation_id = child.id and turns.user_id = child.user_id
      order by turns.queued_at desc, turns.id desc
      limit 1
    ) latest on true
    where ${sql.and([
      sql`child.kind = ${CONVERSATION_KIND.CHILD}`,
      sql`child.deleted_at is null`,
      ...conditions,
    ])}
    order by child.created_at desc, child.id desc
    limit ${limit}
  `;

const findChildren = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: ChildRowSchema,
  execute: (request) =>
    statement((sql) =>
      selectChildren(sql, [sql`child.user_id = ${request.userId}`], request.limit),
    ),
});

const findChild = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, childId: Schema.String }),
  Result: ChildRowSchema,
  execute: (request) =>
    statement((sql) =>
      selectChildren(
        sql,
        [sql`child.user_id = ${request.userId}`, sql`child.id = ${request.childId}`],
        1,
      ),
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
