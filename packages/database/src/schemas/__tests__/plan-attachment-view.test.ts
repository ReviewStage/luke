import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { readPlanAttachment } from "../../models/plan-attachments.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements } from "../../testing/index.js";
import { bytea, timestamptz } from "../_helpers.js";
import { attachment } from "../attachment.js";
import { member, organization, user } from "../auth.js";
import { task } from "../task.js";

/**
 * The migration that moved a plan's pictures into `attachment` and left
 * `plan_attachment` as a view over it: a database from before it keeps every
 * picture, which this code serves, and every query
 * a deployment from before it runs against `plan_attachment`, spelled as that
 * deployment's code spelled it, reads and writes the pictures in `attachment`
 * that this code reads. Synthetic accounts, plans, and pictures throughout.
 */

const MIGRATION = "20261019203041_plan_attachment_into_attachment";

/** `plan_attachment` as the code before the migration declared it. */
const planAttachment = pgTable("plan_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  userId: text("user_id"),
  contentType: text("content_type").notNull(),
  byteCount: integer("byte_count").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamptz("created_at").notNull(),
  savedAt: timestamptz("saved_at"),
});

/** The table as it stood before the migration. */
const OLD_TABLE = `CREATE TABLE "plan_attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL REFERENCES "task"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "content_type" text NOT NULL,
  "byte_count" integer NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "saved_at" timestamp with time zone
)`;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

/** A plan in a workspace the account owns, its account, and its workspace. */
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
  const made = yield* createTask(userId, { organizationId, name: "Invite flow" });
  return { userId, organizationId, taskId: made.id, now };
});

type Plan = Effect.Success<typeof openTask>;

/** A picture of the plan's as the code before the migration wrote it. */
const oldPicture = (plan: Plan, bytes = PNG) => ({
  id: randomUUID(),
  taskId: plan.taskId,
  userId: plan.userId,
  contentType: PICTURE_TYPE.PNG,
  byteCount: bytes.byteLength,
  bytes,
  createdAt: plan.now,
});

/** What `attachment` keeps for the plan: each picture's id, workspace, and stamp. */
const keptFor = (taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({
        id: attachment.id,
        organizationId: attachment.organizationId,
        savedAt: attachment.savedAt,
      })
      .from(attachment)
      .where(eq(attachment.taskId, taskId));
    return rows.toSorted((a, b) => a.id.localeCompare(b.id));
  });

it.layer(getTestDB())("plan_attachment as a view over attachment", (it) => {
  it.effect(
    "a database from before the migration keeps every picture under its id, which this code serves and a task's move gives its workspace, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const plan = yield* openTask;
        const saved = { ...oldPicture(plan), savedAt: plan.now };
        const unsaved = oldPicture(plan);

        // The database as it stood before the migration: plan_attachment a table, holding a saved picture and an unsaved one.
        yield* sql.unsafe(`DROP VIEW "plan_attachment"`);
        yield* sql.unsafe(`DROP TABLE "plan_attachment_moved"`);
        yield* sql.unsafe(OLD_TABLE);
        yield* db.insert(planAttachment).values([saved, unsaved]);

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const [kind] = yield* sql<{ readonly relkind: string }>`
          SELECT relkind FROM pg_class WHERE oid = to_regclass('public.plan_attachment')
        `;
        assert.equal(kind?.relkind, "v");
        assert.deepEqual(
          yield* keptFor(plan.taskId),
          [
            { id: saved.id, organizationId: null, savedAt: plan.now },
            { id: unsaved.id, organizationId: null, savedAt: null },
          ].toSorted((a, b) => a.id.localeCompare(b.id)),
        );
        const served = Option.getOrThrow(
          yield* readPlanAttachment(plan.userId, plan.taskId, saved.id),
        );
        assert.deepEqual([...served.bytes], [...PNG]);
      }),
  );

  it.effect(
    "the old code's upload, count, read, stamp, and sweep through plan_attachment land in attachment, where this code reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const plan = yield* openTask;
        const kept = oldPicture(plan);
        const stray = { ...oldPicture(plan), createdAt: new Date(plan.now.getTime() - 86_400_000) };

        // The old upload, which names no workspace, and the old count.
        yield* db.insert(planAttachment).values([kept, stray]);
        const [counted] = yield* db
          .select({ count: sql<number>`count(*)::int` })
          .from(planAttachment)
          .where(eq(planAttachment.taskId, plan.taskId));
        assert.equal(counted?.count, 2);
        assert.deepEqual(
          (yield* keptFor(plan.taskId)).map((row) => row.organizationId),
          [null, null],
        );

        // The old read, joined to its plan.
        const [read] = yield* db
          .select({ bytes: planAttachment.bytes })
          .from(planAttachment)
          .innerJoin(task, eq(task.id, planAttachment.taskId))
          .where(and(eq(planAttachment.taskId, plan.taskId), eq(planAttachment.id, kept.id)));
        assert.deepEqual([...(read?.bytes ?? [])], [...PNG]);

        // The old save's stamp.
        yield* db
          .update(planAttachment)
          .set({ savedAt: plan.now })
          .where(
            and(
              eq(planAttachment.taskId, plan.taskId),
              inArray(planAttachment.id, [kept.id]),
              isNull(planAttachment.savedAt),
            ),
          );

        // The old sweep: the unsaved uploads before the cutoff under their plans' locks, then their delete.
        const swept = yield* db
          .select({ id: planAttachment.id })
          .from(planAttachment)
          .innerJoin(task, eq(task.id, planAttachment.taskId))
          .where(and(isNull(planAttachment.savedAt), lt(planAttachment.createdAt, plan.now)))
          .orderBy(asc(planAttachment.createdAt))
          .limit(200)
          .for("update", { of: task, skipLocked: true });
        assert.deepEqual(
          swept.map((row) => row.id),
          [stray.id],
        );
        yield* db.delete(planAttachment).where(
          inArray(
            planAttachment.id,
            swept.map((row) => row.id),
          ),
        );

        assert.deepEqual(
          (yield* keptFor(plan.taskId)).map((row) => [row.id, row.savedAt]),
          [[kept.id, plan.now]],
        );
        assert.ok(Option.isSome(yield* readPlanAttachment(plan.userId, plan.taskId, kept.id)));
        assert.ok(Option.isNone(yield* readPlanAttachment(plan.userId, plan.taskId, stray.id)));
      }),
  );
});
