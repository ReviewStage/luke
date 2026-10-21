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
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Database, queryBuilder } from "../../core/query.js";
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
  newestAwaitingLineAt,
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
      kind:
        parentConversationId === undefined ? CONVERSATION_KIND.OBSERVED : CONVERSATION_KIND.CHILD,
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

/** A row of a turn carrying the words given, as eve's receipt of a line holds them. */
const writeReceipt = (
  userId: string,
  conversationId: string,
  seq: number,
  turnId: string,
  text: string,
) =>
  Database.use((db) =>
    db.insert(messages).values({
      userId,
      conversationId,
      seq,
      turnId,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text }],
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      createdAt: new Date(),
      placedAt: new Date(),
      finishedAt: new Date(),
    }),
  );

/** The conversation a live statement reads the awaiting line of, under a name of its own so the read's own join of `conversations` is not the one it names. */
const named = alias(conversations, "named");

/** The live statement's fragment for one conversation, as a select of its own, rendered as Realtime takes it. */
const awaitingLineStatement = (conversationId: string) =>
  queryBuilder
    .select({ at: newestAwaitingLineAt(named.id) })
    .from(named)
    .where(eq(named.id, conversationId));

/** When the newest line awaiting its turn in the conversation was written, by the live statement's fragment, in epoch milliseconds; null where none awaits. */
const awaitingLineAt = (conversationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ at: newestAwaitingLineAt(named.id) })
        .from(named)
        .where(eq(named.id, conversationId)),
    ),
    ([row]) => (row?.at === null || row?.at === undefined ? null : new Date(row.at).getTime()),
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

  it.effect(
    "the live statement reads the newest line awaiting its turn, none once a later turn's row carries its words whole or coalesced, and only the conversation named",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const waiting = yield* openAgentConversation(owner);
        const received = yield* openAgentConversation(owner);
        const coalesced = yield* openAgentConversation(owner);
        const foreign = yield* openAgentConversation(other);

        yield* writeLine(owner, waiting, 1, new Date(1_000));
        yield* writeLine(owner, waiting, 2, new Date(5_000));
        const answered = yield* openTurn(owner, waiting, TURN_STATUS.SETTLED);
        // A turn's row carrying other words is no receipt of either line.
        yield* writeReceipt(owner, waiting, 3, answered, "Line 2 and more");

        yield* writeLine(owner, received, 1, new Date(2_000));
        const took = yield* openTurn(owner, received, TURN_STATUS.SETTLED);
        yield* writeReceipt(owner, received, 2, took, "Line 1");

        yield* writeLine(owner, coalesced, 1, new Date(3_000));
        yield* writeLine(owner, coalesced, 2, new Date(4_000));
        const folded = yield* openTurn(owner, coalesced, TURN_STATUS.SETTLED);
        yield* writeReceipt(owner, coalesced, 3, folded, "Line 1\n\nLine 2");

        yield* writeLine(other, foreign, 1, new Date(9_000));

        assert.equal(yield* awaitingLineAt(waiting), 5_000);
        assert.equal(yield* awaitingLineAt(received), null);
        assert.equal(yield* awaitingLineAt(coalesced), null);
        assert.equal(yield* awaitingLineAt(foreign), 9_000);
        assert.deepEqual(
          [...(yield* awaitingLinesOf(owner, [waiting, received, coalesced, foreign])).entries()],
          [[waiting, new Date(5_000)]],
        );
      }),
  );

  it.effect(
    "the live statement finds a conversation's turnless lines through their partial index, in a plan made once for every value it is run with",
    () =>
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient;
        const statement = awaitingLineStatement(randomUUID()).toSQL();
        const values = statement.params.map((value) => `'${String(value)}'`).join(", ");
        // Note that the scan of the whole table is refused, so a table this small still reads as
        // one of millions would, and the plan is generic, as one prepared once and run again is.
        yield* client.unsafe("set enable_seqscan = off");
        yield* client.unsafe("set plan_cache_mode = force_generic_plan");
        yield* client.unsafe(`prepare awaiting_line as ${statement.sql}`);
        const plan = yield* client.unsafe(`explain execute awaiting_line(${values})`);
        yield* client.unsafe("deallocate awaiting_line");
        yield* client.unsafe("reset plan_cache_mode");
        yield* client.unsafe("reset enable_seqscan");

        assert.match(JSON.stringify(plan), /messages_awaiting_line/);
      }),
  );
});
