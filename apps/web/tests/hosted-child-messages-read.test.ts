import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CHILD_MESSAGES_QUERY,
  type ConversationMessagesAnswer,
  conversationMessagesAnswerSchema,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  sequenceReadCursorSchema,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE, CONVERSATION_VIEW_TOOL_KIND } from "@sidecar/session";
import {
  EXCESS_KEYS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  handleConversationChildMessages,
  handleConversationMessages,
  type ResourceReadOptions,
} from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertTurn,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * A child's messages read over the real store and migrations: the
 * Conversation's own projection over the one child the query names, the
 * child standing where a main does in its page; behind the same gate as the
 * other reads, refusing a query that names no child, and not finding a child
 * that does not stand for the account.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;
const BRAIN_REPLY = { author: MESSAGE_AUTHOR.BRAIN } as const;
const SESSION_FIELDS = {
  provider_id: "conductor",
  provider_session_id: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
} as const;

const at = (offset: number) => new Date(NOW + offset);

/** The query a read is handed, spelled as a client might spell it. */
interface ReadQuery {
  child?: string;
  after?: string;
  limit?: string;
}

function request(query: ReadQuery = {}, method = "GET", authorized = true): Request {
  const url = new URL(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_CHILD_MESSAGES}`);
  if (query.child !== undefined) url.searchParams.set(CHILD_MESSAGES_QUERY.CHILD, query.child);
  if (query.after !== undefined) url.searchParams.set(CHILD_MESSAGES_QUERY.AFTER, query.after);
  if (query.limit !== undefined) url.searchParams.set(CHILD_MESSAGES_QUERY.LIMIT, query.limit);
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

function options(userId: string, req: Request): ResourceReadOptions {
  return {
    request: req,
    resolveUserId: () => Effect.succeed(userId),
    store: database.store,
  };
}

function read(userId: string, query: ReadQuery = {}): Promise<Response> {
  return database.run(handleConversationChildMessages(options(userId, request(query))));
}

async function answered(response: Response): Promise<ConversationMessagesAnswer> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  const decoded = readEither(conversationMessagesAnswerSchema, { excess: EXCESS_KEYS.DROP })(body);
  if (Result.isFailure(decoded))
    assert.fail(`${decoded.failure.refusal} at ${decoded.failure.path.join(".")}`);
  return decoded.success;
}

async function refused(response: Response, status: number, error: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error, error);
}

/** A child opened under `parent` with its counter past the rows a test writes, as the writer's allocation would leave it. */
async function childOf(
  userId: string,
  parentConversationId: string,
  row: { createdAt: Date; nextMessageSeq?: number },
): Promise<string> {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId,
    ...row,
  });
}

/** A child with the two rows a delegation leaves: its task line, and the reply the child turn wrote. */
async function delegated(userId: string, main: string) {
  const child = await childOf(userId, main, { createdAt: at(0), nextMessageSeq: 3 });
  const taskLine = await insertMessage(database.run, {
    userId,
    conversationId: child,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "[subagent task] Draft the release notes for 0.6.0." }],
    metadata: TYPED_ASK,
    createdAt: at(0),
    finishedAt: at(0),
  });
  const turn = await insertTurn(database.run, {
    userId,
    conversationId: child,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.SETTLED,
    queuedAt: at(0),
    startedAt: at(1_000),
    settledAt: at(90_000),
  });
  const reply = await insertMessage(database.run, {
    userId,
    conversationId: child,
    seq: 2,
    turnId: turn,
    clientId: turn,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "step-start" },
      {
        type: "tool-read_transcript",
        toolCallId: "call_1a0000000000000011",
        state: "output-available",
        input: SESSION_FIELDS,
        output: {},
      },
      { type: "text", text: "The release notes are drafted.", state: "done" },
    ],
    metadata: BRAIN_REPLY,
    createdAt: at(80_000),
    finishedAt: at(89_000),
  });
  return { child, taskLine, turn, reply };
}

test("the gate order is method, bearer, then the query: a read naming no child or a cursor this build did not mint is refused", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });
  const child = await childOf(userId, main, { createdAt: at(0) });

  await refused(
    await database.run(
      handleConversationChildMessages(options(userId, request({ child }, "POST"))),
    ),
    405,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  );
  await refused(
    await database.run(
      handleConversationChildMessages({
        ...options(userId, request({ child }, "GET", false)),
        resolveUserId: () => Effect.succeed(undefined),
      }),
    ),
    401,
    HOSTED_API_ERROR.INVALID_TOKEN,
  );
  for (const query of [
    {},
    { child: "not-a-uuid" },
    { child, after: "%%%" },
    { child, limit: "0" },
    { child, limit: "two" },
  ] satisfies ReadQuery[]) {
    await refused(await read(userId, query), 400, HOSTED_API_ERROR.INVALID_REQUEST);
  }
});

test("a child that does not stand for the account is not found: an unknown id, a stamped child, another account's, or a conversation of another kind", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });
  const stamped = await childOf(userId, main, { createdAt: at(0) });
  await setConversationDeletedAt(database.run, stamped, at(1_000));
  const otherMain = await insertConversation(database.run, {
    userId: other,
    createdAt: at(-3_600_000),
  });
  const othersChild = await childOf(other, otherMain, { createdAt: at(0) });

  for (const child of [randomUUID(), stamped, othersChild, main]) {
    await refused(await read(userId, { child }), 404, HOSTED_API_ERROR.NOT_FOUND);
  }
});

test("a child's page is a main's page over the one child: its task line in a group of its own, the child turn's reply under its turn, and a cursor that pages the child alone", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });
  const { child, taskLine, turn, reply } = await delegated(userId, main);
  // A second child's rows never cross into the first's page.
  await delegated(userId, main);

  const whole = await answered(await read(userId, { child }));
  assert.deepEqual(whole.conversations, [
    { id: child, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt: NOW },
  ]);
  assert.deepEqual(
    whole.groups.map((group) => [
      group.turnId,
      group.conversationId,
      group.source.kind,
      group.turn?.origin,
      group.messages.map((message) => message.message.id),
    ]),
    [
      [taskLine, child, CONVERSATION_VIEW_SOURCE.MAIN, undefined, [taskLine]],
      [turn, child, CONVERSATION_VIEW_SOURCE.MAIN, TURN_ORIGIN.CHILD, [reply]],
    ],
  );
  const [, replied] = whole.groups;
  assert.deepEqual(replied?.turn, {
    id: turn,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.SETTLED,
    queuedAt: NOW,
    startedAt: NOW + 1_000,
    settledAt: NOW + 90_000,
  });
  assert.deepEqual(
    replied?.messages[0]?.tools.map((tool) => [tool.toolName, tool.kind]),
    [["read_transcript", CONVERSATION_VIEW_TOOL_KIND.DETAIL]],
  );
  assert.deepEqual(Result.getOrUndefined(readEither(sequenceReadCursorSchema)(whole.next)), {
    positions: [{ conversationId: child, seq: 2, revision: 0 }],
  });
  assert.equal(whole.hasMore, false);

  // Paged one row at a time, the two reads hand over the same groups in the same order.
  const first = await answered(await read(userId, { child, limit: "1" }));
  assert.deepEqual(
    first.groups.map((group) => group.turnId),
    [taskLine],
  );
  assert.equal(first.hasMore, true);
  const second = await answered(await read(userId, { child, after: first.next, limit: "1" }));
  assert.deepEqual(
    second.groups.map((group) => group.turnId),
    [turn],
  );
  assert.equal(second.hasMore, false);
  assert.equal(second.next, whole.next);

  // The Conversation's own read lists the child among nothing: its rows are its own page's.
  const conversation = await answered(
    await database.run(
      handleConversationMessages(
        options(
          userId,
          new Request(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}`, {
            headers: { authorization: "Bearer token-1" },
          }),
        ),
      ),
    ),
  );
  assert.deepEqual(
    conversation.conversations.map((entry) => entry.id),
    [main],
  );
  assert.deepEqual(conversation.groups, []);
});
