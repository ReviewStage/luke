import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { CHILD_STATUS, type ChildStatus, TURN_STATUS, type TurnStatus } from "../../core.js";
import { db } from "../../db/query.js";
import { conversations, turns } from "../../db/storage-schema.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./database.js";

/**
 * The account's agents: the coding-agent sessions Luke follows, one
 * `observed` conversation each, opened by the scheduled tick's opener and
 * listed here once the brain has had a turn about the session, since a row
 * with no turn is a session nothing has been said of yet. Where an agent
 * stands is where its latest turn leaves it, on the children's terms: a
 * queued turn is accepted, a running turn is running, and otherwise the turn's
 * own settlement. The service joins no roster here: the row carries the
 * session's title and workspace name as the opener last saw them, and a
 * device names the row from its own roster by the session identity while
 * that roster still lists the session, as the thread's chips do.
 */

type AgentReadFailure = SqlError | Schema.SchemaError;

export interface AgentRecord {
  readonly id: string;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly createdAt: Date;
  /** The session's title and workspace name as the roster last showed them to the opener; unset for a row opened before they were kept. */
  readonly title: string | null;
  readonly workspace: string | null;
  readonly status: ChildStatus;
  /** The latest turn's queuing, and its other stamps, each unset until the turn reached it. */
  readonly queuedAt: Date;
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

const AgentRowSchema = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
  createdAt: InstantColumnSchema,
  title: Schema.NullOr(Schema.String),
  workspace: Schema.NullOr(Schema.String),
  turnStatus: Schema.Literals(Object.values(TURN_STATUS)),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
});

type AgentRow = typeof AgentRowSchema.Type;

/**
 * The latest of an agent's turns by the instant it was queued, the id
 * breaking a tie: the lateral both reads join to, which is what leaves a
 * conversation with no turn out of them. The correlation is the agent's own
 * row and account, so a turn written under another account lends it nothing.
 */
const latestTurn = db
  .select({
    status: turns.status,
    queuedAt: turns.queuedAt,
    startedAt: turns.startedAt,
    settledAt: turns.settledAt,
    failure: turns.failure,
  })
  .from(turns)
  .where(and(eq(turns.conversationId, conversations.id), eq(turns.userId, conversations.userId)))
  .orderBy(desc(turns.queuedAt), desc(turns.id))
  .limit(1)
  .as("latest");

/**
 * The agents both reads select from: the account's observed conversations,
 * and not a row without its session identity, since the wire carries both.
 * Whether a stamped row is among them is the caller's condition: the list
 * reads what stands, the head counts the stamping as the change it is.
 */
const observedAgents = (userId: string, standing: boolean) =>
  and(
    eq(conversations.userId, userId),
    eq(conversations.kind, CONVERSATION_KIND.OBSERVED),
    // An observed row without its session is a row no observation wrote, and it is no agent a device could name.
    isNotNull(conversations.providerId),
    isNotNull(conversations.providerSessionId),
    standing ? isNull(conversations.deletedAt) : undefined,
  );

/**
 * The instant an agent last changed: its latest turn queued, started, or
 * settled, or its row stamped, whichever is latest. Each stamp not reached
 * falls back to the queuing, so the expression is never null. There is no
 * builder spelling for `greatest`, so it is a fragment.
 */
const AGENT_CHANGED_AT = sql`greatest(${latestTurn.queuedAt}, coalesce(${latestTurn.startedAt}, ${latestTurn.queuedAt}), coalesce(${latestTurn.settledAt}, ${latestTurn.queuedAt}), coalesce(${conversations.deletedAt}, ${latestTurn.queuedAt}))`;

// Rendered as the turn cursor's instant is: the UTC wall clock with the zone
// spelled here, so the text is a property of the query rather than of the
// connection's TimeZone.
const AGENT_CHANGED_AT_TEXT = sql<string>`((${AGENT_CHANGED_AT}) at time zone 'UTC')::text || '+00'`;

const findAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: AgentRowSchema,
  execute: (request) =>
    db
      .select({
        id: conversations.id,
        providerId: conversations.providerId,
        providerSessionId: conversations.providerSessionId,
        createdAt: conversations.createdAt,
        title: conversations.title,
        workspace: conversations.workspace,
        turnStatus: latestTurn.status,
        queuedAt: latestTurn.queuedAt,
        startedAt: latestTurn.startedAt,
        settledAt: latestTurn.settledAt,
        failure: latestTurn.failure,
      })
      .from(conversations)
      .innerJoinLateral(latestTurn, sql`true`)
      .where(observedAgents(request.userId, true))
      .orderBy(desc(AGENT_CHANGED_AT), desc(conversations.id))
      .limit(request.limit),
});

const findAgentsHead = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, changedAt: Schema.String }),
  execute: (request) =>
    db
      .select({ id: conversations.id, changedAt: AGENT_CHANGED_AT_TEXT })
      .from(conversations)
      .innerJoinLateral(latestTurn, sql`true`)
      .where(observedAgents(request.userId, false))
      .orderBy(desc(AGENT_CHANGED_AT), desc(conversations.id))
      .limit(1),
});

function agentStatus(turnStatus: TurnStatus): ChildStatus {
  return turnStatus === TURN_STATUS.QUEUED ? CHILD_STATUS.ACCEPTED : turnStatus;
}

function toAgentRecord({ turnStatus, ...row }: AgentRow): AgentRecord {
  return { ...row, status: agentStatus(turnStatus) };
}

/** The account's standing agents that hold a turn, the one that changed last first, on the head's own terms, and at most `limit` of them. */
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
