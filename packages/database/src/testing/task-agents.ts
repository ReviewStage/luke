import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
} from "@repo/features/inbox-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { conversations } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";

export const openTaskAgent = (userId: string, organizationId: string, taskId: string | null) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.AGENT });
    yield* db.insert(agentTable).values({
      id,
      organizationId,
      userId,
      taskId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      idempotencyKey: randomUUID(),
    });
    return id;
  });

export const openInboxItem = (
  userId: string,
  organizationId: string,
  taskId: string | null,
  agentId: string,
  asking: boolean,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = new Date(yield* Clock.currentTimeMillis);
    yield* db.insert(inboxItem).values({
      id,
      userId,
      taskId,
      organizationId,
      agentId,
      key: randomUUID(),
      revision: 1,
      version: 5,
      title: "Which base?",
      needsReply: asking,
      status: INBOX_STATUS.OPEN,
      postedAt: now,
      updatedAt: now,
    });
    const ask = {
      type: INBOX_ASK.DECIDE,
      options: [{ label: INBOX_APPROVAL_OPTION.APPROVE }, { label: INBOX_APPROVAL_OPTION.DECLINE }],
      status: INBOX_ASK_STATUS.OPEN,
    } as const;
    const sql = yield* SqlClient.SqlClient;
    const [message] = yield* sql<{
      readonly id: string;
    }>`insert into inbox_message (item_id, author, text, ask, created_at)
      values (${id}, ${INBOX_MESSAGE_AUTHOR.AGENT}, 'Rebase onto main?', ${asking ? JSON.stringify(ask) : null}::jsonb, ${now})
      returning id`;
    if (asking) {
      yield* db
        .update(inboxItem)
        .set({ openAskMessageId: message?.id ?? assert.fail("the message was not written") })
        .where(eq(inboxItem.id, id));
    }
    return id;
  });
