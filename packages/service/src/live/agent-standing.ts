import { queryBuilder } from "@luke/database/core/query";
import { newestAwaitingLineAt } from "@luke/database/models/message-reads";
import { turns } from "@luke/database/schemas/storage";
import { CODING_AGENT_FAILURE } from "@luke/features/coding-agent-wire";
import { desc, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { FAILURE_WORDS } from "../agents/coder-host/status.js";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../core.js";

/**
 * agent-standing.ts -- what a coding agent's status is read from, written for Neon Realtime: its newest turn, when the newest line of the developer's awaiting its turn was written, and why its newest turn failed.
 *
 * Each is the same rule the held reads read an agent by
 * (`message-reads.ts`'s `findLatestTurns` and `awaitingLinesOfReached`, and
 * `coder-host/status.ts`'s `codingAgentFailureOf`), as a fragment a live
 * statement joins or selects beside the agent's own row. Nothing here reads
 * the clock: the status itself, which turns on it, is the reader's to read
 * (`@luke/features/coding-agent-status`). The failure is named here, in
 * the wire's own word, so the turn's detail never leaves the database.
 */

/** The newest turn of the conversation named, by the order turns were queued, as a lateral subquery under `name`. */
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

/** The latest turn as `latestTurnOf` names it. */
type LatestTurn = ReturnType<typeof latestTurnOf>;

/** When the newest line of the developer's awaiting its turn in the conversation named was written, or null, as `awaitingLinesOfReached` reads it. */
export function awaitingLineAtIn(conversationId: SQLWrapper): SQL<Date | null> {
  return newestAwaitingLineAt(sql`${conversationId}`);
}

/** Whether the newest turn failed because its session ended for good, which leaves every line awaiting nothing; null where no turn stands. */
export function sessionEndedOf(latest: LatestTurn): SQL<boolean | null> {
  return sql<boolean | null>`${latest.failure} = ${BRAIN_REQUEST_FAILURE.SESSION_ENDED}`;
}

/**
 * Why the agent would read as failed, in the wire's word, as
 * `codingAgentFailureOf` names it: a session that never started where no
 * turn stands, the sweep's word or the host's refusal a failed turn
 * carries, and none for a turn that did not fail. The reader says it only
 * where the status it reads is failed.
 */
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
    when ${latest.id} is null then ${CODING_AGENT_FAILURE.NOT_STARTED}
    when ${latest.status} <> ${TURN_STATUS.FAILED} then null
    when ${latest.failure} = ${BRAIN_REQUEST_FAILURE.ABANDONED} then ${CODING_AGENT_FAILURE.ABANDONED}
    when ${latest.failure} = ${BRAIN_REQUEST_FAILURE.SESSION_ENDED} then ${CODING_AGENT_FAILURE.SESSION_ENDED}
    when ${latest.failure} is distinct from ${BRAIN_REQUEST_FAILURE.MODEL} then ${CODING_AGENT_FAILURE.OTHER}
    ${sql.join(named, sql` `)}
    else ${CODING_AGENT_FAILURE.MODEL}
  end`;
}
