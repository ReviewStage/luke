import type { ToolSet } from "ai";
import type { Effect, Schema } from "effect";
import type { DatabaseServices, QueryError } from "../core/query.js";
import {
  type MessageListRead,
  readMessageByClientId,
  type SpokenAskRow,
  type StoredTurnRecord,
  spokenAskRowsOf,
  turnsNamed,
} from "./message-reads.js";
import { purgeClearedConversations, purgeDeletedTaskCalls } from "./soft-delete.js";

/** How a store read or write fails: the driver's own refusal, or a row this build cannot decode. */
type HostedStoreFailure = QueryError | Schema.SchemaError;

/**
 * What every `HostedStore` method answers: an effect over the ambient client,
 * so a caller composes it into the transaction it already holds and the edge
 * that owns the connection is the one that runs it.
 */
type HostedStoreEffect<A> = Effect.Effect<A, HostedStoreFailure, DatabaseServices>;

/**
 * The hosted store, over Postgres and keyed by user: the conversation rows
 * the store writer writes and the brain and the voice read. Every method
 * names the user whose rows it reaches, and nothing here resolves a user: the
 * bearer seam above decides who is asking, and the store takes the answer.
 * The conversation rows are plain `jsonb`, readable by an operator.
 */
export interface HostedStore {
  /** The conversation rows the brain and the voice read; every read skips a conversation stamped deleted. */
  messages: {
    /** The one message a writer's client id names — a turn's journal under the turn's id — read back under the registry; an empty page where none stands. */
    byClientId(
      userId: string,
      conversationId: string,
      tools: ToolSet,
      clientId: string,
    ): HostedStoreEffect<MessageListRead>;
    /** The developer's spoken lines each turn named took as its ask, by the client id the voice minted for each and where on its call each began, in the order they were said. */
    spokenAskRows(
      userId: string,
      conversationId: string,
      turnIds: readonly string[],
    ): HostedStoreEffect<ReadonlyMap<string, readonly SpokenAskRow[]>>;
  };
  turns: {
    /** The turn rows the given ids name, over standing conversations, in the order they last changed. */
    named(
      userId: string,
      turnIds: readonly string[],
    ): HostedStoreEffect<readonly StoredTurnRecord[]>;
  };
  retention: {
    /** The cron's purge of every conversation, of any account, stamped past the retention window. */
    purgeCleared(now: Date): HostedStoreEffect<number>;
    /** The cron's purge of the ended calls of every deleted plan, a sweep's worth: ended means closed, or started before `liveEdge`. */
    purgeDeletedTaskCalls(liveEdge: Date): HostedStoreEffect<number>;
  };
}

export function hostedStore(): HostedStore {
  return {
    messages: {
      byClientId: (userId, conversationId, tools, clientId) =>
        readMessageByClientId(userId, conversationId, tools, clientId),
      spokenAskRows: (userId, conversationId, turnIds) =>
        spokenAskRowsOf(userId, conversationId, turnIds),
    },
    turns: {
      named: (userId, turnIds) => turnsNamed(userId, turnIds),
    },
    retention: {
      purgeCleared: (now) => purgeClearedConversations(now),
      purgeDeletedTaskCalls: (liveEdge) => purgeDeletedTaskCalls(liveEdge),
    },
  };
}
