import assert from "node:assert/strict";
import {
  conversationClearAnswerSchema,
  conversationMessagesAnswerSchema,
  HOSTED_API_ERROR,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND, conversations, messages } from "../server/db/schema";
import { handleConversationClear } from "../server/hosted/conversation-clear";
import { handleConversationMessages } from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * Clear over the real store: the route stamps the standing main and answers
 * the main it opened, the messages read lists only the new main from the
 * next call, and the refusals every hosted route shares stand in front of it.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const CLEAR_PATH = "https://luke.test/api/conversation/clear";
const MESSAGES_PATH = "https://luke.test/api/conversation/messages";

function request(url: string, method: string, authorized = true): Request {
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

/** The options both handlers take: the whole store, so one call shape serves the Clear and the read that follows it. */
function options(userId: string | undefined, req: Request) {
  return { request: req, resolveUserId: async () => userId, store: database.store, now: () => NOW };
}

async function body(response: Response): Promise<UnparsedWireValue> {
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  return (await response.json()) as UnparsedWireValue;
}

async function populate(userId: string): Promise<string> {
  const [main] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN, nextMessageSeq: 2 })
    .returning({ id: conversations.id });
  assert.ok(main);
  await database.db.insert(messages).values({
    userId,
    conversationId: main.id,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "ask 1" }],
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
    createdAt: new Date(NOW),
    finishedAt: new Date(NOW),
  });
  return main.id;
}

test("Clear stamps the standing main, answers the one it opened, and the next messages read lists only that one", async () => {
  const userId = await database.createUser();
  const main = await populate(userId);

  const before = conversationMessagesAnswerSchema.parse(
    await body(await handleConversationMessages(options(userId, request(MESSAGES_PATH, "GET")))),
  );
  assert.ok(before);
  assert.deepEqual(
    before.conversations.map((conversation) => conversation.id),
    [main],
  );
  assert.equal(before.groups.length, 1);

  const response = await handleConversationClear(options(userId, request(CLEAR_PATH, "POST")));
  assert.equal(response.status, 200);
  const answer = conversationClearAnswerSchema.parse(await body(response));
  assert.ok(answer);
  assert.equal(answer.cleared, 1);
  assert.notEqual(answer.opened, main);
  assert.equal(answer.openedAt, NOW);

  const [stamped] = await database.db
    .select({ deletedAt: conversations.deletedAt })
    .from(conversations)
    .where(eq(conversations.id, main));
  assert.deepEqual(stamped?.deletedAt, new Date(NOW));

  const after = conversationMessagesAnswerSchema.parse(
    await body(await handleConversationMessages(options(userId, request(MESSAGES_PATH, "GET")))),
  );
  assert.ok(after);
  // The main the Clear opened is the view's window from the Clear's own instant.
  assert.deepEqual(after.conversations, [
    { id: answer.opened, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt: NOW },
  ]);
  assert.deepEqual(after.groups, []);
});

test("a second Clear stamps the main the first one opened", async () => {
  const userId = await database.createUser();
  await populate(userId);
  const first = conversationClearAnswerSchema.parse(
    await body(await handleConversationClear(options(userId, request(CLEAR_PATH, "POST")))),
  );
  const second = conversationClearAnswerSchema.parse(
    await body(await handleConversationClear(options(userId, request(CLEAR_PATH, "POST")))),
  );
  assert.ok(first && second);
  assert.equal(second.cleared, 1);
  assert.notEqual(second.opened, first.opened);
});

test("the shared refusals stand in front of Clear: the method, then the bearer", async () => {
  const userId = await database.createUser();
  const method = await handleConversationClear(options(userId, request(CLEAR_PATH, "GET")));
  assert.equal(method.status, 405);
  assert.deepEqual(await body(method), { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED });
  const bearer = await handleConversationClear(
    options(undefined, request(CLEAR_PATH, "POST", false)),
  );
  assert.equal(bearer.status, 401);
  assert.deepEqual(await body(bearer), { error: HOSTED_API_ERROR.INVALID_TOKEN });
});
