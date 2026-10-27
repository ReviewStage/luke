import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_ARCHIVER, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { INBOX_ASK_STATUS, INBOX_STATUS } from "@luke/features/inbox-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { inboxItem } from "../../schemas/inbox.js";
import { inboxMessage } from "../../schemas/inbox-message.js";
import { getTestDB, openInboxItem, openTaskAgent, openWorkspace } from "../../testing/index.js";
import {
  archiveCodingAgent,
  archiveIdleCodingAgent,
  archiveUnmovedCodingAgent,
  recordCodingAgentPublished,
} from "../coding-agent-store.js";
import { beginTaskWork, createTask, finishTaskWork, updateTask } from "../task-store.js";

/**
 * An inbox item settles on its own once its reason is gone: its task moved
 * to Done or Canceled, by hand or by the finish, or its agent archived,
 * through the stores' public writes over a real dialect. Every open item of
 * the task or the agent closes with why and its ask stands withdrawn with
 * the same why; an item of another task, agent, or account stands open, and
 * the task reopened or the agent brought back opens nothing again.
 *
 * Synthetic accounts, workspaces, tasks, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A member's task with an agent on it holding a question and a notice open. */
const openTaskWithItems = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, { organizationId });
    const agentId = yield* openTaskAgent(userId, organizationId, taskId);
    const question = yield* openInboxItem(userId, organizationId, taskId, agentId, true);
    const notice = yield* openInboxItem(userId, organizationId, taskId, agentId, false);
    return { taskId, agentId, items: [question, notice] };
  });

/** Where the item stands: its status, who closed it and why, and how each ask of its thread stands. */
const standingOf = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [item] = yield* db
      .select({
        status: inboxItem.status,
        closedReason: inboxItem.closedReason,
        closedBy: inboxItem.closedBy,
        openAsk: inboxItem.openAskMessageId,
      })
      .from(inboxItem)
      .where(eq(inboxItem.id, itemId));
    const messages = yield* db
      .select({ ask: inboxMessage.ask })
      .from(inboxMessage)
      .where(eq(inboxMessage.itemId, itemId));
    return {
      ...(item ?? assert.fail("the item is gone")),
      asks: messages.flatMap(({ ask }) =>
        ask === null ? [] : [{ status: ask.status, withdrawnReason: ask.withdrawnReason }],
      ),
    };
  });

/** The items stand open, each question's ask open too. */
const assertOpen = (itemIds: readonly string[]) =>
  Effect.gen(function* () {
    for (const itemId of itemIds) {
      const standing = yield* standingOf(itemId);
      assert.equal(standing.status, INBOX_STATUS.OPEN);
      for (const ask of standing.asks) assert.equal(ask.status, INBOX_ASK_STATUS.OPEN);
    }
  });

/** The items stand closed by no member, with why, and every ask they held withdrawn with the same why. */
const assertSettled = (itemIds: readonly string[], reason: string) =>
  Effect.gen(function* () {
    for (const itemId of itemIds) {
      const standing = yield* standingOf(itemId);
      assert.equal(standing.status, INBOX_STATUS.CLOSED);
      assert.equal(standing.closedReason, reason);
      assert.equal(standing.closedBy, null);
      assert.equal(standing.openAsk, null);
      for (const ask of standing.asks) {
        assert.deepEqual(ask, { status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: reason });
      }
    }
  });

it.layer(getTestDB())("an inbox item settling with its task", (it) => {
  it.effect(
    "closes a task's open items when a member moves it to done or canceled, and no other task's or account's, and a reopen opens none",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(outsider);
        const shipped = yield* openTaskWithItems(dean, workspace);
        const dropped = yield* openTaskWithItems(dean, workspace);
        const working = yield* openTaskWithItems(dean, workspace);
        const theirs = yield* openTaskWithItems(outsider, elsewhere);

        yield* updateTask(dean, shipped.taskId, { status: TASK_STATUS.DONE });
        yield* updateTask(dean, dropped.taskId, { status: TASK_STATUS.CANCELED });
        yield* updateTask(dean, working.taskId, { status: TASK_STATUS.IN_PROGRESS });

        yield* assertSettled(shipped.items, "Its task is done.");
        yield* assertSettled(dropped.items, "Its task was canceled.");
        yield* assertOpen([...working.items, ...theirs.items]);

        // Reopened, the task's items stay settled.
        assert.equal(yield* beginTaskWork(dean, shipped.taskId), true);
        yield* assertSettled(shipped.items, "Its task is done.");
      }),
  );

  it.effect("closes a task's open notices when Luke finishes its work", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const workspace = yield* openWorkspace(dean);
      const { id: taskId } = yield* createTask(dean, { organizationId: workspace });
      const agentId = yield* openTaskAgent(dean, workspace, taskId);
      yield* recordCodingAgentPublished(dean, agentId, {
        number: 42,
        title: "Teammate invitations",
        url: "https://github.com/acme/api/pull/42",
        state: PULL_REQUEST_STATE.MERGED,
        checks: "passing",
        additions: 10,
        deletions: 2,
        changedFiles: 1,
      });
      const notice = yield* openInboxItem(dean, workspace, taskId, agentId, false);

      assert.equal(yield* finishTaskWork(dean, taskId, () => Effect.succeed(true)), true);
      yield* assertSettled([notice], "Its task is done.");
    }),
  );
});

/** Each store write that archives an agent, archiving the one named as its member. */
const ARCHIVES = [
  {
    name: "an archive by hand",
    archive: (userId: string, agentId: string) => archiveCodingAgent(userId, agentId, true),
  },
  {
    name: "an archive of an idle agent",
    archive: (userId: string, agentId: string) =>
      archiveIdleCodingAgent(userId, agentId, { by: CODING_AGENT_ARCHIVER.MEMBER, userId }, () =>
        Effect.succeed(true),
      ),
  },
  {
    name: "an archive of an agent nothing woke",
    archive: (userId: string, agentId: string) => archiveUnmovedCodingAgent(userId, agentId, 1),
  },
] as const;

it.layer(getTestDB())("an inbox item settling with its agent", (it) => {
  it.effect.each(ARCHIVES)(
    "$name closes the agent's open items, and no other agent's or account's, and bringing it back opens none",
    ({ archive }) =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(outsider);
        const archived = yield* openTaskWithItems(dean, workspace);
        const teammate = yield* openTaskAgent(dean, workspace, archived.taskId);
        const besides = yield* openInboxItem(dean, workspace, archived.taskId, teammate, true);
        const theirs = yield* openTaskWithItems(outsider, elsewhere);

        yield* archive(dean, archived.agentId);

        yield* assertSettled(archived.items, "Its agent was archived.");
        yield* assertOpen([besides, ...theirs.items]);

        yield* archiveCodingAgent(dean, archived.agentId, false);
        yield* assertSettled(archived.items, "Its agent was archived.");
      }),
  );
});
