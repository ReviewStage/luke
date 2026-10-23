import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { asc, eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createCodingAgent } from "../coding-agent-store.js";
import {
  clearNativeRewindHanded,
  REWIND_REFUSAL,
  readNativeRewind,
  readRewindable,
  rewindConversation,
} from "../conversation-rewind.js";

/**
 * A coding agent's conversation cut back to just before one of the
 * developer's lines, over a real dialect: the line and everything after it
 * go, what came before stays, the harness's cut is kept for the next launch,
 * and a line inside a turn, or another account's, is never cut at.
 * Synthetic accounts and conversations throughout.
 */

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations",
    prompt: null,
    repository: null,
  });
  const agent = Option.getOrThrow(started).agent;
  return { userId, conversationId: agent.conversationId };
});

type Target = Effect.Success<typeof openConversation>;

/** A turn queued at the instant given, settled. */
const turnAt = (target: Target, at: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(turns).values({
      id,
      ...target,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: new Date(at),
    });
    return id;
  });

/** A row of the conversation at the sequence given, by the role and turn given; answers its id. */
const rowAt = (
  target: Target,
  seq: number,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
  turnId: string | null,
  at: number,
  takenAfterStep: number | null = null,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(messages).values({
      id,
      ...target,
      seq,
      turnId,
      clientId: `client-${seq}`,
      role,
      parts: [{ type: "text", text: `row ${seq}` }],
      placedAt: new Date(at),
      createdAt: new Date(at),
      takenAfterStep,
    });
    return id;
  });

/** Two answered lines and a third awaiting its turn. */
const threeLines = (target: Target) =>
  Effect.gen(function* () {
    const first = yield* turnAt(target, 1_000);
    const firstLine = yield* rowAt(target, 1, MESSAGE_ROLE.USER, first, 1_000);
    yield* rowAt(target, 2, MESSAGE_ROLE.ASSISTANT, first, 1_001);
    const second = yield* turnAt(target, 2_000);
    const secondLine = yield* rowAt(target, 3, MESSAGE_ROLE.USER, second, 2_000);
    const answer = yield* rowAt(target, 4, MESSAGE_ROLE.ASSISTANT, second, 2_001);
    yield* rowAt(target, 5, MESSAGE_ROLE.USER, null, 3_000);
    return { first, firstLine, second, secondLine, answer };
  });

/** What stands of the conversation: its rows' sequences, its turns, and how it is marked. */
const standing = (target: Target) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.conversationId, target.conversationId))
      .orderBy(asc(messages.seq));
    const turnRows = yield* db
      .select({ id: turns.id, status: turns.status })
      .from(turns)
      .where(eq(turns.conversationId, target.conversationId));
    const [conversation] = yield* db
      .select({
        journalRevision: conversations.journalRevision,
        rewoundRevision: conversations.rewoundRevision,
      })
      .from(conversations)
      .where(eq(conversations.id, target.conversationId));
    return {
      seqs: rows.map((row) => row.seq),
      turns: turnRows.map((row) => row.id),
      statuses: turnRows.map((row) => row.status),
      conversation,
    };
  });

