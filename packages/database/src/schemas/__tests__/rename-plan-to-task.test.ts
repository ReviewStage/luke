import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent, readCodingAgent } from "../../models/coding-agent-store.js";
import { createTask, readTask } from "../../models/task-store.js";
import {
  getTestDB,
  migrationStatements,
  PLAN_TASK_COMPAT,
  RENAME_PLAN_TO_TASK,
  undoneCompat,
  undoneRename,
} from "../../testing/index.js";
import { member, organization, user } from "../auth.js";

/**
 * The migration that names a plan's row a task over a database from before
 * it: a task and an agent are made, the database is walked back to the names
 * it held before (each rename undone, last first), rows are written under
 * those names as an earlier build wrote them, and the migration's own
 * statements are run over it. What was written reads back under the new
 * names. Synthetic accounts and rows throughout.
 */

/** A task in a workspace the account owns, and an agent started on it with a prompt. */
const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const organizationId = randomUUID();
  const now = yield* DateTime.nowAsDate;
  yield* db
    .insert(organization)
    .values({ id: organizationId, name: "Acme", slug: `acme-${organizationId}`, createdAt: now });
  yield* db
    .insert(member)
    .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
  const task = yield* createTask(userId, {
    organizationId,
    name: "Nightly triage",
    repository: "acme/api",
  });
  const started = Option.getOrThrow(
    yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      planSnapshot: null,
      prompt: "Sweep the flaky tests.",
    }),
  );
  return { userId, taskId: task.id, agentId: started.agent.id };
});

it.layer(getTestDB())("the migration that names a plan's row a task", (it) => {
  it.effect(
    "a task and an agent written under the plan's names before it read back under the task's after it, and it renames and drops nothing else",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, taskId, agentId } = yield* openTask;
        const compat = yield* migrationStatements(PLAN_TASK_COMPAT);
        const renames = yield* migrationStatements(RENAME_PLAN_TO_TASK);

        // The database as it stood before the migration, written to as an earlier build wrote it.
        for (const statement of [...compat].reverse()) yield* sql.unsafe(undoneCompat(statement));
        for (const statement of [...renames].reverse()) yield* sql.unsafe(undoneRename(statement));
        yield* sql.unsafe(`UPDATE "plan" SET name = 'Written before' WHERE id = '${taskId}'`);
        yield* sql.unsafe(
          `UPDATE "coding_agent" SET "task" = 'Words written before' WHERE id = '${agentId}' AND "plan_id" = '${taskId}'`,
        );

        for (const statement of renames) yield* sql.unsafe(statement);

        const task = Option.getOrThrow(yield* readTask(userId, taskId));
        const agent = Option.getOrThrow(yield* readCodingAgent(userId, agentId));
        assert.equal(task.task.name, "Written before");
        assert.deepEqual([agent.taskId, agent.prompt], [taskId, "Words written before"]);
      }),
  );
});
