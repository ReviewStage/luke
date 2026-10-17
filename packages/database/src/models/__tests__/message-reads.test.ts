import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
} from "@luke/wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  awaitingLinesOf,
  listMessagesBefore,
  listMessagesPast,
  listTurnOpeners,
  messageCursorNow,
  messageSeqOf,
  runningChildTurns,
  turnStoppedUnderReached,
} from "../message-reads.js";
import { storeWriter } from "../writer.js";

/**
 * Where a reader of a conversation stands once it has every row, and whether
 * a subagent's session under a conversation still runs, and which turn a
 * tool call's Stop stands on by its key, over a real dialect.
 *
 * Synthetic accounts, conversations, and rows throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const openConversation = (userId: string, parentConversationId?: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind: parentConversationId === undefined ? CONVERSATION_KIND.TASK : CONVERSATION_KIND.CHILD,
      ...(parentConversationId === undefined ? undefined : { parentConversationId }),
    });
    return id;
  });

/** A coding agent's conversation of the account's, whose turnless lines await their turn. */
const openAgentConversation = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({ id, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    return id;
  });

/** A developer's line no turn owns, written at `at` where given. */
const writeLine = (userId: string, conversationId: string, seq: number, at = new Date()) =>
  Database.use((db) =>
    db.insert(messages).values({
      userId,
      conversationId,
      seq,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: `Line ${seq}` }],
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      createdAt: at,
      placedAt: at,
    }),
  );

/** A finished row of a turn, or of none for a line a turn took in mid-run. */
const writeTurnRow = (
  userId: string,
  conversationId: string,
  seq: number,
  turnId: string | null,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
) =>
  Database.use((db) =>
    db.insert(messages).values({
      userId,
      conversationId,
      seq,
      turnId,
      clientId: randomUUID(),
      role,
      parts: [{ type: "text", text: `Line ${seq}` }],
      metadata:
        role === MESSAGE_ROLE.USER
          ? { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED }
          : { author: MESSAGE_AUTHOR.BRAIN },
      createdAt: new Date(),
      placedAt: new Date(),
      finishedAt: new Date(),
    }),
  );

const openTurn = (userId: string, conversationId: string, status: TurnStatus) =>
  Effect.map(
    Database.use((db) =>
      db
        .insert(turns)
        .values({ userId, conversationId, origin: TURN_ORIGIN.SPOKEN, status })
        .returning({ id: turns.id }),
    ),
    ([row]) => row?.id ?? "",
  );

