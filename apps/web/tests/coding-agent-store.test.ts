import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import {
  archiveCodingAgent,
  type CodingAgent,
  type CodingAgentBriefText,
  type CodingAgentStarted,
  createCodingAgent,
  listCodingAgents,
  listPublishedCodingAgents,
  liveKeeperOf,
  liveWorkerAtPosition,
  type NewCodingAgent,
  readCodingAgent,
  readCodingAgentOfConversation,
  recordCodingAgentPublished,
  renameCodingAgent,
  updateCodingAgentChoice,
} from "@sidecar/database/models/coding-agent-store";
import { user } from "@sidecar/database/schemas/auth";
import { codingAgent } from "@sidecar/database/schemas/coding-agent";
import { conversations, messages, turns } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  ROLLOUT_ROLE,
} from "@sidecar/hosted/coding-agent-wire";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@sidecar/wire";
import { count, eq } from "drizzle-orm";
import { DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { CODER } from "../server/hosted/coder-host/bounds";
import { codingAgentStatusOf } from "../server/hosted/coder-host/status";
import { joinWorkspace, startPlan } from "./support/workspaces";

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

/** The agent a Start answered and found already made, failing the test where it answered none or made one. */
function found(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, false);
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

/** A turn of the agent's own conversation, queued now, so a later one is its newest. */
const recordTurn = (userId: string, agent: CodingAgent, status: TurnStatus) =>
  Effect.gen(function* () {
    const queuedAt = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(turns).values({
        userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt,
      }),
    );
    yield* TestClock.adjust(Duration.seconds(1));
  });

/** A line of the developer's the agent's session took, with no turn yet to receive it. */
const recordWaitingLine = (userId: string, agent: CodingAgent) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(messages).values({
        userId,
        conversationId: agent.conversationId,
        seq: 1,
        clientId: randomUUID(),
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Open the pull request for the invite table." }],
        createdAt: now,
        placedAt: now,
      }),
    );
  });

