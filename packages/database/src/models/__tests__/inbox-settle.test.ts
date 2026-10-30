import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_ARCHIVER, AGENT_KIND, PULL_REQUEST_STATE } from "@luke/features/agent-wire";
import { INBOX_ASK_STATUS, INBOX_STATUS } from "@luke/features/inbox-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { inboxItem } from "../../schemas/inbox.js";
import { inboxMessage } from "../../schemas/inbox-message.js";
import { getTestDB, openInboxItem, openTaskAgent, openWorkspace } from "../../testing/index.js";
import {
  archiveAgent,
  archiveIdleAgent,
  archiveOperatorAgent,
  archiveUnmovedAgent,
  readAgent,
  recordAgentPublished,
  restoreOperatorAgent,
  unarchiveAgentFrom,
} from "../agent-store.js";
import { beginTaskWork, createTask, finishTaskWork, updateTask } from "../task-store.js";

/**
 * An inbox item settles on its own once its reason is gone: its task moved
 * to Done or Canceled, by hand or by the finish, or its agent archived,
 * through the stores' public writes over a real dialect. Every open item of
 * the task or the agent that holds an ask closes with why and its ask stands
 * withdrawn with the same why; a notice of theirs, and an item of another
 * task, agent, or account, stands open. The
 * act's opposite, the agent brought back or a member moving the task off
 * Done or Canceled, opens again exactly the items that act settled, its asks
 * open again; Luke reopening the task as a turn starts on it opens nothing.
 *
 * Synthetic accounts, workspaces, tasks, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A member's task with an agent on it holding a question and a notice open: the question as its items, which a settle closes, and the notice beside them, which it leaves. */
const openTaskWithItems = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, { organizationId });
    const agentId = yield* openTaskAgent(userId, organizationId, taskId);
    const question = yield* openInboxItem(userId, organizationId, taskId, agentId, true);
    const notice = yield* openInboxItem(userId, organizationId, taskId, agentId, false);
    return { taskId, agentId, items: [question], notice };
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
    "closes a task's open questions when a member moves it to done or canceled, and no notice of its own or other task's or account's item",
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
        yield* assertOpen([shipped.notice, dropped.notice]);
      }),
  );

  it.effect(
    "opens again exactly the items a move settled when a member moves the task off it, and nothing when a turn reopens it",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const { taskId, agentId, items: first } = yield* openTaskWithItems(dean, workspace);

        // Done, then taken up again by a turn: the first move's items stay settled.
        yield* updateTask(dean, taskId, { status: TASK_STATUS.DONE });
        assert.equal(yield* beginTaskWork(dean, taskId), true);
        yield* assertSettled(first, "Its task is done.");

        // Done again over a later question, then moved back by a member: only that move's item opens.
        yield* TestClock.adjust("1 minute");
        const later = yield* openInboxItem(dean, workspace, taskId, agentId, true);
        yield* updateTask(dean, taskId, { status: TASK_STATUS.DONE });
        yield* updateTask(dean, taskId, { status: TASK_STATUS.IN_PROGRESS });
        yield* assertOpen([later]);
        yield* assertSettled(first, "Its task is done.");

        // Canceled and put back to do, the same way.
        yield* updateTask(dean, taskId, { status: TASK_STATUS.CANCELED });
        yield* assertSettled([later], "Its task was canceled.");
        yield* updateTask(dean, taskId, { status: TASK_STATUS.TODO });
        yield* assertOpen([later]);
      }),
  );

  it.effect("leaves a task's open notices open when Luke finishes its work", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const workspace = yield* openWorkspace(dean);
      const { id: taskId } = yield* createTask(dean, { organizationId: workspace });
      const agentId = yield* openTaskAgent(dean, workspace, taskId);
      yield* recordAgentPublished(dean, agentId, {
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

      const finished = yield* finishTaskWork(
        dean,
        taskId,
        () => Effect.succeed(true),
        (agents) => Effect.succeed(new Set(agents.map(({ id }) => id))),
      );
      assert.equal(Option.isSome(finished), true);
      yield* assertOpen([notice]);
    }),
  );
});

/** The agent's archive as it stands, failing the test where it stands unarchived. */
const archivedAtOf = (userId: string, agentId: string) =>
  Effect.map(
    readAgent(userId, agentId),
    (agent) => Option.getOrUndefined(agent)?.archivedAt ?? assert.fail("the agent is not archived"),
  );

