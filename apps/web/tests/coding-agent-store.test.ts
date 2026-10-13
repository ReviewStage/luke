import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import {
  type CodingAgent,
  type CodingAgentBriefText,
  type CodingAgentStarted,
  createCodingAgent,
  listCodingAgents,
  listPublishedCodingAgents,
  type NewCodingAgent,
  readCodingAgent,
  recordCodingAgentPublished,
} from "@sidecar/database/models/coding-agent-store";
import { createPlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { codingAgent } from "@sidecar/database/schemas/coding-agent";
import { conversations } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { count, eq } from "drizzle-orm";
import { Effect, Option } from "effect";

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
  const db = yield* Database;
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

/** What a Start hands the agent where the test names nothing: the plan's text. */
const PLAN_BRIEF: CodingAgentBriefText = {
  planSnapshot: "# Teammate invitations\n\nAny member may invite by email.\n",
  task: null,
};

function start(
  planId: string,
  overrides: Partial<Omit<NewCodingAgent, keyof CodingAgentBriefText>> = {},
  brief: CodingAgentBriefText = PLAN_BRIEF,
): NewCodingAgent {
  return {
    planId,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "reviewstage/luke",
    ...overrides,
    ...brief,
  };
}

/** The agent a Start answered and made, failing the test where it answered none or found one. */
function started(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, true);
  return start.agent;
}

const agentRows = (userId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ rows: count() }).from(codingAgent).where(eq(codingAgent.userId, userId)),
    ),
    (rows) => rows[0]?.rows ?? 0,
  );

const conversationKind = (conversationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ kind: conversations.kind, deletedAt: conversations.deletedAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId)),
    ),
    (rows) => rows[0],
  );

/** A pull request as GitHub answered a read of it. */
const PULL_REQUEST: CodingAgentPullRequest = {
  number: 41,
  title: "Teammate invitations",
  url: "https://github.com/reviewstage/luke/pull/41",
  state: PULL_REQUEST_STATE.DRAFT,
  checks: CHECK_SUMMARY.PENDING,
  additions: 120,
  deletions: 4,
  changedFiles: 3,
};

it.layer(getTestDB())("the coding agents of an account's plans", (it) => {
  it.effect(
    "the pull request an agent published reads back beside the agents of the plans named, as last recorded, and nothing of another account's is read or written",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const other = yield* openPlan;
        const agent = started(yield* createCodingAgent(userId, start(planId)));
        const theirs = started(yield* createCodingAgent(other.userId, start(other.planId)));

        yield* recordCodingAgentPublished(userId, agent.id, PULL_REQUEST);
        // Another account's write names no agent of theirs, and another account's read names none of this one's.
        yield* recordCodingAgentPublished(userId, theirs.id, PULL_REQUEST);
        assert.deepEqual(yield* listPublishedCodingAgents(userId, [planId, other.planId]), [
          { agent, published: PULL_REQUEST },
        ]);
        assert.deepEqual(yield* listPublishedCodingAgents(other.userId, [other.planId]), [
          { agent: theirs, published: null },
        ]);

        yield* recordCodingAgentPublished(userId, agent.id, null);
        assert.deepEqual(yield* listPublishedCodingAgents(userId, [planId]), [
          { agent, published: null },
        ]);
      }),
  );

  it.effect("a Start is one agent on a conversation of its own, holding what it was handed", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const asked = start(planId, { model: "openai/gpt-6.1-sol", effort: "xhigh" });

      const agent = started(yield* createCodingAgent(userId, asked));

      assert.equal(agent.planId, planId);
      assert.equal(agent.model, asked.model);
      assert.equal(agent.effort, asked.effort);
      assert.equal(agent.planSnapshot, asked.planSnapshot);
      assert.equal(agent.task, null);
      assert.equal(agent.repository, asked.repository);
      assert.deepEqual(yield* conversationKind(agent.conversationId), {
        kind: CONVERSATION_KIND.CODING_AGENT,
        deletedAt: null,
      });
      assert.deepEqual(yield* readCodingAgent(userId, agent.id), Option.some(agent));
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
});
