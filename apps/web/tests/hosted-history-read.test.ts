import assert from "node:assert/strict";
import {
  type ConversationHistoryAnswer,
  type ConversationMessagesAnswer,
  conversationHistoryAnswerSchema,
  conversationMessagesAnswerSchema,
  encodeHistoryReadCursor,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  historyReadCursorSchema,
  READ_QUERY,
  sequenceReadCursorSchema,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import {
  EXCESS_KEYS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  handleConversationHistory,
  handleConversationMessages,
  type ResourceReadOptions,
} from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertMessage, insertTurn } from "./support/store-rows";

/**
 * The history read over the real store and migrations: the Conversation's
 * own projection read the other way, newest first across the standing
 * conversations from the tail or from the position a device last reached,
 * under the same window the messages read cuts an observed conversation at,
 * so that a device paging back from the tail to the beginning meets exactly
 * the rows the forward read answers, in the same groups, and the head the
 * tail carries is where its forward reads then begin.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;
const BRAIN_REPLY = { author: MESSAGE_AUTHOR.BRAIN } as const;
const ROSTER_LOOK = {
  author: MESSAGE_AUTHOR.BRAIN,
  source: OBSERVATION_SOURCE.ROSTER_LOOK,
} as const;
const SESSION = {
  providerId: "conductor",
  providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
} as const;

const at = (offset: number) => new Date(NOW + offset);

interface HistoryQuery {
  before?: string;
  limit?: string;
}

function historyRequest(query: HistoryQuery = {}, method = "GET", authorized = true): Request {
  const url = new URL(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_HISTORY}`);
  if (query.before !== undefined) url.searchParams.set(READ_QUERY.BEFORE, query.before);
  if (query.limit !== undefined) url.searchParams.set(READ_QUERY.LIMIT, query.limit);
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

function messagesRequest(after?: string): Request {
  const url = new URL(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}`);
  if (after !== undefined) url.searchParams.set(READ_QUERY.AFTER, after);
  return new Request(url, { method: "GET", headers: { authorization: "Bearer token-1" } });
}

function options(userId: string, request: Request): ResourceReadOptions {
  return {
    request,
    resolveUserId: () => Effect.succeed(userId),
    store: database.store,
  };
}

function readHistory(userId: string, query: HistoryQuery = {}): Promise<Response> {
  return database.run(handleConversationHistory(options(userId, historyRequest(query))));
}

async function answeredHistory(response: Response): Promise<ConversationHistoryAnswer> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  const decoded = readEither(conversationHistoryAnswerSchema, { excess: EXCESS_KEYS.DROP })(body);
  if (Result.isFailure(decoded))
    assert.fail(`${decoded.failure.refusal} at ${decoded.failure.path.join(".")}`);
  return decoded.success;
}

async function readMessages(userId: string, after?: string): Promise<ConversationMessagesAnswer> {
  const response = await database.run(
    handleConversationMessages(options(userId, messagesRequest(after))),
  );
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

/** Each row an answer holds as `[turnId, messageId]`, in the order the groups and their rows are answered. */
function rowsOf(answer: {
  readonly groups: readonly {
    readonly turnId: string;
    readonly messages: readonly { readonly message: { readonly id?: unknown } }[];
  }[];
}): readonly (readonly [string, string])[] {
  return answer.groups.flatMap((group) =>
    group.messages.map((row) => [group.turnId, String(row.message.id)] as const),
  );
}

/**
 * A main with `turns` typed exchanges a minute apart, each an ask and a
 * reply, opened an hour before the first; its counter stands past the rows,
 * as the writer's allocation would leave it.
 */
async function mainWith(userId: string, turns: number, openedAt = at(-3_600_000)) {
  const main = await insertConversation(database.run, {
    userId,
    createdAt: openedAt,
    nextMessageSeq: turns * 2 + 1,
  });
  const exchanges: { turn: string; ask: string; reply: string; at: Date }[] = [];
  for (let index = 0; index < turns; index += 1) {
    const queued = at(index * 60_000);
    const turn = await insertTurn(database.run, {
      userId,
      conversationId: main,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: queued,
      startedAt: new Date(queued.getTime() + 100),
      settledAt: new Date(queued.getTime() + 3_000),
    });
    const ask = await insertMessage(database.run, {
      userId,
      conversationId: main,
      seq: index * 2 + 1,
      turnId: turn,
      clientId: `ask-${index}`,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: `Ask ${index}.` }],
      metadata: TYPED_ASK,
      createdAt: queued,
      finishedAt: queued,
    });
    const reply = await insertMessage(database.run, {
      userId,
      conversationId: main,
      seq: index * 2 + 2,
      turnId: turn,
      clientId: turn,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "text", text: `Reply ${index}.`, state: "done" }],
      metadata: BRAIN_REPLY,
      createdAt: new Date(queued.getTime() + 2_000),
      finishedAt: new Date(queued.getTime() + 3_000),
    });
    exchanges.push({ turn, ask, reply, at: queued });
  }
  return { main, exchanges };
}