/** Each store write that archives an agent, paired with a write that brings it back, both as its member. */
const ARCHIVES = [
  {
    name: "an archive by hand, undone by hand",
    archive: (userId: string, agentId: string) => archiveAgent(userId, agentId, true),
    unarchive: (userId: string, agentId: string) => archiveAgent(userId, agentId, false),
  },
  {
    name: "an archive of an idle agent, undone from the archive read",
    archive: (userId: string, agentId: string) =>
      archiveIdleAgent(userId, agentId, { by: AGENT_ARCHIVER.MEMBER, userId }, () =>
        Effect.succeed(true),
      ),
    unarchive: (userId: string, agentId: string) =>
      Effect.flatMap(archivedAtOf(userId, agentId), (archivedAt) =>
        unarchiveAgentFrom(userId, agentId, archivedAt),
      ),
  },
  {
    name: "an archive of an agent nothing woke, undone by hand",
    archive: (userId: string, agentId: string) => archiveUnmovedAgent(userId, agentId, 1),
    unarchive: (userId: string, agentId: string) => archiveAgent(userId, agentId, false),
  },
] as const;

it.layer(getTestDB())("an inbox item settling with its agent", (it) => {
  it.effect.each(ARCHIVES)(
    "$name closes the agent's open questions and opens again only those, and no notice of its own or other agent's or account's item",
    ({ archive, unarchive }) =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(outsider);
        const archived = yield* openTaskWithItems(dean, workspace);
        const teammate = yield* openTaskAgent(dean, workspace, archived.taskId);
        const besides = yield* openInboxItem(dean, workspace, archived.taskId, teammate, true);
        const theirs = yield* openTaskWithItems(outsider, elsewhere);
        // An item of the agent's that its task's move settled before, which bringing the agent back leaves settled.
        const shipped = yield* openTaskWithItems(dean, workspace);
        yield* updateTask(dean, shipped.taskId, { status: TASK_STATUS.DONE });

        yield* archive(dean, archived.agentId);
        yield* assertSettled(archived.items, "Its agent was archived.");
        yield* assertOpen([archived.notice, besides, ...theirs.items]);

        yield* unarchive(dean, archived.agentId);
        yield* assertOpen(archived.items);
        yield* assertSettled(shipped.items, "Its task is done.");
      }),
  );

  it.effect(
    "opens again the operator's items its Reset settled when the Reset is undone, settling the one it replaced",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const reset = yield* openTaskAgent(dean, workspace, null, AGENT_KIND.OPERATOR);
        const asked = yield* openInboxItem(dean, workspace, null, reset, true);

        assert.equal(Option.isSome(yield* archiveOperatorAgent(dean, workspace, reset)), true);
        yield* assertSettled([asked], "Its agent was archived.");
        const fresh = yield* openTaskAgent(dean, workspace, null, AGENT_KIND.OPERATOR);
        const freshAsked = yield* openInboxItem(dean, workspace, null, fresh, true);

        assert.equal(
          Option.isSome(yield* restoreOperatorAgent(dean, workspace, reset, fresh)),
          true,
        );
        yield* assertOpen([asked]);
        yield* assertSettled([freshAsked], "Its agent was archived.");
      }),
  );
});

it.layer(getTestDB())("an inbox item settled by both its task and its agent", (it) => {
  it.effect(
    "stays settled while the other act stands, handed to it, and opens once both are undone, in either order",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const workspace = yield* openWorkspace(dean);

        // Done, then the agent archived: moving the task back leaves the item to the archive.
        const doneFirst = yield* openTaskWithItems(dean, workspace);
        yield* updateTask(dean, doneFirst.taskId, { status: TASK_STATUS.DONE });
        yield* archiveAgent(dean, doneFirst.agentId, true);
        yield* updateTask(dean, doneFirst.taskId, { status: TASK_STATUS.IN_PROGRESS });
        yield* assertSettled(doneFirst.items, "Its agent was archived.");
        yield* archiveAgent(dean, doneFirst.agentId, false);
        yield* assertOpen(doneFirst.items);

        // The agent archived, then done: bringing the agent back leaves the item to the task.
        yield* TestClock.adjust("1 minute");
        const archivedFirst = yield* openTaskWithItems(dean, workspace);
        yield* archiveAgent(dean, archivedFirst.agentId, true);
        yield* TestClock.adjust("1 minute");
        yield* updateTask(dean, archivedFirst.taskId, { status: TASK_STATUS.DONE });
        yield* archiveAgent(dean, archivedFirst.agentId, false);
        yield* assertSettled(archivedFirst.items, "Its task is done.");
        yield* updateTask(dean, archivedFirst.taskId, { status: TASK_STATUS.IN_PROGRESS });
        yield* assertOpen(archivedFirst.items);
      }),
  );
});
