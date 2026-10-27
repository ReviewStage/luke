import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
} from "@luke/features/inbox-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { Database } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxMessage } from "../schemas/inbox-message.js";
import { conversations } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";

/**
 * task-agents.ts -- a coding agent on a test's task, and an inbox item it holds open, written beneath the store.
 *
 * A test about a task's work or its inbox that wants an agent on the task,
 * or an item of that agent's waiting on the developer, writes the rows here
 * rather than starting a session: an agent of the member's, with its own
 * conversation, and an item open under a fresh key, holding its message's
 * ask open, or open as a notice whose message asks nothing.
 */

/** An agent of the member's on the task, with its own conversation; its id. */
export const openTaskAgent = (userId: string, organizationId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      taskId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      repositories: ["acme/api"],
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** An inbox item of the task's agent, open and holding its message's ask open, or open as a notice, its message asking nothing, where `asking` is false; its id. */
export const openInboxItem = (
  userId: string,
  organizationId: string,
  taskId: string,
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
    const [message] = yield* db
      .insert(inboxMessage)
      .values({
        itemId: id,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Rebase onto main?",
        ask: asking ? ask : null,
        createdAt: now,
      })
      .returning({ id: inboxMessage.id });
    // A notice's message asks nothing, so the item names no open ask.
    if (asking) {
      yield* db
        .update(inboxItem)
        .set({ openAskMessageId: message?.id ?? assert.fail("the message was not written") })
        .where(eq(inboxItem.id, id));
    }
    return id;
  });