/** An observed conversation, one per session, whose one roster-diff turn announced at `offset`: the wake's line and the announcing reply. */
async function observedAnnouncing(userId: string, offset: number, session = "a") {
  const observed = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: SESSION.providerId,
    providerSessionId: `${SESSION.providerSessionId}-${session}`,
    createdAt: at(offset - 7_200_000),
    nextMessageSeq: 3,
  });
  const turn = await insertTurn(database.run, {
    userId,
    conversationId: observed,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.SETTLED,
    queuedAt: at(offset),
    startedAt: at(offset + 200),
    settledAt: at(offset + 2_400),
  });
  await insertMessage(database.run, {
    userId,
    conversationId: observed,
    seq: 1,
    turnId: turn,
    clientId: `${turn}-wake`,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Roster: the session moved to waiting." }],
    metadata: ROSTER_LOOK,
    createdAt: at(offset),
    finishedAt: at(offset),
  });
  const reply = await insertMessage(database.run, {
    userId,
    conversationId: observed,
    seq: 2,
    turnId: turn,
    clientId: turn,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "step-start" },
      {
        type: "tool-announce",
        toolCallId: `call_${turn.slice(0, 8)}`,
        state: "output-available",
        input: { briefing: "The session is waiting on a permission prompt." },
        output: {},
      },
      { type: "text", text: "Announced.", state: "done" },
    ],
    metadata: BRAIN_REPLY,
    createdAt: at(offset + 2_000),
    finishedAt: at(offset + 2_400),
  });
  return { observed, turn, reply };
}

