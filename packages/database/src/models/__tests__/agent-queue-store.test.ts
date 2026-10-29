import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { LINE_GRACE_MILLIS } from "@luke/features/agent-status";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { turns } from "../../schemas/storage.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  claimQueuedMessage,
  claimQueueHead,
  dropQueuedMessage,
  editQueuedMessage,
  holdQueuedMessage,
  pauseAgentQueue,
  queueAgentMessage,
  readAgentQueue,
  releaseQueuedMessage,
  reorderAgentQueue,
  resumeAgentQueue,
  takeQueuedMessage,
  unpausedQueues,
} from "../agent-queue-store.js";
import { createAgent } from "../agent-store.js";

/**
 * A coding agent's queue over a real dialect: messages queued in order, a
 * repeat under its key queued once; edited, put in a new order, and taken
 * out; paused only over messages and resumed, the last message going taking
 * the pause with it; its head handed on only while unpaused, passing over a
 * message being edited until its edit ends or lapses; a message claimed to
 * send out of every member's change, one at a time; and no account
 * reads or writes the queue of an agent it does not reach. Synthetic
 * accounts and agents throughout.
 */

/** An account holding one agent. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

/** The words of the agent's queue, in order, as its owner reads them. */
function wordsOf(userId: string, agentId: string) {
  return Effect.map(readAgentQueue(userId, agentId), (queue) =>
    Option.getOrThrow(queue).messages.map((message) => message.text),
  );
}

