import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { count, eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { codingAgent } from "../server/db/coding-agent-schema";
import { db } from "../server/db/query";
import { conversations } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  type CodingAgent,
  type CodingAgentStarted,
  createCodingAgent,
  listCodingAgents,
  type NewCodingAgent,
  readCodingAgent,
} from "../server/hosted/coding-agent-store";
import { createPlan, deletePlan } from "../server/hosted/plan-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The coding agents of an account's plans, through the store's public
 * functions against a real dialect. What is held to is the shape a Start
 * relies on: one Start is one agent with one `coding_agent` conversation,
 * a retry carrying the same key is that agent and not a second, the tabs
 * read a plan's agents in the order they were started, and nothing of a
 * plan another account owns is read or written.
 *
 * Synthetic accounts, plans, repositories, and keys throughout.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one plan started. */
const openPlan = Effect.gen(function* () {
  const userId = yield* openUser;
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

function start(planId: string, overrides: Partial<NewCodingAgent> = {}): NewCodingAgent {
  return {
    planId,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations\n\nAny member may invite by email.\n",
    repository: "reviewstage/luke",
    ...overrides,
  };
}

/** The agent a Start answered and made, failing the test where it answered none or found one. */
function started(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, true);
  return start.agent;
}

/** The agent a retried Start found, failing the test where it answered none or made one. */
function found(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, false);
  return start.agent;
}

const agentRows = (userId: string) =>
  Effect.map(
    db.select({ rows: count() }).from(codingAgent).where(eq(codingAgent.userId, userId)),
    (rows) => rows[0]?.rows ?? 0,
  );

const conversationKind = (conversationId: string) =>
  Effect.map(
    db
      .select({ kind: conversations.kind, deletedAt: conversations.deletedAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId)),
    (rows) => rows[0],
  );

it.layer(testSqlClient)("the coding agents of an account's plans", (it) => {
  it.effect("a Start is one agent on a conversation of its own, holding what it was handed", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const asked = start(planId, { model: "openai/gpt-6.1-sol", effort: "xhigh" });

      const agent = started(yield* createCodingAgent(userId, asked));

      assert.equal(agent.planId, planId);
      assert.equal(agent.model, asked.model);
      assert.equal(agent.effort, asked.effort);
      assert.equal(agent.planSnapshot, asked.planSnapshot);
      assert.equal(agent.repository, asked.repository);
      assert.deepEqual(yield* conversationKind(agent.conversationId), {
        kind: CONVERSATION_KIND.CODING_AGENT,
        deletedAt: null,
      });
      assert.deepEqual(yield* readCodingAgent(userId, agent.id), Option.some(agent));
      assert.deepEqual(yield* listCodingAgents(userId, planId), [agent]);
    }),
  );

  it.effect("a retry carrying the same key is the same agent, whatever else it carries", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const asked = start(planId);

      const first = started(yield* createCodingAgent(userId, asked));
      yield* TestClock.adjust(Duration.minutes(1));
      const retried = found(
        yield* createCodingAgent(userId, {
          ...asked,
          effort: "max",
          planSnapshot: "# Teammate invitations\n\nEdited since.\n",
        }),
      );

      assert.deepEqual(retried, first);
      assert.equal(yield* agentRows(userId), 1);
      assert.deepEqual(yield* listCodingAgents(userId, planId), [first]);
    }),
  );

  it.effect("each Start with a key of its own is another agent, listed in the order started", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;

      const first = started(yield* createCodingAgent(userId, start(planId)));
      yield* TestClock.adjust(Duration.minutes(1));
      const second = started(yield* createCodingAgent(userId, start(planId)));

      assert.notEqual(second.id, first.id);
      assert.notEqual(second.conversationId, first.conversationId);
      assert.ok(second.createdAt.getTime() > first.createdAt.getTime());
      assert.deepEqual(yield* listCodingAgents(userId, planId), [first, second]);
    }),
  );

  it.effect("a key is the account's own: two accounts may use one", () =>
    Effect.gen(function* () {
      const mine = yield* openPlan;
      const theirs = yield* openPlan;
      const key = randomUUID();

      const myAgent = started(
        yield* createCodingAgent(mine.userId, start(mine.planId, { idempotencyKey: key })),
      );
      const theirAgent = started(
        yield* createCodingAgent(theirs.userId, start(theirs.planId, { idempotencyKey: key })),
      );

      assert.notEqual(theirAgent.id, myAgent.id);
    }),
  );

  it.effect("a plan another account owns starts nothing and reads as no agents", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const other = yield* openUser;
      const agent = started(yield* createCodingAgent(userId, start(planId)));

      assert.deepEqual(yield* createCodingAgent(other, start(planId)), Option.none());
      assert.equal(yield* agentRows(other), 0);
      assert.deepEqual(yield* listCodingAgents(other, planId), []);
      assert.deepEqual(yield* readCodingAgent(other, agent.id), Option.none());
    }),
  );

  it.effect("a plan that does not exist starts nothing", () =>
    Effect.gen(function* () {
      const { userId } = yield* openPlan;
      assert.deepEqual(yield* createCodingAgent(userId, start(randomUUID())), Option.none());
      assert.equal(yield* agentRows(userId), 0);
    }),
  );

  it.effect("an agent goes with its plan, and its conversation is stamped for the purge", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const agent = started(yield* createCodingAgent(userId, start(planId)));
      const kept = started(yield* createCodingAgent(userId, start(planId)));
      yield* TestClock.adjust(Duration.minutes(1));

      assert.equal(yield* deletePlan(userId, planId), true);

      assert.deepEqual(yield* readCodingAgent(userId, agent.id), Option.none());
      assert.equal(yield* agentRows(userId), 0);
      // The raw select reads the instant as each driver hands it back, a Date on
      // PGlite and epoch milliseconds on `pg`, so what is held is that one stands.
      for (const { conversationId } of [agent, kept]) {
        const conversation = yield* conversationKind(conversationId);
        assert.equal(conversation?.kind, CONVERSATION_KIND.CODING_AGENT);
        assert.notEqual(conversation?.deletedAt, null);
      }
    }),
  );
});
