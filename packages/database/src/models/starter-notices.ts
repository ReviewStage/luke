/**
 * starter-notices.ts -- the endings a coding agent's starter is due to hear of, read for the sweep that tells it.
 *
 * An agent another coding agent started (`coding_agent.started_by_agent_id`)
 * reports back to its starter by message on its own; one whose run ends
 * before it can would leave its starter waiting on a message that never
 * comes. So each ending within the window is due a line to the starter: a
 * turn that failed, abandoned among them, a turn stopped by anyone but an
 * agent's `stop_agent`, whose caller knows it stopped it, and the agent
 * archived by anyone but its starter. A completed turn is due nothing.
 *
 * Each is keyed by the turn it ended, or by the agent for its archive, and
 * a line already standing under that key in the starter's conversation is
 * not due again, so each ending is told once whatever the sweeps between.
 * No ending is due a starter archived, one whose own newest turn failed, or
 * a member's operator, which hears of its member's agents through its own
 * notices (`operator-notices.ts`), so no ending wakes a starter that cannot
 * answer it or is told another way.
 */

import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { TURN_STATUS } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { messages, turns } from "../schemas/storage.js";
import { agentAutomationNameSql } from "./agent-name.js";

/** How a started agent's run ended without its finishing. */
export const STARTER_NOTICE_ENDING = {
  /** Its turn failed, abandoned or its session lost among the reasons. */
  FAILED: "failed",
  /** Its turn was stopped by the developer, or ended by Luke after a Stop it never confirmed. */
  STOPPED: "stopped",
  /** It was archived by anyone but its starter. */
  ARCHIVED: "archived",
} as const;

type StarterNoticeEnding =
  (typeof STARTER_NOTICE_ENDING)[keyof typeof STARTER_NOTICE_ENDING];

const DueNoticeSchema = Schema.Struct({
  /** The key the line goes under: the ended turn's id, or the archived agent's own. */
  key: Schema.String,
  ending: Schema.Literals(Object.values(STARTER_NOTICE_ENDING)),
  /** The failed turn's failure word; null for any other ending. */
  failure: Schema.NullOr(Schema.String),
  at: Schema.Date,
  userId: Schema.String,
  organizationId: Schema.String,
  starterId: Schema.String,
  starterConversationId: Schema.String,
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  agentKind: Schema.Literals(Object.values(CODING_AGENT_KIND)),
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  agentAutomationName: Schema.NullOr(Schema.String),
});

/** One ending due a line to the agent's starter, with the names the line says the agent by. */
export type DueStarterNotice = typeof DueNoticeSchema.Type;

/** The agent that started the one whose run ended, as the read joins it apart from that agent. */
const starter = alias(codingAgent, "starter");

/** A turn of the starter's own, as its newest is read apart from the ended one. */
const STARTER_TURN = "starter_turn";
const starterTurn = alias(turns, STARTER_TURN);

const Window = Schema.Struct({ since: Schema.Date, until: Schema.Date });

/** The columns both reads answer of the agent and its starter. */
const AGENT_COLUMNS = {
  userId: codingAgent.userId,
  organizationId: codingAgent.organizationId,
  starterId: starter.id,
  starterConversationId: starter.conversationId,
  agentId: codingAgent.id,
  taskId: codingAgent.taskId,
  agentKind: codingAgent.kind,
  agentTitle: codingAgent.title,
  agentModel: codingAgent.model,
  agentAutomationName: agentAutomationNameSql(codingAgent),
};

/** A starter that can answer: a coder standing, whose own newest turn did not fail. */
function answeringStarter() {
  const newest = sql`(select ${starterTurn.status} from ${turns} as ${sql.identifier(STARTER_TURN)}
    where ${starterTurn.conversationId} = ${starter.conversationId}
    order by ${starterTurn.queuedAt} desc, ${starterTurn.id} desc limit 1)`;
  return and(
    isNull(starter.archivedAt),
    eq(starter.kind, CODING_AGENT_KIND.CODER),
    sql`${newest} is distinct from ${TURN_STATUS.FAILED}`,
  );
}

