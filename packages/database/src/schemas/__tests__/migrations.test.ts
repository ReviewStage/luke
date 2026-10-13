import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import * as schema from "../index.js";

/**
 * The schema modules are the source of truth and `pnpm db:generate` writes
 * the folder that brings the newest snapshot up to them, so a module edited
 * without that migration leaves the two apart. This is the check that the
 * migration was generated: every leaf snapshot under `migrations/` (one no
 * other folder names as its parent) and the modules must need no statement
 * between them.
 */

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

type Snapshot = Parameters<typeof generateMigration>[0];

async function snapshots(): Promise<ReadonlyArray<Snapshot>> {
  const folders = await readdir(MIGRATIONS);
  return Promise.all(
    folders.map(
      async (folder): Promise<Snapshot> =>
        JSON.parse(await readFile(new URL(`${folder}/snapshot.json`, MIGRATIONS), "utf8")),
    ),
  );
}

/** The snapshots no other one descends from: one on a straight history, more while two branches stand unmerged. */
async function leafSnapshots(): Promise<ReadonlyArray<Snapshot>> {
  const all = await snapshots();
  const parents = new Set(all.flatMap((snapshot) => snapshot.prevIds));
  return all.filter((snapshot) => !parents.has(snapshot.id));
}

test("every schema module change has its generated migration", async () => {
  const leaves = await leafSnapshots();
  expect(leaves.length).toBeGreaterThan(0);
  const current = await generateDrizzleJson(schema);
  for (const leaf of leaves) {
    expect(
      await generateMigration(leaf, current),
      "run `pnpm db:generate --name=<what it does>` and commit the folder it writes",
    ).toEqual([]);
  }
});

/**
 * `drizzle-kit check` is what `check.sh` runs over the real folder; these
 * hold it to refusing two branches that each cut a migration from the same
 * parent and touch one column, and to passing two that touch different
 * tables. The fixture folders are what `generate` would write: each
 * snapshot's `prevIds` names the one it was generated from.
 */

const DRIZZLE_KIT_BIN = join(
  dirname(createRequire(import.meta.url).resolve("drizzle-kit/api-postgres")),
  "bin.cjs",
);

/** The id drizzle-kit gives the empty history a first snapshot descends from. */
const ORIGIN_ID = "00000000-0000-0000-0000-000000000000";

const account = pgTable("account", { id: integer().primaryKey() });
const plan = pgTable("plan", { id: integer().primaryKey() });

const FIXTURE_SCHEMA = {
  BASE: { account, plan },
  NICKNAME_TEXT: {
    account: pgTable("account", { id: integer().primaryKey(), nickname: text() }),
    plan,
  },
  NICKNAME_NUMBER: {
    account: pgTable("account", { id: integer().primaryKey(), nickname: integer() }),
    plan,
  },
  PLAN_TITLE: { account, plan: pgTable("plan", { id: integer().primaryKey(), title: text() }) },
} as const;

/** The fixture schema a migration is generated from: the base's two tables, or a branch's. */
type FixtureTables = (typeof FIXTURE_SCHEMA)[keyof typeof FIXTURE_SCHEMA];

async function writeMigration(
  out: string,
  folder: string,
  previous: Snapshot | undefined,
  tables: FixtureTables,
): Promise<Snapshot> {
  const snapshot = await generateDrizzleJson(tables, previous?.id ?? ORIGIN_ID);
  const statements = previous ? await generateMigration(previous, snapshot) : [];
  await mkdir(join(out, folder), { recursive: true });
  await writeFile(join(out, folder, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  await writeFile(
    join(out, folder, "migration.sql"),
    statements.join("--> statement-breakpoint\n"),
  );
  return snapshot;
}

/** A base migration and two branches cut from it, then `drizzle-kit check` over the folder. */
async function checkBranches(directory: string, left: FixtureTables, right: FixtureTables) {
  const out = join(directory, "migrations");
  const base = await writeMigration(out, "20260101000000_base", undefined, FIXTURE_SCHEMA.BASE);
  await writeMigration(out, "20260102000000_left", base, left);
  await writeMigration(out, "20260103000000_right", base, right);
  return spawnSync(
    process.execPath,
    [DRIZZLE_KIT_BIN, "check", "--dialect", "postgresql", "--out", out],
    { cwd: directory, encoding: "utf8" },
  );
}

test("drizzle-kit check refuses two branches that each change the same column", async (t) => {
  const run = await checkBranches(
    await temporaryDirectory(t),
    FIXTURE_SCHEMA.NICKNAME_TEXT,
    FIXTURE_SCHEMA.NICKNAME_NUMBER,
  );
  expect(run.status, run.stdout + run.stderr).not.toBe(0);
}, 60_000);

test("drizzle-kit check passes two branches that change different tables", async (t) => {
  const run = await checkBranches(
    await temporaryDirectory(t),
    FIXTURE_SCHEMA.NICKNAME_TEXT,
    FIXTURE_SCHEMA.PLAN_TITLE,
  );
  expect(run.status, run.stdout + run.stderr).toBe(0);
}, 60_000);
