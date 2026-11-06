import { queryBuilder } from "@repo/database/core/query";
import { lastSettledTurnAt, newestAwaitingLineAt } from "@repo/database/models/message-reads";
import { turns } from "@repo/database/schemas/storage";
import { AGENT_FAILURE } from "@repo/features/agent-wire";
import { desc, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { FAILURE_WORDS } from "../agents/coder-host/status.js";
import { TURN_FAILURE, TURN_STATUS } from "../core.js";

export function latestTurnOf(conversationId: SQLWrapper, name: string) {
  return queryBuilder
    .select({
      id: turns.id,
      status: turns.status,
      failure: turns.failure,
      failureDetail: turns.failureDetail,
      cancelRequestedAt: turns.cancelRequestedAt,
      queuedAt: turns.queuedAt,
      startedAt: turns.startedAt,
      settledAt: turns.settledAt,
    })
    .from(turns)
    .where(eq(turns.conversationId, sql`${conversationId}`))
    .orderBy(desc(turns.queuedAt), desc(turns.id))
    .limit(1)
    .as(name);
}

type LatestTurn = ReturnType<typeof latestTurnOf>;

export function awaitingLineAtIn(conversationId: SQLWrapper): SQL<Date | null> {
  return newestAwaitingLineAt(sql`${conversationId}`);
}

export function lastSettledAtIn(conversationId: SQLWrapper): SQL<Date | null> {
  return lastSettledTurnAt(sql`${conversationId}`);
}

export function sessionEndedOf(latest: LatestTurn): SQL<boolean | null> {
  return sql<boolean | null>`${latest.failure} = ${TURN_FAILURE.SESSION_ENDED}`;
}

export function failureWordOf(latest: LatestTurn): SQL<string | null> {
  const named = FAILURE_WORDS.map(
    ([word, refusals]) =>
      sql`when ${sql.join(
        refusals.map(
          (refusal) => sql`strpos(coalesce(${latest.failureDetail}, ''), ${refusal}) > 0`,
        ),
        sql` or `,
      )} then ${word}`,
  );
  return sql<string | null>`case
    when ${latest.id} is null then ${AGENT_FAILURE.NOT_STARTED}
    when ${latest.status} <> ${TURN_STATUS.FAILED} then null
    when ${latest.failure} = ${TURN_FAILURE.ABANDONED} then ${AGENT_FAILURE.ABANDONED}
    when ${latest.failure} = ${TURN_FAILURE.SESSION_ENDED} then ${AGENT_FAILURE.SESSION_ENDED}
    when ${latest.failure} is distinct from ${TURN_FAILURE.MODEL} then ${AGENT_FAILURE.OTHER}
    ${sql.join(named, sql` `)}
    else ${AGENT_FAILURE.MODEL}
  end`;
}