const findEndedTurns = SqlSchema.findAll({
  Request: Window,
  Result: DueNoticeSchema,
  execute: ({ since, until }) =>
    Database.use((db) =>
      db
        .select({
          key: turns.id,
          ending: sql<StarterNoticeEnding>`case when ${turns.status} = ${TURN_STATUS.FAILED}
            then ${STARTER_NOTICE_ENDING.FAILED}::text else ${STARTER_NOTICE_ENDING.STOPPED}::text end`,
          failure: turns.failure,
          at: turns.settledAt,
          ...AGENT_COLUMNS,
        })
        .from(codingAgent)
        .innerJoin(starter, eq(starter.id, codingAgent.startedByAgentId))
        .innerJoin(turns, eq(turns.conversationId, codingAgent.conversationId))
        .where(
          and(
            isNotNull(codingAgent.startedByAgentId),
            gte(turns.settledAt, since),
            lte(turns.settledAt, until),
            or(
              eq(turns.status, TURN_STATUS.FAILED),
              and(eq(turns.status, TURN_STATUS.CANCELLED), isNull(turns.cancelRequestKey)),
            ),
            answeringStarter(),
          ),
        )
        .orderBy(asc(turns.settledAt), asc(turns.id)),
    ),
});

const findArchives = SqlSchema.findAll({
  Request: Window,
  Result: DueNoticeSchema,
  execute: ({ since, until }) =>
    Database.use((db) =>
      db
        .select({
          key: codingAgent.id,
          ending: sql<StarterNoticeEnding>`${STARTER_NOTICE_ENDING.ARCHIVED}::text`,
          failure: sql<string | null>`null::text`,
          at: codingAgent.archivedAt,
          ...AGENT_COLUMNS,
        })
        .from(codingAgent)
        .innerJoin(starter, eq(starter.id, codingAgent.startedByAgentId))
        .where(
          and(
            isNotNull(codingAgent.startedByAgentId),
            gte(codingAgent.archivedAt, since),
            lte(codingAgent.archivedAt, until),
            sql`(${codingAgent.archivedBy} ->> 'agentId') is distinct from ${starter.id}::text`,
            answeringStarter(),
          ),
        )
        .orderBy(asc(codingAgent.archivedAt), asc(codingAgent.id)),
    ),
});

const findToldLines = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationIds: Schema.Array(Schema.String),
    lineIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  execute: ({ conversationIds, lineIds }) =>
    Database.use((db) =>
      db
        .select({ conversationId: messages.conversationId, clientId: messages.clientId })
        .from(messages)
        .where(
          and(
            inArray(messages.conversationId, [...conversationIds]),
            inArray(messages.clientId, [...lineIds]),
          ),
        ),
    ),
});

/**
 * The endings between `since` and `until` whose starter has not been told
 * of them, oldest first and at most `limit`, across every account: each
 * starter is the account's own agent (`createCodingAgent`), so its line goes
 * to the account the ended agent is of. Note that the endings already told
 * are left out before the limit, because a window holding more of them than
 * the limit would otherwise starve the newer ones.
 */
export function dueStarterNotices(
  since: Date,
  until: Date,
  limit: number,
): Effect.Effect<readonly DueStarterNotice[], QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const ended = yield* findEndedTurns({ since, until });
    const archived = yield* findArchives({ since, until });
    const endings = [...ended, ...archived].sort((a, b) => a.at.getTime() - b.at.getTime());
    if (endings.length === 0) return [];
    const told = yield* findToldLines({
      conversationIds: [...new Set(endings.map((each) => each.starterConversationId))],
      lineIds: endings.map((each) => sentLineId(each.key)),
    });
    const toldIn = new Map<string, Set<string>>();
    for (const { conversationId, clientId } of told) {
      toldIn.set(conversationId, (toldIn.get(conversationId) ?? new Set()).add(clientId));
    }
    return endings
      .filter((each) => !toldIn.get(each.starterConversationId)?.has(sentLineId(each.key)))
      .slice(0, limit);
  });
}
