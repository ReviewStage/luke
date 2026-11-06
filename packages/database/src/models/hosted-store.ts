import type { ToolSet } from "ai";
import type { Effect } from "effect";
import type { DatabaseServices, StoreFailure } from "../core/query.js";
import {
  type MessageListRead,
  readMessageByClientId,
  type StoredTurnRecord,
  turnsNamed,
} from "./message-reads.js";
import { purgeClearedConversations } from "./soft-delete.js";

type HostedStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export interface HostedStore {
  messages: {
    byClientId(
      userId: string,
      conversationId: string,
      tools: ToolSet,
      clientId: string,
    ): HostedStoreEffect<MessageListRead>;
  };
  turns: {
    named(
      userId: string,
      turnIds: readonly string[],
    ): HostedStoreEffect<readonly StoredTurnRecord[]>;
  };
  retention: {
    purgeCleared(now: Date): HostedStoreEffect<number>;
  };
}

export function hostedStore(): HostedStore {
  return {
    messages: {
      byClientId: (userId, conversationId, tools, clientId) =>
        readMessageByClientId(userId, conversationId, tools, clientId),
    },
    turns: {
      named: (userId, turnIds) => turnsNamed(userId, turnIds),
    },
    retention: {
      purgeCleared: (now) => purgeClearedConversations(now),
    },
  };
}
