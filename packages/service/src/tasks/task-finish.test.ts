import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentPublished,
} from "@luke/database/models/coding-agent-store";
import { readTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { messages, turns } from "@luke/database/schemas/storage";
import { getTestDB, startTask } from "@luke/database/testing";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { INBOX_REPLY, INBOX_RESPONSE, type InboxPost } from "@luke/features/inbox-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Result } from "effect";
import { answerInboxItem, postInboxItem } from "../inbox/inbox-store.js";
import { reopenTaskForWork, settleTaskIfFinished } from "./task-finish.js";

/**
 * A task's status following its agents' work, through the one check the
 * turn's end, the merge read, and the inbox answer ask, against a real
 * dialect: an agent still at work, a turn running or a line awaiting one,
 * keeps the task in progress; its turn settled, with its pull request
 * merged, finishes it; a question an agent posted to the inbox holds it
 * until the developer answers; and an agent's turn starting on a task
 * done takes it up again.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The pull request from the agent's branch, as its row keeps it, standing where `state` says. */
const pullRequestIn = (
  state: typeof PULL_REQUEST_STATE.OPEN | typeof PULL_REQUEST_STATE.MERGED,
) => ({
  number: 42,
  title: "Fix the refresh",
  url: "https://github.com/acme/relay/pull/42",
  state,
  checks: CHECK_SUMMARY.PASSING,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
});

/** An agent the account started on the task an hour ago, past the starting grace. */
const openAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(userId, {
      taskId,
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
    });
    const { agent } = Option.getOrThrow(started);
    const now = yield* Clock.currentTimeMillis;
    const db = yield* Database;
    yield* db
      .update(codingAgent)
      .set({ createdAt: new Date(now - 60 * 60_000) })
      .where(eq(codingAgent.id, agent.id));
    return agent;
  });

/** A turn of the agent's conversation queued ten minutes ago, running or settled as `status` says. */
const turnOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  status: TurnStatus,
) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const db = yield* Database;
    const [row] = yield* db
      .insert(turns)
      .values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt: new Date(now - 10 * 60_000),
        startedAt: new Date(now - 10 * 60_000 + 1000),
        settledAt: status === TURN_STATUS.SETTLED ? new Date(now - 60_000) : null,
      })
      .returning({ id: turns.id });
    return row?.id ?? assert.fail("the turn was not written");
  });

/** The turn settled, as its end leaves it. */
const settle = (turnId: string) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: new Date(now) })
        .where(eq(turns.id, turnId)),
    ),
  );

/** A line of the developer's to the agent, written now, awaiting the turn it opens. */
const awaitingLine = (agent: { readonly userId: string; readonly conversationId: string }) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Database.use((db) =>
      db.insert(messages).values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        seq: 1,
        clientId: randomUUID(),
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Start the next worker." }],
        placedAt: new Date(now),
        createdAt: new Date(now),
        turnId: null,
      }),
    ),
  );

const statusOf = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (read) => Option.getOrThrow(read).task.status);

it.layer(getTestDB())("a task's work finishing", (it) => {
  it.effect(
    "an agent at work, its turn running or a line awaiting one, keeps the task; its turn settled with its pull request merged finishes it",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const worker = yield* openAgent(userId, task.id);
        const orchestrator = yield* openAgent(userId, task.id);
        yield* reopenTaskForWork(userId, task.id);
        yield* recordCodingAgentPublished(
          userId,
          worker.id,
          pullRequestIn(PULL_REQUEST_STATE.MERGED),
        );
        yield* turnOf(orchestrator, TURN_STATUS.SETTLED);
        const running = yield* turnOf(worker, TURN_STATUS.RUNNING);

        yield* settleTaskIfFinished(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.IN_PROGRESS);

        // The worker's turn ended, but it messaged the orchestrator, whose turn is on its way.
        yield* settle(running);
        yield* awaitingLine(orchestrator);
        yield* settleTaskIfFinished(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.IN_PROGRESS);

        // The orchestrator's turn took the line and ended: everyone is idle.
        const next = yield* turnOf(orchestrator, TURN_STATUS.SETTLED);
        yield* Database.use((db) =>
          db
            .update(messages)
            .set({ turnId: next })
            .where(eq(messages.conversationId, orchestrator.conversationId)),
        );
        yield* settleTaskIfFinished(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.DONE);

        // A turn starting on the task takes it up again.
        yield* reopenTaskForWork(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.IN_PROGRESS);
      }),
  );

  it.effect(
    "a question an agent posted holds the task until the developer answers it, and a notice holds nothing",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const agent = yield* openAgent(userId, task.id);
        yield* turnOf(agent, TURN_STATUS.SETTLED);
        yield* recordCodingAgentPublished(
          userId,
          agent.id,
          pullRequestIn(PULL_REQUEST_STATE.MERGED),
        );
        const poster = { userId, taskId: task.id, agentId: agent.id };
        const question: InboxPost = {
          key: "branch-protection",
          title: "Require a review on main",
          response: { type: INBOX_RESPONSE.TODO },
          needsReply: false,
        };
        const notice: InboxPost = {
          key: "merged",
          title: "The refresh fix merged",
          response: { type: INBOX_RESPONSE.NONE },
          needsReply: false,
        };
        const posted = yield* postInboxItem(poster, question);
        assert.ok(Result.isSuccess(posted));
        assert.ok(Result.isSuccess(yield* postInboxItem(poster, notice)));

        yield* settleTaskIfFinished(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.TODO);

        yield* answerInboxItem(
          userId,
          posted.success.id,
          1,
          { reply: INBOX_REPLY.DONE },
          randomUUID(),
        );
        yield* settleTaskIfFinished(userId, task.id);
        assert.equal(yield* statusOf(userId, task.id), TASK_STATUS.DONE);
      }),
  );
});
