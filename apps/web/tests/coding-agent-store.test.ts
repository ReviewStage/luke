import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  type CodingAgent,
  type CodingAgentBriefText,
  type CodingAgentStarted,
  createCodingAgent,
  listCodingAgents,
  listPublishedCodingAgents,
  type NewCodingAgent,
  readCodingAgent,
  readCodingAgentContext,
  readCodingAgentOfConversation,
  recordCodingAgentPublished,
  updateCodingAgentChoice,
  updateCodingAgentServers,
} from "@sidecar/database/models/coding-agent-store";
import { deletePlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { codingAgent } from "@sidecar/database/schemas/coding-agent";
import { conversations } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import {
  CHECK_SUMMARY,
  CONTEXT_WINDOW,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { count, eq, sql } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { startPlan } from "./support/workspaces";

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
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
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

  it.effect(
    "an agent runs on its model's whole window unless its Start or a later change names the standard one, which a change naming none takes back",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const long = started(yield* createCodingAgent(userId, start(planId)));
        assert.equal(long.contextWindow, CONTEXT_WINDOW.LONG);

        const standard = started(
          yield* createCodingAgent(
            userId,
            start(planId, { model: "openai/gpt-5.5", contextWindow: CONTEXT_WINDOW.STANDARD }),
          ),
        );
        assert.equal(standard.contextWindow, CONTEXT_WINDOW.STANDARD);
        const context = yield* readCodingAgentContext(userId, standard.id);
        assert.equal(Option.getOrUndefined(context)?.contextWindow, CONTEXT_WINDOW.STANDARD);

        const changed = yield* updateCodingAgentChoice(userId, long.id, {
          model: "openai/gpt-5.5",
          effort: "high",
          contextWindow: CONTEXT_WINDOW.STANDARD,
        });
        assert.equal(Option.getOrUndefined(changed)?.contextWindow, CONTEXT_WINDOW.STANDARD);
        yield* updateCodingAgentChoice(userId, long.id, {
          model: "openai/gpt-5.5",
          effort: "low",
        });
        const read = yield* readCodingAgent(userId, long.id);
        assert.equal(Option.getOrUndefined(read)?.contextWindow, CONTEXT_WINDOW.LONG);
        assert.equal(Option.getOrUndefined(read)?.effort, "low");
      }),
  );

  it.effect(
    "the MCP servers switched off for an agent read back on it, from its Start or a later change, and another account's change writes nothing",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const other = yield* openUser;
        const agent = started(yield* createCodingAgent(userId, start(planId)));
        assert.deepEqual(agent.disabledServers, []);
        const drafted = started(
          yield* createCodingAgent(
            userId,
            start(planId, { disabledServers: [INTEGRATION_PROVIDER.LINEAR] }),
          ),
        );
        assert.deepEqual(drafted.disabledServers, [INTEGRATION_PROVIDER.LINEAR]);

        const changed = yield* updateCodingAgentServers(userId, agent.id, [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
        assert.deepEqual(Option.getOrUndefined(changed)?.disabledServers, [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
        assert.deepEqual(yield* updateCodingAgentServers(other, drafted.id, []), Option.none());
        const ofConversation = yield* readCodingAgentOfConversation(userId, agent.conversationId);
        assert.deepEqual(Option.getOrUndefined(ofConversation)?.disabledServers, [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
        const untouched = yield* readCodingAgent(userId, drafted.id);
        assert.deepEqual(Option.getOrUndefined(untouched)?.disabledServers, [
          INTEGRATION_PROVIDER.LINEAR,
        ]);

        yield* updateCodingAgentServers(userId, agent.id, []);
        const cleared = yield* readCodingAgent(userId, agent.id);
        assert.deepEqual(Option.getOrUndefined(cleared)?.disabledServers, []);
      }),
  );

  it.effect(
    "a server no longer offered, left on an agent's row, reads as nothing switched off",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const agent = started(yield* createCodingAgent(userId, start(planId)));
        yield* db
          .update(codingAgent)
          .set({ disabledServers: sql`'["retired-provider", "linear"]'::jsonb` })
          .where(eq(codingAgent.id, agent.id));

        const read = yield* readCodingAgent(userId, agent.id);
        assert.deepEqual(Option.getOrUndefined(read)?.disabledServers, [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
      }),
  );

  it.effect("a Start on a task holds the task it was handed and no copy of the plan", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const task = "Rename the invite email's subject to say who sent it.";

      const agent = started(
        yield* createCodingAgent(userId, start(planId, {}, { planSnapshot: null, task })),
      );

      assert.equal(agent.task, task);
      assert.equal(agent.planSnapshot, null);
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
        yield* createCodingAgent(
          userId,
          start(
            planId,
            { idempotencyKey: asked.idempotencyKey, effort: "max" },
            { planSnapshot: "# Teammate invitations\n\nEdited since.\n", task: null },
          ),
        ),
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

  it.effect(
    "a delete told which agents it stopped refuses while another stands and runs nothing before it, and once each is named runs its step on the agents' conversations and takes the plan",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const stoppedAgent = started(yield* createCodingAgent(userId, start(planId)));
        // Started while the delete was stopping the others, so the delete never stopped it.
        const raced = started(yield* createCodingAgent(userId, start(planId)));
        const handed: (readonly string[])[] = [];
        const guard = (stoppedAgentIds: ReadonlySet<string>) => ({
          stoppedAgentIds,
          beforeDelete: (conversationIds: readonly string[]) =>
            Effect.sync(() => {
              handed.push(conversationIds);
            }),
        });

        const refused = yield* Effect.flip(
          deletePlan(userId, planId, guard(new Set([stoppedAgent.id]))),
        );

        assert.equal(refused._tag, "PlanAgentUnstopped");
        assert.equal(yield* agentRows(userId), 2);
        assert.deepEqual(handed, []);
        assert.equal(
          yield* deletePlan(userId, planId, guard(new Set([stoppedAgent.id, raced.id]))),
          true,
        );
        assert.equal(yield* agentRows(userId), 0);
        assert.deepEqual(
          handed.map((ids) => [...ids].sort()),
          [[stoppedAgent.conversationId, raced.conversationId].sort()],
        );
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
