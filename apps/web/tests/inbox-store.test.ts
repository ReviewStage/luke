import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxPost,
} from "@sidecar/hosted/inbox-wire";
import { Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import {
  agentInboxItems,
  answerInboxItem,
  closeInboxItem,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  planInboxItems,
  postInboxItem,
  withdrawInboxAnswer,
} from "../server/hosted/inbox-store";
import { createPlan, deletePlan } from "../server/hosted/plan-store";

/**
 * The developer's inbox as the store keeps it, through its public functions
 * against a real dialect: a post under a key is one item, a post under the
 * same key writes it again and opens it, a close takes it back, an answer
 * is taken only at the revision it names while the item is open and can be
 * withdrawn under its key, a read keeps every open item however many others
 * changed, and nothing of another account's is read or written.
 *
 * Synthetic accounts, plans, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one plan and one agent started on it. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openUser;
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    planId: plan.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    task: null,
  });
  assert.ok(Option.isSome(started));
  const agent: InboxAgent = { userId, planId: plan.id, agentId: started.value.agent.id };
  return agent;
});

const QUEUE: InboxPost = {
  key: "invite-queue",
  title: "Which queue sends the invitation emails?",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "The repo already runs **Postgres**." }],
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
};

const SETTINGS: InboxPost = {
  key: "branch-protection",
  title: "Require a review on main",
  response: { type: INBOX_RESPONSE.TASK },
  needsReply: false,
};

it.layer(getTestDB())("the inbox store", (it) => {
  it.effect(
    "a post is one open item; posting under the same key again writes it again, moves its revision on, and opens it once answered",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* postInboxItem(agent, QUEUE);
        assert.ok(Result.isSuccess(posted));
        assert.equal(posted.success.revision, 1);
        assert.equal(posted.success.version, INBOX_WIRE_VERSION);
        assert.deepEqual(posted.success.blocks, QUEUE.blocks);
        assert.deepEqual(posted.success.response, QUEUE.response);
        assert.equal(
          posted.success.needsReply,
          true,
          "an item asks to be heard back unless it says not",
        );
        yield* answerInboxItem(
          agent.userId,
          posted.success.id,
          1,
          { reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          randomUUID(),
        );
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxItem(agent, { ...QUEUE, title: "Which queue, now that Redis is gone?" });
        const items = yield* planInboxItems(agent.userId, agent.planId);
        assert.equal(items.length, 1, "one item per key");
        assert.equal(items[0]?.id, posted.success.id);
        assert.equal(items[0]?.revision, 2);
        assert.equal(items[0]?.status, INBOX_STATUS.OPEN);
        assert.equal(items[0]?.answer, undefined);
      }),
  );

  it.effect(
    "an agent holds at most so many open items, though it may post again under a key it holds and post once it closed one",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        for (let index = 0; index < INBOX_BOUNDS.MAX_OPEN_PER_AGENT; index += 1) {
          assert.ok(
            Result.isSuccess(yield* postInboxItem(agent, { ...SETTINGS, key: `task-${index}` })),
          );
        }
        const over = yield* postInboxItem(agent, { ...SETTINGS, key: "one-more" });
        assert.ok(Result.isFailure(over));
        assert.equal(over.failure, INBOX_POST_REFUSAL.TOO_MANY_OPEN);
        assert.ok(Result.isSuccess(yield* postInboxItem(agent, { ...SETTINGS, key: "task-0" })));
        yield* closeInboxItem(agent, "task-1", "Not needed.");
        assert.ok(Result.isSuccess(yield* postInboxItem(agent, { ...SETTINGS, key: "one-more" })));
      }),
  );

  it.effect(
    "an answer is taken only at the revision it names and only while the item is open, withdrawn only under its own key, and another account's finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const done = { reply: INBOX_REPLY.DONE } as const;
        assert.ok(Option.isNone(yield* answerInboxItem(other, id, 1, done, randomUUID())));
        assert.ok(Option.isNone(yield* answerInboxItem(agent.userId, id, 2, done, randomUUID())));
        const key = randomUUID();
        assert.ok(Option.isSome(yield* answerInboxItem(agent.userId, id, 1, done, key)));
        assert.ok(Option.isNone(yield* withdrawInboxAnswer(agent.userId, id, randomUUID())));
        const reopened = yield* withdrawInboxAnswer(agent.userId, id, key);
        assert.equal(Option.getOrUndefined(reopened)?.status, INBOX_STATUS.OPEN);
        yield* closeInboxItem(agent, SETTINGS.key, "Did it myself.");
        assert.ok(
          Option.isNone(yield* answerInboxItem(agent.userId, id, 2, done, randomUUID())),
          "a closed item takes no answer",
        );
        assert.deepEqual(yield* planInboxItems(other, agent.planId), []);
      }),
  );

  it.effect(
    "an item left open stays in the plan's read and the agent's however many others changed after it, while the settled ones each read carries are bounded",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* postInboxItem(agent, SETTINGS);
        for (let index = 0; index <= INBOX_BOUNDS.MAX_ITEMS_READ; index += 1) {
          yield* TestClock.adjust(Duration.millis(1));
          yield* postInboxItem(agent, { ...QUEUE, key: `queue-${index}` });
          yield* closeInboxItem(agent, `queue-${index}`, "Settled.");
        }
        const plan = yield* planInboxItems(agent.userId, agent.planId);
        assert.ok(
          plan.some((each) => each.key === SETTINGS.key && each.status === INBOX_STATUS.OPEN),
        );
        assert.equal(plan.length, 1 + INBOX_BOUNDS.MAX_ITEMS_READ);
        const own = yield* agentInboxItems(agent);
        assert.equal(own[0]?.key, SETTINGS.key);
        assert.equal(own.length, 1 + INBOX_BOUNDS.MAX_SETTLED_TOLD);
      }),
  );

  it.effect("a plan's items go with the plan", () =>
    Effect.gen(function* () {
      const agent = yield* openAgent;
      yield* postInboxItem(agent, SETTINGS);
      yield* deletePlan(agent.userId, agent.planId);
      assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);
    }),
  );
});
