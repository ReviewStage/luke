import assert from "node:assert/strict";
import {
  conversationClearAnswerSchema,
  conversationMessagesAnswerSchema,
  HOSTED_API_ERROR,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import {
  EXCESS_KEYS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { atInstant } from "@sidecar/wire/testing";
import { Effect, type Schema as EffectSchema, Option, Result } from "effect";
import { afterAll, test } from "vitest";
import { handleConversationClear } from "../server/hosted/conversation-clear";
import { handleConversationMessages } from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  instantColumn,
  readConversationById,
} from "./support/store-rows";

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
  return {
    request: req,
    resolveUserId: () => Effect.succeed(Option.fromUndefinedOr(userId)),
    store: database.store,
  };
}

/** The Clear run at the test's one instant, which is what it opens and stamps at. */
function clear(options: Parameters<typeof handleConversationClear>[0]) {
  return atInstant(NOW)(handleConversationClear(options));
}

async function body(response: Response): Promise<UnparsedWireValue> {
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  return (await response.json()) as UnparsedWireValue;
}

function parse<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  // Every answer read here belongs to a family declared tolerant, so the read
  // drops a key a newer service may have added.
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

async function populate(userId: string): Promise<string> {
  const conversationId = await insertConversation(database.run, { userId, nextMessageSeq: 2 });
  await insertMessage(database.run, {
    userId,
    conversationId,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "ask 1" }],
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
    createdAt: new Date(NOW),
    finishedAt: new Date(NOW),
  });
  return conversationId;
}

test("Clear stamps the standing main, answers the one it opened, and the next messages read lists only that one", async () => {
  const userId = await database.createUser();
  const main = await populate(userId);

  const before = parse(
    conversationMessagesAnswerSchema,
    await body(
      await database.run(
        handleConversationMessages(options(userId, request(MESSAGES_PATH, "GET"))),
      ),
    ),
  );
  assert.ok(before);
  assert.deepEqual(
    before.conversations.map((conversation) => conversation.id),
    [main],
  );
  assert.equal(before.groups.length, 1);

  const response = await database.run(clear(options(userId, request(CLEAR_PATH, "POST"))));
  assert.equal(response.status, 200);
  const answer = parse(conversationClearAnswerSchema, await body(response));
  assert.ok(answer);
  assert.equal(answer.cleared, 1);
  assert.notEqual(answer.opened, main);
  assert.equal(answer.openedAt, NOW);

  const [stamped] = await readConversationById(database.run, main);
  assert.deepEqual(instantColumn(stamped?.deletedAt), new Date(NOW));

  const after = parse(
    conversationMessagesAnswerSchema,
    await body(
      await database.run(
        handleConversationMessages(options(userId, request(MESSAGES_PATH, "GET"))),
      ),
    ),
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
  const first = parse(
    conversationClearAnswerSchema,
    await body(await database.run(clear(options(userId, request(CLEAR_PATH, "POST"))))),
  );
  const second = parse(
    conversationClearAnswerSchema,
    await body(await database.run(clear(options(userId, request(CLEAR_PATH, "POST"))))),
  );
  assert.ok(first && second);
  assert.equal(second.cleared, 1);
  assert.notEqual(second.opened, first.opened);
});

test("the shared refusals stand in front of Clear: the method, then the bearer", async () => {
  const userId = await database.createUser();
  const method = await database.run(clear(options(userId, request(CLEAR_PATH, "GET"))));
  assert.equal(method.status, 405);
  assert.deepEqual(await body(method), { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED });
  const bearer = await database.run(clear(options(undefined, request(CLEAR_PATH, "POST", false))));
  assert.equal(bearer.status, 401);
  assert.deepEqual(await body(bearer), { error: HOSTED_API_ERROR.INVALID_TOKEN });
});
