import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent } from "../../models/coding-agent-store.js";
import { createTask, readTask } from "../../models/task-store.js";
import { getTestDB } from "../../testing/index.js";
import { member, organization, user } from "../auth.js";

/**
 * The plan's old names after the rename, as a deployment from before it
 * still reads and writes them: a task and an agent are made under the new
 * names, and statements shaped as the earlier build's Drizzle schema wrote
 * them (`"plan"`, `"plan_id"`, `coding_agent."task"`) answer the same rows.
 * Synthetic accounts and rows throughout.
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
  return { userId, organizationId, taskId: task.id, agentId: started.agent.id };
});

it.layer(getTestDB())("the plan's old names after the rename", (it) => {
  it.effect(
    "an earlier build's reads of an agent and its plan answer the rows the task's names hold",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { organizationId, taskId, agentId } = yield* openTask;

        // The workspace an earlier build admitted an agent's session by, through its plan.
        const [agent] = yield* sql<{
          readonly task: string;
          readonly plan_id: string;
          readonly workspace: string;
        }>`
        SELECT "task", "plan_id",
          coalesce("coding_agent"."organization_id",
            (SELECT "plan"."organization_id" FROM "plan" WHERE "plan"."id" = "coding_agent"."plan_id")) AS workspace
        FROM "coding_agent" WHERE "id" = ${agentId}`;
        assert.deepEqual(
          [agent?.task, agent?.plan_id, agent?.workspace],
          ["Sweep the flaky tests.", taskId, organizationId],
        );
        const swept = yield* sql`
        DELETE FROM "voice_sessions" WHERE "id" IN (SELECT "id" FROM "voice_sessions"
          WHERE "plan_id" IS NOT NULL
            AND NOT EXISTS (SELECT "id" FROM "plan" WHERE "plan"."id" = "voice_sessions"."plan_id"))
        RETURNING "id"`;
        assert.equal(swept.length, 0);
      }),
  );

  it.effect(
    "an earlier build's writes to a plan, its pin, and its board land on the task's rows",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, taskId } = yield* openTask;

        yield* sql`SELECT "id" FROM "plan" WHERE "id" = ${taskId} FOR UPDATE`;
        yield* sql`UPDATE "plan" SET "name" = 'Renamed by an earlier build' WHERE "id" = ${taskId}`;
        for (const position of ["a0", "a1"]) {
          yield* sql`
          INSERT INTO "plan_pin" ("user_id", "plan_id", "position", "pinned_at") VALUES (${userId}, ${taskId}, ${position}, now())
          ON CONFLICT ("user_id", "plan_id") DO UPDATE SET "position" = excluded."position"`;
        }
        yield* sql`
        INSERT INTO "plan_board" ("plan_id", "elements", "updated_at") VALUES (${taskId}, '[]'::jsonb, now())
        ON CONFLICT ("plan_id") DO UPDATE SET "updated_at" = excluded."updated_at"`;

        const task = Option.getOrThrow(yield* readTask(userId, taskId));
        const pins = yield* sql<{ readonly position: string }>`
        SELECT "position" FROM "task_pin" WHERE "user_id" = ${userId} AND "task_id" = ${taskId}`;
        const boards = yield* sql`SELECT 1 FROM "task_board" WHERE "task_id" = ${taskId}`;
        assert.deepEqual(
          [task.task.name, pins.map((pin) => pin.position), boards.length],
          ["Renamed by an earlier build", ["a1"], 1],
        );
      }),
  );
});
