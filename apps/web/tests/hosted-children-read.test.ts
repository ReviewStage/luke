import assert from "node:assert/strict";
import {
  CHILD_STATUS,
  CHILDREN_READ_BOUNDS,
  type ChildrenAnswer,
  childrenAnswerSchema,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  READ_QUERY,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import {
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
import { childTaskInputText } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { handleConversationChildren } from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertTurn,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * The children read over the real store and migrations: the account's
 * standing children as the wire carries them, newest first, each where its
 * latest turn leaves it and with the excerpt of the task it was handed;
 * behind the same gate as the other reads, and taking no cursor.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;

const at = (offset: number) => new Date(NOW + offset);

/** The query a read is handed, spelled as a client might spell it. */
interface ReadQuery {
  after?: string;
  limit?: string;
}

function request(query: ReadQuery = {}, method = "GET", authorized = true): Request {
  const url = new URL(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_CHILDREN}`);
  if (query.after !== undefined) url.searchParams.set(READ_QUERY.AFTER, query.after);
  if (query.limit !== undefined) url.searchParams.set(READ_QUERY.LIMIT, query.limit);
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

function options(userId: string, req: Request) {
  return {
    request: req,
    resolveUserId: () => Effect.succeedSome(userId),
    store: database.store,
  };
}

async function answered(response: Response): Promise<ChildrenAnswer> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const read = readEither(childrenAnswerSchema)((await response.json()) as UnparsedWireValue);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

async function childOf(
  userId: string,
  parentConversationId: string,
  row: { createdAt: Date; label?: string },
): Promise<string> {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId,
    ...row,
  });
}

/** The task's line as the relay writes it: the child's first user row. */
async function taskLine(userId: string, childId: string, text: string): Promise<string> {
  return insertMessage(database.run, {
    userId,
    conversationId: childId,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    metadata: TYPED_ASK,
    createdAt: at(0),
    finishedAt: at(0),
  });
}

test("the gate order is method and bearer, and a cursor or a bound is accepted and ignored since the read takes none", async () => {
  const userId = await database.createUser();

  const wrongMethod = await database.run(
    handleConversationChildren(options(userId, request({}, "POST"))),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await database.run(
    handleConversationChildren({
      ...options(userId, request({}, "GET", false)),
      resolveUserId: () => Effect.succeedNone,
    }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  for (const query of [{ after: "%%%" }, { limit: "0" }, { limit: "two" }] satisfies ReadQuery[]) {
    const answer = await answered(
      await database.run(handleConversationChildren(options(userId, request(query)))),
    );
    assert.deepEqual(answer, { children: [] }, JSON.stringify(query));
  }
});

test("children are answered newest first, each where its latest turn leaves it, with its label and the excerpt of its task", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });
  const observed = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
    createdAt: at(-3_600_000),
  });

  const settled = await childOf(userId, main, { createdAt: at(1_000), label: "release notes" });
  await taskLine(userId, settled, "  Draft the release notes for 0.6.0.  ");
  await insertTurn(database.run, {
    userId,
    conversationId: settled,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.SETTLED,
    queuedAt: at(2_000),
    startedAt: at(3_000),
    settledAt: at(60_000),
  });

  const running = await childOf(userId, observed, { createdAt: at(120_000) });
  const longTask = "look ".repeat(60);
  await taskLine(userId, running, longTask);
  await insertTurn(database.run, {
    userId,
    conversationId: running,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.RUNNING,
    queuedAt: at(121_000),
    startedAt: at(122_000),
  });

  const failed = await childOf(userId, main, { createdAt: at(180_000) });
  await insertTurn(database.run, {
    userId,
    conversationId: failed,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.FAILED,
    queuedAt: at(181_000),
    startedAt: at(182_000),
    settledAt: at(183_000),
    failure: "model",
  });

  const accepted = await childOf(userId, main, { createdAt: at(240_000) });

  const answer = await answered(
    await database.run(handleConversationChildren(options(userId, request()))),
  );
  assert.deepEqual(answer.children, [
    {
      id: accepted,
      parentConversationId: main,
      parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
      status: CHILD_STATUS.ACCEPTED,
      acceptedAt: NOW + 240_000,
    },
    {
      id: failed,
      parentConversationId: main,
      parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
      status: CHILD_STATUS.FAILED,
      acceptedAt: NOW + 180_000,
      startedAt: NOW + 182_000,
      settledAt: NOW + 183_000,
      failure: "model",
    },
    {
      id: running,
      parentConversationId: observed,
      parentKind: CONVERSATION_VIEW_SOURCE.OBSERVED,
      task: longTask.slice(0, CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS).trimEnd(),
      status: CHILD_STATUS.RUNNING,
      acceptedAt: NOW + 120_000,
      startedAt: NOW + 122_000,
    },
    {
      id: settled,
      parentConversationId: main,
      parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
      label: "release notes",
      task: "Draft the release notes for 0.6.0.",
      status: CHILD_STATUS.SETTLED,
      acceptedAt: NOW + 1_000,
      startedAt: NOW + 3_000,
      settledAt: NOW + 60_000,
    },
  ]);
});

test("the task's marker travels: the excerpt is the line as the relay wrote it, and the device is what strips the marker", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });
  const child = await childOf(userId, main, { createdAt: at(1_000) });
  await taskLine(userId, child, childTaskInputText("Summarise the fixture repository."));

  const answer = await answered(
    await database.run(handleConversationChildren(options(userId, request()))),
  );
  assert.equal(answer.children[0]?.task, "[subagent task] Summarise the fixture repository.");
});

test("a stamped child, another account's child, and a child under a parent of another kind are answered by nothing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const main = await insertConversation(database.run, { userId, createdAt: at(-3_600_000) });

  const standing = await childOf(userId, main, { createdAt: at(1_000) });
  const stamped = await childOf(userId, main, { createdAt: at(2_000) });
  await setConversationDeletedAt(database.run, stamped, at(3_000));
  // A child cannot open a child of its own, so a row under one is no delegation's and the store lists it to no one.
  await childOf(userId, standing, { createdAt: at(4_000) });
  const otherMain = await insertConversation(database.run, {
    userId: other,
    createdAt: at(-3_600_000),
  });
  await childOf(other, otherMain, { createdAt: at(5_000) });

  const answer = await answered(
    await database.run(handleConversationChildren(options(userId, request()))),
  );
  assert.deepEqual(
    answer.children.map((child) => child.id),
    [standing],
  );
});
