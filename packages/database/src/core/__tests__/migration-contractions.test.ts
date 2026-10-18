import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { describe, type TestContext, test } from "vitest";
import { migrationContractions } from "../migration-contractions.js";

const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** The migration whose in-place renames broke the turns the old deployment had running. */
const PLAN_TO_TASK = "20261017014941_rename_plan_to_task";

/** A migrations folder holding the given folders, each written with its SQL. */
async function migrations(t: TestContext, folders: Record<string, string>): Promise<string> {
  const root = await temporaryDirectory(t, "luke-migration-contractions-");
  for (const [folder, sql] of Object.entries(folders)) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "migration.sql"), sql);
  }
  return root;
}

describe("migrationContractions", () => {
  test("the migrations on main pass", () => {
    assert.deepEqual(migrationContractions(MIGRATIONS), []);
  });

  test("the plan-to-task migration written again is refused for each table and column it renames", async (t) => {
    const root = await migrations(t, {});
    const later = "20261018090000_rename_plan_to_task";
    cpSync(join(MIGRATIONS, PLAN_TO_TASK), join(root, later), { recursive: true });

    const contractions = migrationContractions(root);

    assert.equal(contractions.length, 19);
    assert.ok(contractions.every((one) => one.folder === later));
    assert.ok(contractions.some((one) => one.statement === 'ALTER TABLE "plan" RENAME TO "task"'));
    assert.ok(
      contractions.some(
        (one) => one.statement === 'ALTER TABLE "automation" RENAME COLUMN "plan_id" TO "task_id"',
      ),
    );
    assert.ok(contractions.every((one) => !one.statement.startsWith("ALTER INDEX")));
  });

  test("a column renamed without the COLUMN keyword, across lines, or in a DO block is refused", async (t) => {
    const root = await migrations(t, {
      "20261018090000_spelled_out": [
        'ALTER TABLE "task" RENAME "title" TO "name";--> statement-breakpoint',
        'alter table if exists only "task"\n  rename column "body"\n  to "text";--> statement-breakpoint',
        "/* a note */ DO $$ BEGIN",
        '  ALTER TABLE "task" RENAME COLUMN "owner" TO "author";',
        "EXCEPTION WHEN undefined_column THEN NULL; END $$;",
      ].join("\n"),
    });

    assert.equal(migrationContractions(root).length, 3);
  });

  test("a type, an enum value, or a view renamed is refused", async (t) => {
    const root = await migrations(t, {
      "20261018090000_renames": [
        'ALTER TYPE "status" RENAME TO "state";--> statement-breakpoint',
        "ALTER TYPE \"state\" RENAME VALUE 'open' TO 'live';--> statement-breakpoint",
        'ALTER VIEW "plan" RENAME TO "task_view";',
      ].join("\n"),
    });

    assert.equal(migrationContractions(root).length, 3);
  });

  test("a table, a column with or without the keyword, a type, or a view dropped is refused", async (t) => {
    const root = await migrations(t, {
      "20261018090000_drops": [
        'DROP TABLE IF EXISTS "plan" CASCADE;--> statement-breakpoint',
        'ALTER TABLE "task" DROP COLUMN IF EXISTS "plan_id";--> statement-breakpoint',
        'ALTER TABLE "task" DROP "body";--> statement-breakpoint',
        'drop type "status";--> statement-breakpoint',
        'DROP MATERIALIZED VIEW "task_totals";--> statement-breakpoint',
        'DROP VIEW "plan";',
      ].join("\n"),
    });

    assert.deepEqual(
      migrationContractions(root).map((one) => one.statement),
      [
        'DROP TABLE IF EXISTS "plan" CASCADE',
        'ALTER TABLE "task" DROP COLUMN IF EXISTS "plan_id"',
        'ALTER TABLE "task" DROP "body"',
        'drop type "status"',
        'DROP MATERIALIZED VIEW "task_totals"',
        'DROP VIEW "plan"',
      ],
    );
  });

  test("a branch's folder older than the applied rename is still refused", async (t) => {
    const root = await migrations(t, {
      "20261016000000_cut_before": 'ALTER TABLE "plan" RENAME TO "task";',
    });

    assert.equal(migrationContractions(root).length, 1);
  });

  test("a contract step marked with why the old readers have drained passes", async (t) => {
    const root = await migrations(t, {
      "20261019090000_drop_plan_id": [
        "-- contract: nothing has read plan_id since #3700 reached production on Oct 18, over 25 hours ago",
        'ALTER TABLE "task" DROP COLUMN IF EXISTS "plan_id";--> statement-breakpoint',
        'ALTER TABLE "task" RENAME COLUMN "task_ref" TO "task_id";',
      ].join("\n"),
    });

    assert.deepEqual(migrationContractions(root), []);
  });

  test("a marker with no reason does not pass", async (t) => {
    const root = await migrations(t, {
      "20261019090000_drop_plan_id": '-- contract:\nALTER TABLE "task" DROP COLUMN "plan_id";',
    });

    assert.equal(migrationContractions(root).length, 1);
  });

  test("the applied rename, and a migration that adds, backfills, loosens, or renames or drops an index or constraint, pass", async (t) => {
    const root = await migrations(t, {
      [PLAN_TO_TASK]: 'ALTER TABLE "plan" RENAME TO "task";',
      "20261018090000_add_then_drop": [
        '-- ALTER TABLE "task" RENAME TO "job" was the first idea, then DROP TABLE "plan"',
        'CREATE TABLE IF NOT EXISTS "job" ("id" text PRIMARY KEY NOT NULL);--> statement-breakpoint',
        'ALTER TABLE "task" ADD COLUMN "task_id" text;--> statement-breakpoint',
        'UPDATE "task" SET "task_id" = "plan_id";--> statement-breakpoint',
        'ALTER TABLE "task" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint',
        'ALTER TABLE "task" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint',
        'ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "plan_user_fk";--> statement-breakpoint',
        'ALTER TABLE "task" RENAME CONSTRAINT "plan_pkey" TO "task_pkey";--> statement-breakpoint',
        'DROP INDEX IF EXISTS "plan_created";--> statement-breakpoint',
        'ALTER INDEX "plan_user_created" RENAME TO "task_user_created";',
      ].join("\n"),
    });

    assert.deepEqual(migrationContractions(root), []);
  });
});
