import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { pinCodingAgentCommitted } from "@luke/database/models/coding-agent-store";
import { createTask, updateTaskCommitted } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openTaskAgent,
  openWorkspace,
} from "@luke/database/testing";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { TURN_ORIGIN } from "../core.js";
import { tasksLive } from "./live-queries.js";

/**
 * The task list's live read (`tasksLive`) on the migrated capture: each
 * write that moves an account's task list, through its real writer,
 * notifies a topic the read is woken on, as the read looks its topics up
 * when it is asked for, so a window holding the list hears it within a
 * coalesce window rather than at the hold's end. That holds for the
 * account's own pins, which notify the account under the transaction the
 * pin's answer names, which is what the desktop confirms the pin on; for a
 * teammate's task and its agent's turn in a workspace the account shares,
 * which notify that workspace; and for a membership made or ended, which
 * notifies the account, after which the read looks up the workspaces it
 * stands in now.
 *
 * Synthetic accounts, workspaces, tasks, agents, and turns throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Whether a read on `woken` is woken by a write that notifies `topics`. */
const wokenBy = (topics: readonly SyncTopic[], woken: readonly SyncTopic[]) =>
  topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id));

/**
 * Runs the write, held to the topics it notifies, and fails unless one of
 * them wakes the account's task list, as the held read looked its topics
 * up before the write.
 */
const wakesTheTaskList = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  userId: string,
) =>
  Effect.gen(function* () {
    const woken = yield* tasksLive.topics({ userId });
    const fired = yield* expectTopicsFire(write, topics);
    assert.ok(
      wokenBy(topics, woken),
      "the task list's read is woken by a topic the write notifies",
    );
    return fired;
  });

it.layer(getTestDB())("what moves an account's task list notifies", (it) => {
  it.effect(
    "a task and an agent with no task pinned and unpinned each notify the account under the pin's own transaction",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const workspaceId = yield* openWorkspace(userId);
        const task = yield* createTask(userId, { organizationId: workspaceId, name: "Invites" });
        const agentId = yield* openTaskAgent(userId, workspaceId, null);
        const account: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];

        const taskPinned = yield* wakesTheTaskList(
          updateTaskCommitted(userId, task.id, { pinned: true }),
          account,
          userId,
        );
        const taskPin = Option.getOrElse(taskPinned.value, () => assert.fail("no task pinned"));
        assert.deepEqual(taskPinned.txids, [taskPin.txid]);
        yield* wakesTheTaskList(
          updateTaskCommitted(userId, task.id, { pinned: false }),
          account,
          userId,
        );

        const agentPinned = yield* wakesTheTaskList(
          pinCodingAgentCommitted(userId, agentId, true),
          account,
          userId,
        );
        const agentPin = Option.getOrElse(agentPinned.value, () => assert.fail("no agent pinned"));
        assert.deepEqual(agentPinned.txids, [agentPin.txid]);
        yield* wakesTheTaskList(pinCodingAgentCommitted(userId, agentId, false), account, userId);
      }),
  );

  it.effect(
    "a teammate's task renamed, and a turn of its agent queued, in a workspace the account shares notify that workspace",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        yield* openWorkspace(userId);
        const teammate = yield* openAccount;
        const teamId = yield* openWorkspace(teammate);
        yield* joinWorkspace(teamId, userId);
        const task = yield* createTask(teammate, { organizationId: teamId, name: "Billing" });
        const agentId = yield* openTaskAgent(teammate, teamId, task.id);
        const db = yield* Database;
        const [agent] = yield* db
          .select({ conversationId: codingAgent.conversationId })
          .from(codingAgent)
          .where(eq(codingAgent.id, agentId));
        const conversationId =
          agent?.conversationId ?? assert.fail("the agent has no conversation");
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });

        yield* wakesTheTaskList(
          updateTaskCommitted(teammate, task.id, { name: "Billing retries" }),
          [
            [TOPIC.TASK, task.id],
            [TOPIC.WORKSPACE, teamId],
          ],
          userId,
        );
        yield* wakesTheTaskList(
          writer.enqueueTurn({ userId: teammate, conversationId }, { origin: TURN_ORIGIN.TYPED }),
          [
            [TOPIC.CONVERSATION, conversationId],
            [TOPIC.AGENT, agentId],
            [TOPIC.TASK, task.id],
            [TOPIC.WORKSPACE, teamId],
          ],
          userId,
        );
      }),
  );

  it.effect(
    "a membership made and ended notifies the account, and the read looks up the workspaces it stands in after each",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        yield* openWorkspace(userId);
        const teammate = yield* openAccount;
        const teamId = yield* openWorkspace(teammate);
        const team: SyncTopic = [TOPIC.WORKSPACE, teamId];
        const notified: readonly SyncTopic[] = [team, [TOPIC.ACCOUNT, userId]];

        yield* wakesTheTaskList(joinWorkspace(teamId, userId), notified, userId);
        assert.ok(wokenBy([team], yield* tasksLive.topics({ userId })), "the joined team wakes it");
        yield* wakesTheTaskList(leaveWorkspace(teamId, userId), notified, userId);
        assert.ok(
          !wokenBy([team], yield* tasksLive.topics({ userId })),
          "the team left wakes none",
        );
      }),
  );
});