/** A pull request as GitHub answered a read of it. */
const PULL_REQUEST: CodingAgentPullRequest = {
  number: 41,
  title: "Teammate invitations",
  url: "https://github.com/reviewstage/luke/pull/41",
  state: PULL_REQUEST_STATE.DRAFT,
  checks: CHECK_SUMMARY.PENDING,
  base: "main",
  mergedSha: null,
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

  it.effect(
    "an agent one member started is listed, read, renamed, and re-chosen by another, a non-member reaches none, and a retry key is the starter's own",
    () =>
      Effect.gen(function* () {
        const starter = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const plan = yield* startPlan(starter, { name: "Teammate invitations" });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const asked = start(plan.id);
        const agent = started(yield* createCodingAgent(starter, asked));
        assert.equal(agent.userId, starter);

        assert.deepEqual(yield* listCodingAgents(teammate, plan.id), [agent]);
        assert.deepEqual(yield* listPublishedCodingAgents(teammate, [plan.id]), [
          { agent, published: null },
        ]);
        assert.deepEqual(yield* readCodingAgent(teammate, agent.id), Option.some(agent));
        assert.deepEqual(
          yield* readCodingAgentOfConversation(teammate, agent.conversationId),
          Option.some(agent),
        );
        const renamed = yield* renameCodingAgent(teammate, agent.id, "Invite emails");
        assert.equal(Option.getOrUndefined(renamed)?.title, "Invite emails");
        const chosen = yield* updateCodingAgentChoice(teammate, agent.id, {
          model: "openai/gpt-5.5",
          effort: "low",
        });
        assert.equal(Option.getOrUndefined(chosen)?.model, "openai/gpt-5.5");
        assert.equal(
          Option.getOrUndefined(yield* readCodingAgent(starter, agent.id))?.title,
          "Invite emails",
        );

        // The teammate's Start under the starter's key is a Start of their own, and the starter's retry still finds theirs.
        const theirs = started(
          yield* createCodingAgent(
            teammate,
            start(plan.id, { idempotencyKey: asked.idempotencyKey }),
          ),
        );
        assert.notEqual(theirs.id, agent.id);
        assert.equal(theirs.userId, teammate);
        assert.equal(found(yield* createCodingAgent(starter, asked)).id, agent.id);

        assert.deepEqual(yield* listCodingAgents(stranger, plan.id), []);
        assert.deepEqual(yield* listPublishedCodingAgents(stranger, [plan.id]), []);
        assert.deepEqual(yield* readCodingAgent(stranger, agent.id), Option.none());
        assert.deepEqual(
          yield* readCodingAgentOfConversation(stranger, agent.conversationId),
          Option.none(),
        );
        assert.deepEqual(yield* renameCodingAgent(stranger, agent.id, "Taken"), Option.none());
        assert.deepEqual(
          yield* updateCodingAgentChoice(stranger, agent.id, { model: "x/y", effort: "low" }),
          Option.none(),
        );
        assert.deepEqual(yield* createCodingAgent(stranger, start(plan.id)), Option.none());
      }),
  );

  it.effect(
    "a Start at a rollout position holds its role, position, and base, and the plan lists its builders first by position, then the rest in the order started",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const plain = started(yield* createCodingAgent(userId, start(planId)));
        yield* TestClock.adjust(Duration.minutes(1));
        const second = started(
          yield* createCodingAgent(
            userId,
            start(planId, {
              role: ROLLOUT_ROLE.BUILDER,
              position: 2,
              baseBranch: "luke/teammate-invitations/1-table",
            }),
          ),
        );
        yield* TestClock.adjust(Duration.minutes(1));
        const first = started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 1 }),
          ),
        );

        assert.equal(plain.role, null);
        assert.equal(second.role, ROLLOUT_ROLE.BUILDER);
        assert.equal(plain.position, null);
        assert.equal(plain.baseBranch, null);
        assert.equal(second.position, 2);
        assert.equal(second.baseBranch, "luke/teammate-invitations/1-table");
        assert.equal(first.position, 1);
        assert.equal(first.baseBranch, null);
        assert.deepEqual(yield* readCodingAgent(userId, second.id), Option.some(second));
        assert.deepEqual(yield* listCodingAgents(userId, planId), [first, second, plain]);
      }),
  );

  it.effect(
    "a position's live worker is the newest not archived whose newest turn neither failed nor was stopped, and a settled one still holds it",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const other = yield* openUser;
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.none());

        const failed = started(yield* createCodingAgent(userId, start(planId, { position: 1 })));
        // Before its first turn a worker already holds its position.
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(failed));
        yield* recordTurn(userId, failed, TURN_STATUS.SETTLED);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(failed));
        yield* recordTurn(userId, failed, TURN_STATUS.FAILED);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.none());

        const stopped = started(yield* createCodingAgent(userId, start(planId, { position: 1 })));
        yield* recordTurn(userId, stopped, TURN_STATUS.RUNNING);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(stopped));
        yield* recordTurn(userId, stopped, TURN_STATUS.CANCELLED);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.none());

        const restarted = started(yield* createCodingAgent(userId, start(planId, { position: 1 })));
        yield* recordTurn(userId, restarted, TURN_STATUS.SETTLED);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(restarted));
        // Another position, an agent outside the rollout, and another account hold nothing here.
        started(yield* createCodingAgent(userId, start(planId)));
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 2), Option.none());
        assert.deepEqual(yield* liveWorkerAtPosition(other, planId, 1), Option.none());

        // A worker the developer archived holds its position no longer, and holds it again once brought back.
        yield* archiveCodingAgent(userId, restarted.id, true);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.none());
        yield* archiveCodingAgent(userId, restarted.id, false);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(restarted));
      }),
  );

  it.effect(
    "a rollout has one live keeper: a second Start is refused and makes nothing, and one that failed or was stopped frees the place",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.none());

        const keeper = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        assert.equal(keeper.role, ROLLOUT_ROLE.KEEPER);
        assert.equal(keeper.position, null);
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(keeper));

        const refused = yield* Effect.flip(
          createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        assert.equal(refused._tag, "KeeperTaken");
        assert.equal(yield* agentRows(userId), 1);
        // A builder is no keeper, so it starts beside the live one.
        started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 1 }),
          ),
        );

        yield* recordTurn(userId, keeper, TURN_STATUS.FAILED);
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.none());
        const restarted = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(restarted));

        yield* recordTurn(userId, restarted, TURN_STATUS.CANCELLED);
        const third = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        yield* recordTurn(userId, third, TURN_STATUS.SETTLED);
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(third));
      }),
  );

  it.effect(
    "an account reads no keeper of another's plan, and starting its own keeper is never refused for another's",
    () =>
      Effect.gen(function* () {
        const mine = yield* openPlan;
        const theirs = yield* openPlan;
        const keeper = started(
          yield* createCodingAgent(mine.userId, start(mine.planId, { role: ROLLOUT_ROLE.KEEPER })),
        );

        assert.deepEqual(yield* liveKeeperOf(theirs.userId, mine.planId), Option.none());
        assert.deepEqual(
          yield* createCodingAgent(
            theirs.userId,
            start(mine.planId, { role: ROLLOUT_ROLE.KEEPER }),
          ),
          Option.none(),
        );
        const their = started(
          yield* createCodingAgent(
            theirs.userId,
            start(theirs.planId, { role: ROLLOUT_ROLE.KEEPER }),
          ),
        );
        assert.deepEqual(yield* liveKeeperOf(theirs.userId, theirs.planId), Option.some(their));
        assert.deepEqual(yield* liveKeeperOf(mine.userId, mine.planId), Option.some(keeper));
      }),
  );

  it.effect(
    "a builder or keeper that never ran a turn holds its place through the starting grace and frees it once the grace is past",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const builder = started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 1 }),
          ),
        );
        const keeper = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );

        yield* TestClock.adjust(CODER.STARTING_GRACE);
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(builder));
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(keeper));
        const refused = yield* Effect.flip(
          createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        assert.equal(refused._tag, "KeeperTaken");

        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.none());
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.none());

        // Each place is free for a replacement, which holds it from its own start.
        const keeperAgain = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        const builderAgain = started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 1 }),
          ),
        );
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(keeperAgain));
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(builderAgain));
      }),
  );

  it.effect(
    "past the starting grace, a builder or keeper whose first line still waits on its turn reads running and holds its place, and one with nothing waiting frees it",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const waiting = started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 1 }),
          ),
        );
        started(
          yield* createCodingAgent(
            userId,
            start(planId, { role: ROLLOUT_ROLE.BUILDER, position: 2 }),
          ),
        );
        const keeper = started(
          yield* createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        yield* recordWaitingLine(userId, waiting);
        yield* recordWaitingLine(userId, keeper);

        yield* TestClock.adjust(Duration.sum(CODER.STARTING_GRACE, Duration.seconds(1)));
        const now = (yield* DateTime.nowAsDate).getTime();
        assert.equal(
          codingAgentStatusOf(undefined, { createdAt: waiting.createdAt, now, lineAwaits: true }),
          CODING_AGENT_STATUS.RUNNING,
        );
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 1), Option.some(waiting));
        assert.deepEqual(yield* liveKeeperOf(userId, planId), Option.some(keeper));
        const refused = yield* Effect.flip(
          createCodingAgent(userId, start(planId, { role: ROLLOUT_ROLE.KEEPER })),
        );
        assert.equal(refused._tag, "KeeperTaken");
        assert.deepEqual(yield* liveWorkerAtPosition(userId, planId, 2), Option.none());
      }),
  );
});
