import { Effect, type Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { CHILD_STATUS, type ChildStatus, TURN_STATUS, type TurnStatus } from "../../core.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./database.js";

/**
 * The account's agents: the coding-agent sessions Luke follows, one
 * `observed` conversation each, opened by the scheduled tick's opener and
 * listed here once the brain has had a turn about the session, since a row
 * with no turn is a session nothing has been said of yet. Where an agent
 * stands is where its latest turn leaves it, on the children's terms: a
 * queued turn is accepted, a running turn is running, and otherwise the turn's
 * own settlement. The service joins no roster here: a device names the row
 * from its own roster by the session identity, as the thread's chips do.
 */

type AgentReadFailure = SqlError | Schema.SchemaError;

export interface AgentRecord {
  readonly id: string;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly createdAt: Date;
  readonly status: ChildStatus;
  /** The latest turn's stamps, each unset until the turn reached it. */
  readonly startedAt: Date | null;
  readonly settledAt: Date | null;
  readonly failure: string | null;
}

/**
 * Where the account's agents stand as one instant: the latest stamp any
 * agent's latest turn reached, a stamp on the row included, as Postgres
 * renders it to the microsecond, and that agent's id to break a tie. Text on
 * the turn cursor's own terms, as the children head is.
 */
export interface AgentsHeadPosition {
  readonly changedAt: string;
  readonly id: string;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const AgentRowSchema = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
  createdAt: InstantColumnSchema,
  turnStatus: Schema.Literals(Object.values(TURN_STATUS)),
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    providerId: "provider_id",
    providerSessionId: "provider_session_id",
    createdAt: "created_at",
    turnStatus: "turn_status",
    startedAt: "started_at",
    settledAt: "settled_at",
  }),
);

type AgentRow = typeof AgentRowSchema.Type;

/**
 * The rows both reads select from: the account's observed conversations,
 * each joined to the latest of its turns by the instant it was queued, the
 * id breaking a tie, so a conversation with no turn is not among them. The
 * join holds to the agent's own account, so a turn written under another
 * lends it nothing. Whether a stamped row is among them is the caller's
 * condition: the list reads what stands, the head counts the stamping as
 * the change it is.
 */
const agentsFrom = (sql: SqlClient.SqlClient, userId: string, standing: boolean) =>
  sql`
    from conversations agent
    join lateral (
      select status, queued_at, started_at, settled_at, failure
      from turns
      where turns.conversation_id = agent.id and turns.user_id = agent.user_id
      order by turns.queued_at desc, turns.id desc
      limit 1
    ) latest on true
    where ${sql.and([
      sql`agent.user_id = ${userId}`,
      sql`agent.kind = ${CONVERSATION_KIND.OBSERVED}`,
      ...(standing ? [sql`agent.deleted_at is null`] : []),
    ])}
  `;

const findAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: AgentRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select agent.id, agent.provider_id, agent.provider_session_id, agent.created_at,
               latest.status as turn_status, latest.started_at, latest.settled_at, latest.failure
        ${agentsFrom(sql, request.userId, true)}
        order by latest.queued_at desc, agent.id desc
        limit ${request.limit}
      `,
    ),
});

/**
 * The instant an agent last changed: its latest turn queued, started, or
 * settled, or its row stamped, whichever is latest. Each stamp not reached
 * falls back to the queuing, so the expression is never null.
 */
const AGENT_CHANGED_AT_SQL =
  "greatest(latest.queued_at, coalesce(latest.started_at, latest.queued_at), " +
  "coalesce(latest.settled_at, latest.queued_at), coalesce(agent.deleted_at, latest.queued_at))";

const agentChangedAt = (sql: SqlClient.SqlClient) => sql.literal(AGENT_CHANGED_AT_SQL);

// Rendered as the turn cursor's instant is: the UTC wall clock with the zone
// spelled here, so the text is a property of the query rather than of the
// connection's TimeZone.
const AGENT_CHANGED_AT_TEXT_SQL = `((${AGENT_CHANGED_AT_SQL}) at time zone 'UTC')::text || '+00'`;
const agentChangedAtText = (sql: SqlClient.SqlClient) => sql.literal(AGENT_CHANGED_AT_TEXT_SQL);

const findAgentsHead = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, changedAt: Schema.String }).pipe(
    Schema.encodeKeys({ changedAt: "changed_at" }),
  ),
  execute: (request) =>
    statement(
      (sql) => sql`
        select agent.id, ${agentChangedAtText(sql)} as changed_at
        ${agentsFrom(sql, request.userId, false)}
        order by ${agentChangedAt(sql)} desc, agent.id desc
        limit 1
      `,
    ),
});

function agentStatus(turnStatus: TurnStatus): ChildStatus {
  return turnStatus === TURN_STATUS.QUEUED ? CHILD_STATUS.ACCEPTED : turnStatus;
}

function toAgentRecord({ turnStatus, ...row }: AgentRow): AgentRecord {
  return { ...row, status: agentStatus(turnStatus) };
}

/** The account's standing agents that hold a turn, the one with the latest turn first and at most `limit` of them. */
export function listAgents(
  userId: string,
  limit: number,
): Effect.Effect<readonly AgentRecord[], AgentReadFailure, SqlClient.SqlClient> {
  return Effect.map(findAgents({ userId, limit }), (rows) => rows.map(toAgentRecord));
}

/** Where the account's agents stand: the agent that changed last and the instant it did, a stamped row counted; none while no agent has a turn. */
export function agentsHead(
  userId: string,
): Effect.Effect<Option.Option<AgentsHeadPosition>, AgentReadFailure, SqlClient.SqlClient> {
  return findAgentsHead({ userId });
}