it.layer(getTestDB())("an agent's queue", (it) => {
  it.effect(
    "queues in order, once under a key, and is edited, put in a new order, and taken from",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        const key = randomUUID();
        yield* queueAgentMessage(userId, agentId, { clientKey: key, text: "First" });
        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "Second" });
        yield* queueAgentMessage(userId, agentId, { clientKey: key, text: "First again" });
        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "Third" });
        assert.deepEqual(yield* wordsOf(userId, agentId), ["First", "Second", "Third"]);

        const [first, second, third] = Option.getOrThrow(
          yield* readAgentQueue(userId, agentId),
        ).messages;
        assert.ok(first !== undefined && second !== undefined && third !== undefined);
        yield* editQueuedMessage(userId, agentId, second.id, "Second, reworded");
        assert.deepEqual(
          yield* reorderAgentQueue(userId, agentId, [third.id, first.id]),
          Option.some(false),
          "an order naming other messages than the queue holds is refused",
        );
        yield* reorderAgentQueue(userId, agentId, [third.id, first.id, second.id]);
        assert.deepEqual(yield* wordsOf(userId, agentId), ["Third", "First", "Second, reworded"]);

        const taken = Option.getOrThrow(yield* takeQueuedMessage(userId, agentId, first.id));
        assert.equal(Option.getOrThrow(taken).clientKey, key);
        assert.deepEqual(yield* wordsOf(userId, agentId), ["Third", "Second, reworded"]);
      }),
  );

  it.effect(
    "pauses only over messages, hands on its head only while unpaused, and stands unpaused once the last goes",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        yield* pauseAgentQueue(agentId, QUEUE_PAUSE.STOPPED);
        assert.equal(Option.getOrThrow(yield* readAgentQueue(userId, agentId)).paused, undefined);

        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "First" });
        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "Second" });
        yield* pauseAgentQueue(agentId, QUEUE_PAUSE.REFUSED, "agent-plan-limit-reached");
        yield* pauseAgentQueue(agentId, QUEUE_PAUSE.STOPPED);
        assert.deepEqual(Option.getOrThrow(yield* readAgentQueue(userId, agentId)).paused, {
          because: QUEUE_PAUSE.REFUSED,
          refusal: "agent-plan-limit-reached",
        });
        assert.ok(Option.isNone(yield* claimQueueHead(agentId)), "a paused queue hands on nothing");

        assert.deepEqual(yield* resumeAgentQueue(userId, agentId), Option.some(true));
        // The head claimed and let go of, as a refused send lets it go, so each claim below reads it afresh.
        const claimed = Effect.fn(function* () {
          const head = Option.getOrThrow(yield* claimQueueHead(agentId));
          yield* releaseQueuedMessage(agentId, head.id);
          return head;
        });
        const head = yield* claimed();
        assert.equal(head.text, "First");
        // A message being edited is passed over, keeping its place, until its edit ends or lapses.
        yield* holdQueuedMessage(userId, agentId, head.id, true);
        assert.equal((yield* claimed()).text, "Second");
        yield* holdQueuedMessage(userId, agentId, head.id, false);
        assert.equal((yield* claimed()).text, "First");
        yield* holdQueuedMessage(userId, agentId, head.id, true);
        yield* TestClock.adjust(Duration.millis(LINE_GRACE_MILLIS));
        assert.equal((yield* claimed()).text, "First");
        yield* dropQueuedMessage(agentId, head.id);
        yield* pauseAgentQueue(agentId, QUEUE_PAUSE.TURN_FAILED);
        const [last] = Option.getOrThrow(yield* readAgentQueue(userId, agentId)).messages;
        assert.ok(last !== undefined);
        yield* takeQueuedMessage(userId, agentId, last.id);
        const emptied = Option.getOrThrow(yield* readAgentQueue(userId, agentId));
        assert.deepEqual(emptied.messages, []);
        assert.equal(emptied.paused, undefined);
      }),
  );

  it.effect(
    "a message claimed to send is out of every member's change, one goes at a time, and a claim cut off lapses",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "First" });
        yield* queueAgentMessage(userId, agentId, { clientKey: randomUUID(), text: "Second" });
        const sending = Option.getOrThrow(yield* claimQueueHead(agentId));
        assert.equal(sending.text, "First");
        assert.ok(Option.isNone(yield* claimQueueHead(agentId)), "one message goes at a time");

        // Its member, editing it as it goes, changes nothing of it.
        assert.deepEqual(
          yield* holdQueuedMessage(userId, agentId, sending.id, true),
          Option.some(false),
        );
        assert.deepEqual(
          yield* editQueuedMessage(userId, agentId, sending.id, "First, reworded"),
          Option.some(false),
        );
        assert.deepEqual(
          yield* takeQueuedMessage(userId, agentId, sending.id),
          Option.some(Option.none()),
        );
        const [, second] = Option.getOrThrow(yield* readAgentQueue(userId, agentId)).messages;
        assert.ok(second !== undefined);
        assert.deepEqual(
          yield* reorderAgentQueue(userId, agentId, [second.id, sending.id]),
          Option.some(false),
          "a new order cannot place the message being sent",
        );
        assert.deepEqual(yield* reorderAgentQueue(userId, agentId, [second.id]), Option.some(true));

        // A send cut off before it answered is sent again once its claim lapses.
        yield* TestClock.adjust(Duration.millis(LINE_GRACE_MILLIS));
        assert.equal(Option.getOrThrow(yield* claimQueueHead(agentId)).id, sending.id);
        yield* releaseQueuedMessage(agentId, sending.id);
        assert.deepEqual(
          yield* editQueuedMessage(userId, agentId, sending.id, "First, reworded"),
          Option.some(true),
          "a message let go of is its member's to edit again",
        );
      }),
  );

  it.effect("the queues a sweep hands on leave out an agent at work before their bound", () =>
    Effect.gen(function* () {
      const busy = yield* openAccount;
      const idle = yield* openAccount;
      for (const each of [busy, idle]) {
        yield* queueAgentMessage(each.userId, each.agentId, {
          clientKey: randomUUID(),
          text: "Next",
        });
      }
      const db = yield* Database;
      const [agent] = yield* db
        .select({ conversationId: agentTable.conversationId })
        .from(agentTable)
        .where(eq(agentTable.id, busy.agentId));
      assert.ok(agent !== undefined);
      yield* db.insert(turns).values({
        userId: busy.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.RUNNING,
        queuedAt: new Date(0),
      });

      const swept = (yield* unpausedQueues(1_000)).map((queue) => queue.agentId);

      assert.ok(swept.includes(idle.agentId));
      assert.ok(!swept.includes(busy.agentId), "an agent at work takes none of the sweep's bound");
    }),
  );

  it.effect("no account reads or writes the queue of an agent it does not reach", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      yield* queueAgentMessage(owner.userId, owner.agentId, {
        clientKey: randomUUID(),
        text: "Theirs",
      });
      yield* pauseAgentQueue(owner.agentId, QUEUE_PAUSE.STOPPED);
      const [theirs] = Option.getOrThrow(
        yield* readAgentQueue(owner.userId, owner.agentId),
      ).messages;
      assert.ok(theirs !== undefined);

      assert.ok(Option.isNone(yield* readAgentQueue(other.userId, owner.agentId)));
      assert.ok(
        Option.isNone(
          yield* queueAgentMessage(other.userId, owner.agentId, {
            clientKey: randomUUID(),
            text: "Intruder",
          }),
        ),
      );
      assert.ok(
        Option.isNone(yield* editQueuedMessage(other.userId, owner.agentId, theirs.id, "x")),
      );
      assert.ok(Option.isNone(yield* reorderAgentQueue(other.userId, owner.agentId, [theirs.id])));
      assert.ok(Option.isNone(yield* takeQueuedMessage(other.userId, owner.agentId, theirs.id)));
      assert.ok(Option.isNone(yield* resumeAgentQueue(other.userId, owner.agentId)));
      assert.ok(Option.isNone(yield* claimQueuedMessage(other.userId, owner.agentId, theirs.id)));

      // Nothing the other account tried moved the queue on: its revision is the owner's two changes.
      assert.deepEqual(Option.getOrThrow(yield* readAgentQueue(owner.userId, owner.agentId)), {
        messages: [theirs],
        paused: { because: QUEUE_PAUSE.STOPPED, refusal: undefined },
        revision: 2,
      });
    }),
  );
});