it.layer(getTestDB())("rewinding a coding agent's conversation", (it) => {
  it.effect("drops the line named and everything after it, and keeps what came before", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { first, second, secondLine } = yield* threeLines(target);

      const rewound = yield* rewindConversation(target, secondLine);
      const after = yield* standing(target);

      assert.deepEqual(Result.getOrThrow(rewound), { clientId: "client-3", turnIds: [second] });
      assert.deepEqual(after.seqs, [1, 2]);
      assert.deepEqual(after.turns, [first]);
      assert.deepEqual(after.conversation, { journalRevision: 1, rewoundRevision: 1 });
    }),
  );

  it.effect(
    "cuts at the first line, leaving the conversation empty for the words sent in its place",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { first, firstLine } = yield* threeLines(target);

        const rewound = yield* rewindConversation(target, firstLine);
        const after = yield* standing(target);

        assert.equal(Result.getOrThrow(rewound).clientId, "client-1");
        assert.deepEqual(after.seqs, []);
        // The first turn's row stands, settled and empty, so the agent reads as one that ran rather than one that never started.
        assert.deepEqual(after.turns, [first]);
        assert.deepEqual(after.statuses, [TURN_STATUS.SETTLED]);
        assert.deepEqual(yield* readNativeRewind(target), Option.some("client-1"));
      }),
  );

  it.effect("keeps the line's id for the next launch until it is handed over", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { secondLine } = yield* threeLines(target);

      yield* rewindConversation(target, secondLine);
      const waiting = yield* readNativeRewind(target);
      yield* clearNativeRewindHanded(target.conversationId, "client-3");
      const handed = yield* readNativeRewind(target);

      assert.deepEqual(waiting, Option.some("client-3"));
      assert.deepEqual(handed, Option.none());
    }),
  );

  it.effect("cuts the harness at the earliest heard line, never at one it did not hear", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { firstLine, secondLine } = yield* threeLines(target);

      yield* rewindConversation(target, secondLine);
      yield* rewindConversation(target, firstLine);
      const unheard = yield* rowAt(target, 6, MESSAGE_ROLE.USER, null, 4_000);
      yield* rewindConversation(target, unheard);

      assert.deepEqual(yield* readNativeRewind(target), Option.some("client-1"));
      assert.deepEqual((yield* standing(target)).seqs, []);
    }),
  );

  it.effect("cuts an awaiting line alone, leaving every turn", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { first, second } = yield* threeLines(target);
      const [awaiting] = yield* (yield* Database)
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.clientId, "client-5"));

      const rewound = yield* rewindConversation(target, awaiting?.id ?? "");
      const after = yield* standing(target);

      assert.deepEqual(Result.getOrThrow(rewound).turnIds, []);
      assert.deepEqual(after.seqs, [1, 2, 3, 4]);
      assert.deepEqual(after.turns.toSorted(), [first, second].toSorted());
    }),
  );

  it.effect("refuses a line a turn under way took in, and an agent's answer", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { second, answer } = yield* threeLines(target);
      const steered = yield* rowAt(target, 6, MESSAGE_ROLE.USER, second, 2_002, 1);

      const checked = yield* readRewindable(target, steered);
      const inside = yield* rewindConversation(target, steered);
      const notALine = yield* rewindConversation(target, answer);

      assert.deepEqual(checked, Result.fail(REWIND_REFUSAL.INSIDE_TURN));
      assert.deepEqual(inside, Result.fail(REWIND_REFUSAL.INSIDE_TURN));
      assert.deepEqual(notALine, Result.fail(REWIND_REFUSAL.NOT_FOUND));
      assert.deepEqual((yield* standing(target)).seqs, [1, 2, 3, 4, 5, 6]);
    }),
  );

  it.effect(
    "stamps deleted the workers a dropped turn delegated, and keeps those delegated before it",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { secondLine } = yield* threeLines(target);
        const db = yield* Database;
        const worker = (at: number) =>
          Effect.gen(function* () {
            const id = randomUUID();
            yield* db.insert(conversations).values({
              id,
              userId: target.userId,
              kind: CONVERSATION_KIND.CHILD,
              parentConversationId: target.conversationId,
              createdAt: new Date(at),
            });
            return id;
          });
        const kept = yield* worker(1_500);
        const dropped = yield* worker(2_500);

        yield* rewindConversation(target, secondLine);
        const rows = yield* db
          .select({ id: conversations.id, deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(eq(conversations.parentConversationId, target.conversationId));
        const deleted = new Map(rows.map((row) => [row.id, row.deletedAt !== null]));

        assert.deepEqual([deleted.get(kept), deleted.get(dropped)], [false, true]);
      }),
  );

  it.effect("never cuts another account's conversation", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const stranger = yield* openConversation;
      const { secondLine } = yield* threeLines(target);

      const refused = yield* rewindConversation(
        { userId: stranger.userId, conversationId: target.conversationId },
        secondLine,
      );

      assert.deepEqual(refused, Result.fail(REWIND_REFUSAL.NOT_FOUND));
      assert.deepEqual((yield* standing(target)).seqs, [1, 2, 3, 4, 5]);
    }),
  );
});
