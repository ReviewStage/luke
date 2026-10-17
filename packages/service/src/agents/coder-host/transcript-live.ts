import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import type { ConversationTarget } from "@luke/database/models/writer";
import { codingAgent, codingAgentDelegation } from "@luke/database/schemas/coding-agent";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Option } from "effect";

/**
 * transcript-live.ts -- what a coding agent's transcript is read from, written for Neon Realtime, so a reader hears the moment a page past its cursor would say something new.
 *
 * A page of the transcript (`transcript.ts`) is assembled from many reads,
 * some priced against the model catalog, which lives outside Postgres, so
 * the page itself is not followed: these statements are the rows a held
 * read looks at for something new, and a reader that follows them reads the
 * page once they move rather than on a clock. Each moves where the held
 * read would wake: a message added to the conversation (`messages`) or
 * amended in place, which counts its journal revision up (`conversation`),
 * a turn opened, started, settled, or stopped (`turns`, counted by its
 * status, so a turn moving from one to another moves them), which is where the
 * status is read from and a line stops awaiting its turn, and a title
 * landing, the agent's own (`agent`) or a worker's, or a worker's
 * delegation being recorded (`workers`). Each reads only the account's own
 * rows, as the held read does. Nothing in them reads the clock: a status
 * that changes with time alone, such as an agent past its grace, is the
 * reader's to ask for at the end of its hold.
 */

/** The statements a transcript is followed by, each a part of the one read. */
export interface TranscriptLiveStatements {
  readonly messages: LiveStatement;
  readonly turns: LiveStatement;
  readonly conversation: LiveStatement;
  readonly agent: LiveStatement;
  readonly workers: LiveStatement;
}

/** A number Postgres holds as `bigint`, as a number rather than the text Realtime would carry. */
const asNumber = (value: SQL): SQL<number> => sql<number>`(${value})::float8`;

/** When a turn last changed: the latest of the stamps its opening, start, settling, and Stop write. */
const TURN_CHANGED = sql`greatest(
  ${turns.queuedAt},
  coalesce(${turns.startedAt}, ${turns.queuedAt}),
  coalesce(${turns.settledAt}, ${turns.queuedAt}),
  coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
)`;

/**
 * The statements the transcript of `target`'s conversation is followed by,
 * under the agent whose conversation is `parentConversationId`: its own,
 * where the two are the same, or one of its workers'. None where a statement
 * names a value Realtime cannot carry.
 */
export function transcriptLiveStatements(
  target: ConversationTarget,
  parentConversationId: string,
): Option.Option<TranscriptLiveStatements> {
  const { userId, conversationId } = target;
  const written = queryBuilder
    .select({
      rows: LIVE_COUNT.as("rows"),
      seq: asNumber(sql`coalesce(max(${messages.seq}), 0)`).as("seq"),
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.userId, userId)));
  const run = queryBuilder
    .select({
      ...liveSelection({ status: turns.status }),
      rows: LIVE_COUNT.as("rows"),
      stopped: sql<number>`count(${turns.cancelRequestedAt})::int`.as("stopped"),
      changedAt: liveLatest(TURN_CHANGED).as("changedAt"),
    })
    .from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.userId, userId)))
    .groupBy(turns.status);
  const conversation = queryBuilder
    .select({
      ...liveSelection({ title: conversations.title }),
      revision: asNumber(sql`${conversations.journalRevision}`).as("revision"),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
      ),
    );
  const agent = queryBuilder
    .select(liveSelection({ title: codingAgent.title }))
    .from(codingAgent)
    .where(
      and(eq(codingAgent.conversationId, parentConversationId), eq(codingAgent.userId, userId)),
    );
  const workers = queryBuilder
    .select(
      liveSelection({
        id: conversations.id,
        title: conversations.title,
        callId: codingAgentDelegation.callId,
      }),
    )
    .from(conversations)
    .leftJoin(
      codingAgentDelegation,
      eq(codingAgentDelegation.childConversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
      ),
    );
  return Option.all({
    messages: liveStatementOf(written),
    turns: liveStatementOf(run),
    conversation: liveStatementOf(conversation),
    agent: liveStatementOf(agent),
    workers: liveStatementOf(workers),
  });
}
