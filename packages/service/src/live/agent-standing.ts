import { queryBuilder } from "@luke/database/core/query";
import { newestAwaitingLineAt } from "@luke/database/models/message-reads";
import { messages, turns } from "@luke/database/schemas/storage";
import { UI_PART_TYPE } from "@luke/features/brain";
import {
  CODING_AGENT_FAILURE,
  CODING_AGENT_KIND,
  OPERATOR_QUIET_REPLY,
} from "@luke/features/coding-agent-wire";
import { and, desc, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
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

/** What a reply may stand between, which is no word of it. */
const REPLY_SPACE = " \t\r\n";

/** The text parts of a message's parts, as a JSON path picks them. */
const TEXT_PARTS_PATH = `$[*] ? (@.type == "${UI_PART_TYPE.TEXT}")`;

/**
 * Whether the agent is a member's operator whose newest turn's reply is its
 * quiet reply alone (`OPERATOR_QUIET_REPLY`), as a heartbeat that found
 * nothing answers: the turn's journal, the assistant row its id names as
 * its client id, holds one text part, its last, which spells exactly that.
 * A reply that says anything more, or only mentions it, is no quiet one.
 * Note that the turn's id is cast to text to meet the journal's client id,
 * so the read is the unique `(conversation_id, client_id)` index's point
 * lookup, and that the cast and every function here are immutable, as a
 * live statement must hold to.
 */
export function quietTurnOf(
  kind: SQLWrapper,
  conversationId: SQLWrapper,
  latest: LatestTurn,
): SQL<boolean> {
  const journal = queryBuilder
    .select({ one: sql`1` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.clientId, sql`${latest.id}::text`),
        sql`${messages.parts} -> -1 ->> 'type' = ${UI_PART_TYPE.TEXT}`,
        sql`btrim(${messages.parts} -> -1 ->> 'text', ${REPLY_SPACE}) = ${OPERATOR_QUIET_REPLY}`,
        sql`jsonb_array_length(jsonb_path_query_array(${messages.parts}, ${TEXT_PARTS_PATH}::jsonpath)) = 1`,
      ),
    );
  return sql<boolean>`(${kind} = ${CODING_AGENT_KIND.OPERATOR} and exists (${journal}))`;
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
