import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { recordRepositoryReads } from "@luke/database/models/github-repository-reads";
import { readGitHubTokenRow, removeGitHubToken } from "@luke/database/models/github-token-store";
import { setRepositoryPin } from "@luke/database/models/repository-pin-store";
import { writeTaskSections } from "@luke/database/models/task-section-store";
import { createTask, deleteTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  expectTopicsFire,
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openTaskAgent,
  openWorkspace,
} from "@luke/database/testing";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { TASK_SECTION_WRITE, type TaskSectionWrite } from "@luke/features/task-section-wire";
import { Clock, Effect, Option } from "effect";
import { openTokenMember } from "../testing/github-app-fake.js";
import { sidebarLive } from "./live-queries.js";

/**
 * The sidebar's live read (`sidebarLive`) on the migrated capture: each
 * write that moves an account's sidebar, through its real writer, notifies
 * the account's topic, which the read is woken on, so a window holding the
 * sidebar hears it within a coalesce window rather than at the hold's end.
 * That holds for the account's own sections, entries, and pins, for a task
 * deleted from under another member's section, and for what admits the
 * account to a workspace or a repository. A section's write is notified
 * under the transaction its answer names, which is what the desktop
 * confirms the write on.
 *
 * Synthetic accounts, workspaces, sections, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A section write the test expects taken, answering the transaction it wrote in. */
const sectionWrite = (userId: string, write: TaskSectionWrite) =>
  Effect.map(writeTaskSections(userId, write), (answer) =>
    Option.getOrElse(answer, () => assert.fail("the write was refused")),
  );

/** Runs the write, held to the topics it notifies, and fails unless one of them wakes the account's sidebar. */
const wakesTheSidebar = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  userId: string,
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    const woken = sidebarLive.topics({ userId });
    assert.ok(
      topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
      "the sidebar's read is woken by a topic the write notifies",
    );
    return fired;
  });

it.layer(getTestDB())("what moves an account's sidebar notifies", (it) => {
  it.effect(
    "a section made, renamed, given a task and an agent, and deleted, and a repository pinned, each notify the account under the write's own transaction",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const workspaceId = yield* openWorkspace(userId);
        const task = yield* createTask(userId, { organizationId: workspaceId, name: "Invites" });
        const agentId = yield* openTaskAgent(userId, workspaceId, null);
        const sectionId = randomUUID();
        const account: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];

        const made = yield* wakesTheSidebar(
          sectionWrite(userId, {
            kind: TASK_SECTION_WRITE.CREATE,
            id: sectionId,
            workspaceId,
            title: "Now",
          }),
          account,
          userId,
        );
        assert.ok(made.value.txid !== undefined, "a write that moved a row names its transaction");
        assert.deepEqual(made.txids, [made.value.txid]);

        yield* wakesTheSidebar(
          sectionWrite(userId, {
            kind: TASK_SECTION_WRITE.EDIT,
            id: sectionId,
            title: "Next",
            icon: null,
          }),
          account,
          userId,
        );
        yield* wakesTheSidebar(
          sectionWrite(userId, { kind: TASK_SECTION_WRITE.PLACE, taskId: task.id, sectionId }),
          account,
          userId,
        );
        yield* wakesTheSidebar(
          sectionWrite(userId, { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId, sectionId }),
          account,
          userId,
        );
        yield* wakesTheSidebar(setRepositoryPin(userId, "acme/api", true), account, userId);
        yield* wakesTheSidebar(
          sectionWrite(userId, { kind: TASK_SECTION_WRITE.DELETE, id: sectionId }),
          account,
          userId,
        );
      }),
  );

  it.effect(
    "a task deleted from under a teammate's section notifies the teammate, through the entry it leaves",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        yield* joinWorkspace(workspaceId, teammate);
        const task = yield* createTask(owner, { organizationId: workspaceId, name: "Billing" });
        const sectionId = randomUUID();
        yield* sectionWrite(teammate, {
          kind: TASK_SECTION_WRITE.CREATE,
          id: sectionId,
          workspaceId,
          title: "Watching",
        });
        yield* sectionWrite(teammate, {
          kind: TASK_SECTION_WRITE.PLACE,
          taskId: task.id,
          sectionId,
        });

        yield* wakesTheSidebar(
          deleteTask(owner, task.id),
          [
            [TOPIC.TASK, task.id],
            [TOPIC.WORKSPACE, workspaceId],
            [TOPIC.ACCOUNT, teammate],
          ],
          teammate,
        );
      }),
  );

  it.effect(
    "a teammate's membership of the workspace, and the GitHub token they reach a task's repository on, notify the teammate as each moves",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        yield* createTask(owner, {
          organizationId: workspaceId,
          name: "On a token",
          repository: "acme/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const teammate = yield* openTokenMember();
        yield* joinWorkspace(workspaceId, teammate);
        const sealed = (yield* readGitHubTokenRow(teammate))?.sealedToken ?? "";
        const now = new Date(yield* Clock.currentTimeMillis);
        const teammateTopic: SyncTopic = [TOPIC.ACCOUNT, teammate];

        yield* wakesTheSidebar(
          recordRepositoryReads(
            teammate,
            sealed,
            [{ repository: "acme/side", readable: true }],
            now,
          ),
          [teammateTopic],
          teammate,
        );
        yield* wakesTheSidebar(removeGitHubToken(teammate), [teammateTopic], teammate);
        yield* wakesTheSidebar(
          leaveWorkspace(workspaceId, teammate),
          [teammateTopic, [TOPIC.WORKSPACE, workspaceId]],
          teammate,
        );
      }),
  );
});
