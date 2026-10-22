import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { ensureTaskChannel } from "@luke/database/models/chat-store";
import {
  archiveCodingAgent,
  createCodingAgent,
  readCodingAgent,
  recordCodingAgentPublished,
} from "@luke/database/models/coding-agent-store";
import { readTask, updateTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { chatChannel } from "@luke/database/schemas/chat";
import { task } from "@luke/database/schemas/task";
import { getTestDB, migrationStatements, startTask } from "@luke/database/testing";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { INBOX_ASK_STATUS, INBOX_RESPONSE, INBOX_STATUS } from "@luke/features/inbox-wire";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import {
  accountWaitingItems,
  markInboxItemUnread,
  postInboxItem,
  readInboxItem,
} from "@luke/service/inbox/inbox-store";
import { eq } from "drizzle-orm";
import { Effect, Exit, Option, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * task-archive-settle-migration.test.ts -- the migration that settles every archived task into a status, since a task is archived no longer.
 *
 * Over a migrated database holding tasks archived as the old build archived
 * them, the archive stamped on the row and the task's channel, and its
 * agents archived with it: once the migration runs, a task whose agent has
 * a merged pull request stands Done and one with none Canceled, each
 * finished when it was archived, a task already Done keeps that, the
 * archive is cleared, the channel is open again, the agents stay archived,
 * the task's inbox items wait on nobody and read as read, and a settled
 * task never stamped finished is stamped now; a second run changes nothing.
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261021203635_task_archive_settle";

const ARCHIVED_AT = new Date("2026-09-01T09:00:00.000Z");

/** A pull request as GitHub answered it, merged where asked. */
const pullRequest = (merged: boolean) => ({
  number: 42,
  title: "Invite teammates",
  url: "https://github.com/acme/relay/pull/42",
  state: merged ? PULL_REQUEST_STATE.MERGED : PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  ...(merged ? { mergedAt: Date.parse("2026-08-30T12:00:00.000Z") } : undefined),
});

/** The migration's statements, run in one transaction as the migrator runs them; its exit. */
const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const statements = yield* migrationStatements(MIGRATION);
  return yield* Effect.exit(
    sql.withTransaction(Effect.forEach(statements, (statement) => sql.unsafe(statement))),
  );
});

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@luke.test` });
  return userId;
});

/** A task with one agent on it and its chat channel made, the agent's pull request recorded where one is named. */
const openTask = (
  userId: string,
  options: { status?: TaskStatus; merged?: boolean | undefined } = {},
) =>
  Effect.gen(function* () {
    const started = yield* startTask(userId, { name: "Teammate invitations" });
    if (options.status !== undefined) {
      yield* updateTask(userId, started.id, { status: options.status });
    }
    const agent = Option.getOrThrow(
      yield* createCodingAgent(userId, {
        taskId: started.id,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "acme/relay",
        planSnapshot: "# Teammate invitations\n",
        prompt: null,
      }),
    ).agent;
    if (options.merged !== undefined) {
      yield* recordCodingAgentPublished(userId, agent.id, pullRequest(options.merged));
    }
    const channel = Option.getOrThrow(yield* ensureTaskChannel(userId, started.id));
    return { taskId: started.id, agentId: agent.id, channelId: channel.id };
  });

/** The task archived as the old build archived one: the row, its channel, and its agents stamped at the instant given. */
const archivedAsBefore = (userId: string, taskId: string, agentId: string, archivedAt: Date) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.update(task).set({ archivedAt }).where(eq(task.id, taskId));
    yield* db.update(chatChannel).set({ archivedAt }).where(eq(chatChannel.taskId, taskId));
    yield* archiveCodingAgent(userId, agentId, true);
  });

/** Where the task stands: its status and when it was finished as the store reads them, and the archive stamp as the row still holds it, which the store reads no longer. */
const standingOf = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const { status, completedAt } = Option.getOrThrow(yield* readTask(userId, taskId)).task;
    const [row] = yield* Database.use((db) =>
      db.select({ archivedAt: task.archivedAt }).from(task).where(eq(task.id, taskId)),
    );
    return { status, completedAt, archivedAt: row?.archivedAt ?? undefined };
  });

const channelArchivedAt = (channelId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ archivedAt: chatChannel.archivedAt })
        .from(chatChannel)
        .where(eq(chatChannel.id, channelId)),
    ),
    (rows) => rows[0]?.archivedAt,
  );

it.layer(getTestDB())("the migration that settles archived tasks", (it) => {
  it.effect(
    "settles each archived task Done with a merged pull request and Canceled without, finished when it was archived, keeps one already Done, clears the archive, opens the channel, and leaves the agents archived; a second run changes nothing",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const merged = yield* openTask(userId, { merged: true });
        const unmerged = yield* openTask(userId, { merged: false });
        const noAgentPr = yield* openTask(userId);
        const done = yield* openTask(userId, { status: TASK_STATUS.DONE, merged: false });
        const open = yield* openTask(userId, { merged: true });
        const doneBefore = Option.getOrThrow(yield* readTask(userId, done.taskId)).task.completedAt;
        assert.ok(doneBefore !== undefined);
        for (const each of [merged, unmerged, noAgentPr, done]) {
          yield* archivedAsBefore(userId, each.taskId, each.agentId, ARCHIVED_AT);
        }

        assert.ok(Exit.isSuccess(yield* migrate));

        const archivedAt = ARCHIVED_AT.getTime();
        assert.deepEqual(
          yield* Effect.forEach([merged, unmerged, noAgentPr, done, open], (each) =>
            standingOf(userId, each.taskId),
          ),
          [
            { status: TASK_STATUS.DONE, completedAt: archivedAt, archivedAt: undefined },
            { status: TASK_STATUS.CANCELED, completedAt: archivedAt, archivedAt: undefined },
            { status: TASK_STATUS.CANCELED, completedAt: archivedAt, archivedAt: undefined },
            { status: TASK_STATUS.DONE, completedAt: doneBefore, archivedAt: undefined },
            { status: TASK_STATUS.TODO, completedAt: undefined, archivedAt: undefined },
          ],
        );
        assert.deepEqual(
          yield* Effect.forEach([merged, open], (each) => channelArchivedAt(each.channelId)),
          [null, null],
        );
        assert.notEqual(
          Option.getOrThrow(yield* readCodingAgent(userId, merged.agentId)).archivedAt,
          null,
          "the task's agent stays archived",
        );

        assert.ok(Exit.isSuccess(yield* migrate), "the migration runs a second time");
        assert.deepEqual(yield* standingOf(userId, merged.taskId), {
          status: TASK_STATUS.DONE,
          completedAt: archivedAt,
          archivedAt: undefined,
        });
      }),
  );

  it.effect(
    "settles an archived task's open asks as withdrawn and its notices as acknowledged, every item read for every member, so none waits on anyone or reads as new",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { taskId, agentId } = yield* openTask(userId);
        const post = (
          agent: { taskId: string; agentId: string },
          key: string,
          response: Parameters<typeof postInboxItem>[1]["response"],
        ) =>
          Effect.map(
            postInboxItem({ userId, ...agent }, { key, title: `About ${key}`, response }),
            (posted) => Result.getOrThrow(posted).id,
          );
        const ask = yield* post({ taskId, agentId }, "branch-protection", {
          type: INBOX_RESPONSE.APPROVAL,
        });
        const notice = yield* post({ taskId, agentId }, "heads-up", { type: INBOX_RESPONSE.NONE });
        const markedUnread = yield* post({ taskId, agentId }, "another-note", {
          type: INBOX_RESPONSE.NONE,
        });
        yield* markInboxItemUnread(userId, markedUnread);
        yield* archivedAsBefore(userId, taskId, agentId, ARCHIVED_AT);
        // An item on a task that stands is none of the migration's.
        const other = yield* openTask(userId);
        const elsewhere = yield* post(other, "elsewhere", { type: INBOX_RESPONSE.TEXT });

        assert.ok(Exit.isSuccess(yield* migrate));

        const read = (itemId: string) =>
          Effect.map(readInboxItem(userId, itemId), (found) => {
            const { item } = Option.getOrThrow(found);
            const thread = item.thread ?? [];
            return {
              status: item.status,
              unread: item.unread,
              closedReason: item.closedReason,
              reply: item.answer?.reply,
              asks: thread.flatMap((message) =>
                message.ask === undefined ? [] : [message.ask.status],
              ),
            };
          });
        assert.deepEqual(yield* read(ask), {
          status: INBOX_STATUS.CLOSED,
          unread: false,
          closedReason: "The task was archived before this was answered.",
          reply: undefined,
          asks: [INBOX_ASK_STATUS.WITHDRAWN],
        });
        assert.deepEqual(yield* read(notice), {
          status: INBOX_STATUS.ANSWERED,
          unread: false,
          closedReason: undefined,
          reply: "acknowledged",
          asks: [],
        });
        assert.equal(
          (yield* read(markedUnread)).unread,
          false,
          "a member's unread mark is cleared",
        );
        assert.deepEqual(
          (yield* accountWaitingItems(userId)).map((item) => item.id),
          [elsewhere],
          "nothing on the archived task waits on the developer",
        );
      }),
  );

  it.effect("stamps a Done or Canceled task never stamped finished as finished now", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const db = yield* Database;
      const { taskId } = yield* openTask(userId, { status: TASK_STATUS.CANCELED });
      yield* db.update(task).set({ completedAt: null }).where(eq(task.id, taskId));
      assert.equal((yield* standingOf(userId, taskId)).completedAt, undefined);

      assert.ok(Exit.isSuccess(yield* migrate));

      assert.notEqual((yield* standingOf(userId, taskId)).completedAt, undefined);
    }),
  );
});
