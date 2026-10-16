import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { listMessagesPast, messageCursorNow, runningChildTurns } from "../message-reads.js";

/**
 * Where a reader of a conversation stands once it has every row, and whether
 * a subagent's session under a conversation still runs, over a real dialect.
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

const writeLine = (userId: string, conversationId: string, seq: number) =>
  Database.use((db) =>
    db.insert(messages).values({
      userId,
      conversationId,
      seq,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: `Line ${seq}` }],
      createdAt: new Date(),
      placedAt: new Date(),
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
});