it.layer(getTestDB())("a conversation's reader", (it) => {
  it.effect(
    "a reader at the cursor now has every row, so a read past it answers only what lands after; another account's conversation is the start",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const conversation = yield* openConversation(owner);
        assert.equal((yield* messageCursorNow(owner, conversation)).seq, 0);
        yield* writeLine(owner, conversation, 1);
        yield* writeLine(owner, conversation, 2);

        const now = yield* messageCursorNow(owner, conversation);
        assert.equal(now.seq, 2);
        assert.equal((yield* listMessagesPast(owner, conversation, {}, now)).cursor.seq, 2);
        yield* writeLine(owner, conversation, 3);
        assert.equal((yield* listMessagesPast(owner, conversation, {}, now)).cursor.seq, 3);
        assert.deepEqual(yield* messageCursorNow(other, conversation), { seq: 0, revision: 0 });
      }),
  );

  it.effect(
    "a read back from the end answers the newest rows below the sequence asked, oldest first, and none of another account's conversation",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const conversation = yield* openConversation(owner);
        for (const seq of [1, 2, 3, 4, 5]) yield* writeLine(owner, conversation, seq);
        const seqsOf = (read: Effect.Success<ReturnType<typeof listMessagesBefore>>) =>
          read.ok ? read.value.map((record) => record.seq) : assert.fail("the page read");

        assert.deepEqual(
          seqsOf(yield* listMessagesBefore(owner, conversation, {}, Number.MAX_SAFE_INTEGER, 2)),
          [4, 5],
        );
        assert.deepEqual(seqsOf(yield* listMessagesBefore(owner, conversation, {}, 4, 2)), [2, 3]);
        assert.deepEqual(seqsOf(yield* listMessagesBefore(owner, conversation, {}, 2, 2)), [1]);
        assert.deepEqual(
          seqsOf(yield* listMessagesBefore(other, conversation, {}, Number.MAX_SAFE_INTEGER, 2)),
          [],
        );
      }),
  );

  it.effect(
    "a message's sequence is found by its id in the role named, and not in another role or another account's conversation",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const conversation = yield* openConversation(owner);
        yield* writeLine(owner, conversation, 1);
        yield* writeLine(owner, conversation, 2);
        const read = yield* listMessagesPast(owner, conversation, {}, { seq: 0, revision: 0 });
        const second = read.read.ok ? read.read.value[1] : assert.fail("the page read");
        assert.ok(second !== undefined);

        assert.deepEqual(
          yield* messageSeqOf(owner, conversation, second.id, MESSAGE_ROLE.USER),
          Option.some(2),
        );
        assert.deepEqual(
          yield* messageSeqOf(owner, conversation, second.id, MESSAGE_ROLE.ASSISTANT),
          Option.none(),
        );
        assert.deepEqual(
          yield* messageSeqOf(other, conversation, second.id, MESSAGE_ROLE.USER),
          Option.none(),
        );
      }),
  );

  it.effect(
    "a turn's opener is the first line that names it, never a line it took in mid-run or its answer, and none for another account",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const conversation = yield* openConversation(owner);
        const first = yield* openTurn(owner, conversation, TURN_STATUS.SETTLED);
        const second = yield* openTurn(owner, conversation, TURN_STATUS.SETTLED);
        yield* writeTurnRow(owner, conversation, 1, first, MESSAGE_ROLE.USER);
        yield* writeTurnRow(owner, conversation, 2, null, MESSAGE_ROLE.USER);
        yield* writeTurnRow(owner, conversation, 3, first, MESSAGE_ROLE.ASSISTANT);
        yield* writeTurnRow(owner, conversation, 4, second, MESSAGE_ROLE.USER);
        yield* writeTurnRow(owner, conversation, 5, second, MESSAGE_ROLE.USER);
        yield* writeTurnRow(owner, conversation, 6, second, MESSAGE_ROLE.ASSISTANT);

        const read = yield* listTurnOpeners(owner, conversation, {}, [second, first]);
        assert.ok(read.ok);
        assert.deepEqual(
          read.value.map((row) => [row.seq, row.turnId]),
          [
            [1, first],
            [4, second],
          ],
        );
        const foreign = yield* listTurnOpeners(other, conversation, {}, [first, second]);
        assert.ok(foreign.ok);
        assert.deepEqual(foreign.value, []);
      }),
  );

  it.effect(
    "a conversation's subagent sessions are running by their queued or running turns, none once each has settled or for another account",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const parent = yield* openConversation(owner);
        const child = yield* openConversation(owner, parent);
        assert.deepEqual(yield* runningChildTurns(owner, parent), []);

        yield* openTurn(owner, child, TURN_STATUS.SETTLED);
        assert.deepEqual(yield* runningChildTurns(owner, parent), []);
        const running = yield* openTurn(owner, child, TURN_STATUS.RUNNING);
        assert.deepEqual(yield* runningChildTurns(owner, parent), [running]);
        assert.deepEqual(yield* runningChildTurns(other, parent), []);
        assert.deepEqual(yield* runningChildTurns(owner, child), []);
      }),
  );

  it.effect(
    "a coding agent's lines awaiting a turn are read by when the newest was written, a line a turn owns and a task's spoken line are not, and another account reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openAgentConversation(owner);
        const idle = yield* openAgentConversation(owner);
        const task = yield* openConversation(owner);
        const taken = yield* openTurn(owner, idle, TURN_STATUS.SETTLED);
        yield* writeLine(owner, agent, 1, new Date(1_000));
        yield* writeLine(owner, agent, 2, new Date(5_000));
        yield* writeTurnRow(owner, idle, 1, taken, MESSAGE_ROLE.USER);
        yield* writeLine(owner, task, 1, new Date(3_000));

        assert.deepEqual(
          [...(yield* awaitingLinesOf(owner, [agent, idle, task])).entries()],
          [[agent, new Date(5_000)]],
        );
        assert.deepEqual([...(yield* awaitingLinesOf(other, [agent]))], []);
      }),
  );

  it.effect(
    "a Stop made under a key is found by that key in its conversation alone, and a second Stop under another key keeps the first",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const conversation = yield* openConversation(owner);
        const elsewhere = yield* openConversation(owner);
        const writer = yield* storeWriter({ tools: {} });
        const target = { userId: owner, conversationId: conversation };
        const turnId = yield* openTurn(owner, conversation, TURN_STATUS.RUNNING);
        assert.equal(yield* turnStoppedUnderReached(conversation, "call-1"), false);

        yield* writer.requestTurnCancel(target, { turnId, at: new Date(), key: "call-1" });
        yield* writer.requestTurnCancel(target, { turnId, at: new Date(), key: "call-2" });
        assert.equal(yield* turnStoppedUnderReached(conversation, "call-1"), true);
        assert.equal(yield* turnStoppedUnderReached(conversation, "call-2"), false);
        assert.equal(yield* turnStoppedUnderReached(elsewhere, "call-1"), false);
      }),
  );
});
