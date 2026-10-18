import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { describe, type TestContext, test } from "vitest";
import { migrationRenames } from "../migration-renames.js";

const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** The migration whose in-place renames broke the turns the old deployment had running. */
const PLAN_TO_TASK = "20261017014941_rename_plan_to_task";

/** A migrations folder holding the given folders, each written with its SQL. */
async function migrations(t: TestContext, folders: Record<string, string>): Promise<string> {
  const root = await temporaryDirectory(t, "luke-migration-renames-");
  for (const [folder, sql] of Object.entries(folders)) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "migration.sql"), sql);
  }
  return root;
}

describe("migrationRenames", () => {
  test("the migrations on main pass", () => {
    assert.deepEqual(migrationRenames(MIGRATIONS), []);
  });

  test("the plan-to-task migration written again is refused for each table and column it renames", async (t) => {
    const root = await migrations(t, {});
    const later = "20261018090000_rename_plan_to_task";
    cpSync(join(MIGRATIONS, PLAN_TO_TASK), join(root, later), { recursive: true });

    const renames = migrationRenames(root);

    assert.equal(renames.length, 19);
    assert.ok(renames.every((one) => one.folder === later));
    assert.ok(renames.some((one) => one.statement === 'ALTER TABLE "plan" RENAME TO "task"'));
    assert.ok(
      renames.some(
        (one) => one.statement === 'ALTER TABLE "automation" RENAME COLUMN "plan_id" TO "task_id"',
      ),
    );
    assert.ok(renames.every((one) => !one.statement.startsWith("ALTER INDEX")));
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

    assert.equal(migrationRenames(root).length, 3);
  });

  test("a branch's folder older than the applied rename is still refused", async (t) => {
    const root = await migrations(t, {
      "20261016000000_cut_before": 'ALTER TABLE "plan" RENAME TO "task";',
    });

    assert.equal(migrationRenames(root).length, 1);
  });

  test("the applied rename, and a migration that adds, backfills, or renames an index or constraint, pass", async (t) => {
    const root = await migrations(t, {
      [PLAN_TO_TASK]: 'ALTER TABLE "plan" RENAME TO "task";',
      "20261018090000_add_then_drop": [
        '-- ALTER TABLE "task" RENAME TO "job" was the first idea',
        'ALTER TABLE "task" ADD COLUMN "task_id" text;--> statement-breakpoint',
        'UPDATE "task" SET "task_id" = "plan_id";--> statement-breakpoint',
        'ALTER TABLE "task" RENAME CONSTRAINT "plan_pkey" TO "task_pkey";--> statement-breakpoint',
        'ALTER INDEX "plan_user_created" RENAME TO "task_user_created";',
      ].join("\n"),
    });

    assert.deepEqual(migrationRenames(root), []);
  });
});