test("the gate order is method, bearer, then the query: a position this build did not mint or a bound outside the page's is refused", async () => {
  const userId = await database.createUser();
  await mainWith(userId, 1);
  await refused(
    await database.run(handleConversationHistory(options(userId, historyRequest({}, "POST")))),
    405,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  );
  await refused(
    await database.run(
      handleConversationHistory({
        ...options(userId, historyRequest({}, "GET", false)),
        resolveUserId: () => Effect.succeed(undefined),
      }),
    ),
    401,
    HOSTED_API_ERROR.INVALID_TOKEN,
  );
  await refused(
    await readHistory(userId, { before: "c3VyZQ" }),
    400,
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
  await refused(await readHistory(userId, { limit: "0" }), 400, HOSTED_API_ERROR.INVALID_REQUEST);
  // A messages cursor is not a history position, even though both are cursors this build mints.
  const forward = await readMessages(userId);
  await refused(
    await readHistory(userId, { before: forward.next }),
    400,
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
});

test("the tail is the newest rows across the standing conversations, its head is where the forward read begins, and paging back to the beginning meets exactly the rows the forward read answers", async () => {
  const userId = await database.createUser();
  const { main, exchanges } = await mainWith(userId, 4);
  // An announcement placed between the second and third exchange crosses into the view where it is placed.
  const {
    observed,
    turn: observedTurn,
    reply: announcement,
  } = await observedAnnouncing(userId, 90_000);
  const forward = await readMessages(userId);
  assert.equal(forward.hasMore, false);

  const tail = await answeredHistory(await readHistory(userId, { limit: "3" }));
  assert.deepEqual(
    tail.conversations.map((conversation) => [conversation.id, conversation.kind]),
    [
      [main, CONVERSATION_VIEW_SOURCE.MAIN],
      [observed, CONVERSATION_VIEW_SOURCE.OBSERVED],
    ],
  );
  // The newest three rows: the fourth exchange whole and the third's reply, the ask cut to the next page.
  assert.deepEqual(rowsOf(tail), [
    [exchanges[2]?.turn ?? "", exchanges[2]?.reply ?? ""],
    [exchanges[3]?.turn ?? "", exchanges[3]?.ask ?? ""],
    [exchanges[3]?.turn ?? "", exchanges[3]?.reply ?? ""],
  ]);
  assert.equal(tail.hasOlder, true);
  // The head the tail carries is the messages read's own cursor at its end, so a forward read from it answers nothing new.
  assert.equal(tail.next, forward.next);
  const onward = await readMessages(userId, tail.next);
  assert.deepEqual(onward.groups, []);
  assert.equal(onward.hasMore, false);
  const position = Result.getOrUndefined(readEither(historyReadCursorSchema)(tail.older));
  assert.deepEqual([position?.before?.conversationId, position?.before?.seq], [main, 6]);

  // Back a page at a time until the beginning, the announcement met where it is placed.
  const pages = [tail];
  let older = tail;
  while (older.hasOlder) {
    older = await answeredHistory(await readHistory(userId, { before: older.older, limit: "3" }));
    pages.push(older);
  }
  assert.equal(pages.length, 4);
  assert.deepEqual(rowsOf(pages[1] ?? tail), [
    [observedTurn, announcement],
    [exchanges[2]?.turn ?? "", exchanges[2]?.ask ?? ""],
  ]);
  // The page that reached the beginning names nothing older and keeps its position at the oldest row.
  const first = pages.at(-1);
  assert.ok(first);
  assert.equal(first.hasOlder, false);
  assert.deepEqual(
    Result.getOrUndefined(readEither(historyReadCursorSchema)(first.older))?.before?.seq,
    1,
  );
  // Every row the forward read answers, once each, and no other.
  const walked = pages
    .flatMap(rowsOf)
    .map(([turn, id]) => `${turn}:${id}`)
    .toSorted();
  const straight = rowsOf(forward)
    .map(([turn, id]) => `${turn}:${id}`)
    .toSorted();
  assert.deepEqual(walked, straight);
  assert.equal(new Set(walked).size, walked.length);
  // One page further back from the beginning answers nothing and stays put.
  const past = await answeredHistory(await readHistory(userId, { before: first.older }));
  assert.deepEqual(past.groups, []);
  assert.equal(past.hasOlder, false);
  assert.equal(past.older, first.older);
});

test("an observed conversation's rows from before the standing main opened are outside the history as they are outside the thread, and do not count as older", async () => {
  const userId = await database.createUser();
  // The main opened at NOW; the observed announcement from an hour before it belongs to a thread since cleared.
  const { main, exchanges } = await mainWith(userId, 1, at(0));
  await observedAnnouncing(userId, -3_600_000, "a");
  const { reply: crossing } = await observedAnnouncing(userId, 30_000, "b");
  const tail = await answeredHistory(await readHistory(userId, { limit: "1" }));
  assert.deepEqual(
    rowsOf(tail).map(([, id]) => id),
    [crossing],
  );
  const rest = await answeredHistory(await readHistory(userId, { before: tail.older }));
  assert.deepEqual(rowsOf(rest), [
    [exchanges[0]?.turn ?? "", exchanges[0]?.ask ?? ""],
    [exchanges[0]?.turn ?? "", exchanges[0]?.reply ?? ""],
  ]);
  assert.equal(rest.hasOlder, false);
  assert.equal(rest.conversations[0]?.id, main);
});

test("two rows placed at one instant in two conversations are told apart across a page edge, so neither is skipped or answered twice", async () => {
  const userId = await database.createUser();
  const { exchanges } = await mainWith(userId, 1);
  // The announcement's wake is placed at the very instant of the main's ask.
  const { reply } = await observedAnnouncing(userId, 0);
  const seen: string[] = [];
  let page = await answeredHistory(await readHistory(userId, { limit: "1" }));
  seen.push(...rowsOf(page).map(([, id]) => id));
  while (page.hasOlder) {
    page = await answeredHistory(await readHistory(userId, { before: page.older, limit: "1" }));
    seen.push(...rowsOf(page).map(([, id]) => id));
  }
  assert.deepEqual(seen.toSorted(), [exchanges[0]?.ask, exchanges[0]?.reply, reply].toSorted());
});

test("an account with nothing standing answers an empty tail from the tail, and the empty history cursor reads as the tail", async () => {
  const userId = await database.createUser();
  await insertConversation(database.run, { userId, createdAt: at(0) });
  const tail = await answeredHistory(await readHistory(userId));
  assert.deepEqual(tail.groups, []);
  assert.equal(tail.hasOlder, false);
  assert.deepEqual(Result.getOrUndefined(readEither(historyReadCursorSchema)(tail.older)), {});
  assert.equal(tail.older, encodeHistoryReadCursor(undefined));
  const head = Result.getOrUndefined(readEither(sequenceReadCursorSchema)(tail.next));
  assert.deepEqual(
    head?.positions.map((position) => position.seq),
    [0],
  );
});
