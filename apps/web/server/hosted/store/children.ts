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
 * its turns by the instant it was queued, the id breaking a tie.
 */
const selectChildren = (sql: SqlClient.SqlClient, conditions: readonly Fragment[], limit: number) =>
  sql`
    select child.id, child.parent_conversation_id, parent.kind as parent_kind, child.label,
           child.created_at, child.completion_delivered_at,
           latest.status as turn_status, latest.started_at, latest.settled_at, latest.failure
    from conversations child
    join conversations parent on parent.id = child.parent_conversation_id
    left join lateral (
      select status, started_at, settled_at, failure
      from turns
      where turns.conversation_id = child.id
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

/** One of the account's standing children by id, or none. */
export function readChild(
  userId: string,
  childId: string,
): Effect.Effect<Option.Option<ChildRecord>, ChildReadFailure, SqlClient.SqlClient> {
  return Effect.map(findChild({ userId, childId }), Option.map(toChildRecord));
}
