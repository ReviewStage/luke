/**
 * starter-notices.ts -- the endings a coding agent's starter is due to hear of, read for the sweep that tells it.
 *
 * An agent another coding agent started (`agent.started_by_agent_id`)
 * reports back to its starter by message on its own; one whose run ends
 * before it can would leave its starter waiting on a message that never
 * comes. So each ending within the window is due a line to the starter: a
 * turn that failed, abandoned among them, a turn stopped by anyone but the
 * starter itself (`turns.cancel_requested_by`), and the agent archived by
 * anyone but its starter. A completed turn is due nothing, and neither is a
 * turn its pilot tree's Running switched off stopped
 * (`turns.cancel_requested_for_running`): the whole tree stopped at once, and
 * the switch on again resumes it, so no pilot is woken to hear of it.
 *
 * Each is keyed by the turn it ended, or by the agent for its archive, and
 * a line already standing under that key in the starter's conversation is
 * not due again, so each ending is told once whatever the sweeps between;
 * a line eve refused, left withdrawn, does not stand, so it is due again.
 * No ending is due a starter archived, one whose own newest turn failed, or
 * a member's operator, which hears of its member's agents through its own
 * notices (`operator-notices.ts`), so no ending wakes a starter that cannot
 * answer it or is told another way. An ending whose starter works on a child
 * task of a pilot tree whose Running switch is off (`readTreeStopped`) is
 * held: not due while the switch is off, and due again once it is on, for
 * as long as the window still holds it.
 */

import { AGENT_KIND } from "@luke/features/agent-wire";
import { TURN_STATUS } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { messages, standingLine, turns } from "../schemas/storage.js";
import { agentAutomationNameSql } from "./agent-name.js";
import { readTreeStopped } from "./task-store.js";

/** How a started agent's run ended without its finishing. */
export const STARTER_NOTICE_ENDING = {
  /** Its turn failed, abandoned or its session lost among the reasons. */
  FAILED: "failed",
  /** Its turn was stopped by anyone but its starter: the developer, another agent, or Luke ending a Stop never confirmed. */
  STOPPED: "stopped",
  /** It was archived by anyone but its starter. */
  ARCHIVED: "archived",
} as const;

type StarterNoticeEnding = (typeof STARTER_NOTICE_ENDING)[keyof typeof STARTER_NOTICE_ENDING];

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
  /** The task the starter works on; null for one on none. */
  starterTaskId: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  agentKind: Schema.Literals(Object.values(AGENT_KIND)),
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  agentAutomationName: Schema.NullOr(Schema.String),
});

/** One ending due a line to the agent's starter, with the names the line says the agent by. */
export type DueStarterNotice = typeof DueNoticeSchema.Type;

/** The agent that started the one whose run ended, as the read joins it apart from that agent. */
const starter = alias(agentTable, "starter");

/** A turn of the starter's own, as its newest is read apart from the ended one. */
const STARTER_TURN = "starter_turn";
const starterTurn = alias(turns, STARTER_TURN);

const Window = Schema.Struct({ since: Schema.Date, until: Schema.Date });

/** The columns both reads answer of the agent and its starter. */
const AGENT_COLUMNS = {
  userId: agentTable.userId,
  organizationId: agentTable.organizationId,
  starterId: starter.id,
  starterConversationId: starter.conversationId,
  starterTaskId: starter.taskId,
  agentId: agentTable.id,
  taskId: agentTable.taskId,
  agentKind: agentTable.kind,
  agentTitle: agentTable.title,
  agentModel: agentTable.model,
  agentAutomationName: agentAutomationNameSql(agentTable),
};

/** A starter that can answer: a coder or a pilot standing, whose own newest turn did not fail. */
function answeringStarter() {
  const newest = sql`(select ${starterTurn.status} from ${turns} as ${sql.identifier(STARTER_TURN)}
    where ${starterTurn.conversationId} = ${starter.conversationId}
    order by ${starterTurn.queuedAt} desc, ${starterTurn.id} desc limit 1)`;
  return and(
    isNull(starter.archivedAt),
    ne(starter.kind, AGENT_KIND.OPERATOR),
    sql`${newest} is distinct from ${TURN_STATUS.FAILED}`,
  );
}

/**
 * A Stop the starter did not make, and not its tree's Running switched
 * off: one no agent made, the developer's or Luke's, or one another agent
 * made. Note that a Stop under a tool call's key that names no agent is left
 * out, because only a Stop from before `cancel_requested_by` was written
 * stands so, and its caller, which may be the starter, is unknown.
 */
function stoppedByAnother() {
  return and(
    eq(turns.cancelRequestedForRunning, false),
    or(
      and(isNull(turns.cancelRequestedBy), isNull(turns.cancelRequestKey)),
      and(isNotNull(turns.cancelRequestedBy), ne(turns.cancelRequestedBy, starter.id)),
    ),
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
        .from(agentTable)
        .innerJoin(starter, eq(starter.id, agentTable.startedByAgentId))
        .innerJoin(turns, eq(turns.conversationId, agentTable.conversationId))
        .where(
          and(
            isNotNull(agentTable.startedByAgentId),
            gte(turns.settledAt, since),
            lte(turns.settledAt, until),
            or(
              eq(turns.status, TURN_STATUS.FAILED),
              and(eq(turns.status, TURN_STATUS.CANCELLED), stoppedByAnother()),
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
          key: agentTable.id,
          ending: sql<StarterNoticeEnding>`${STARTER_NOTICE_ENDING.ARCHIVED}::text`,
          failure: sql<string | null>`null::text`,
          at: agentTable.archivedAt,
          ...AGENT_COLUMNS,
        })
        .from(agentTable)
        .innerJoin(starter, eq(starter.id, agentTable.startedByAgentId))
        .where(
          and(
            isNotNull(agentTable.startedByAgentId),
            gte(agentTable.archivedAt, since),
            lte(agentTable.archivedAt, until),
            sql`(${agentTable.archivedBy} ->> 'agentId') is distinct from ${starter.id}::text`,
            answeringStarter(),
          ),
        )
        .orderBy(asc(agentTable.archivedAt), asc(agentTable.id)),
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
            standingLine(messages),
          ),
        ),
    ),
});

/** The starters' tasks among the endings that are child tasks of a stopped pilot tree, each read once as its account. */
const stoppedStarterTasks = (endings: readonly DueStarterNotice[]) =>
  Effect.gen(function* () {
    const accountOf = new Map<string, string>();
    for (const { starterTaskId, userId } of endings) {
      if (starterTaskId !== null && !accountOf.has(starterTaskId)) {
        accountOf.set(starterTaskId, userId);
      }
    }
    const stopped = new Set<string>();
    for (const [taskId, userId] of accountOf) {
      if (yield* readTreeStopped(userId, taskId)) stopped.add(taskId);
    }
    return stopped;
  });

/**
 * The endings between `since` and `until` whose starter has not been told
 * of them, oldest first and at most `limit`, across every account: each
 * starter is the account's own agent (`createAgent`), so its line goes
 * to the account the ended agent is of. Note that the endings already told
 * are left out before the limit, because a window holding more of them than
 * the limit would otherwise starve the newer ones, and so are those held
 * while their starter's pilot tree is stopped, which would otherwise starve
 * every other workspace's.
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
    const untold = endings.filter(
      (each) => !toldIn.get(each.starterConversationId)?.has(sentLineId(each.key)),
    );
    const held = yield* stoppedStarterTasks(untold);
    return untold
      .filter((each) => each.starterTaskId === null || !held.has(each.starterTaskId))
      .slice(0, limit);
  });
}
