import { readdir, readFile } from "node:fs/promises";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { expect, test } from "vitest";
import * as schema from "../index.js";

/**
 * The schema modules are the source of truth and `pnpm db:generate` writes
 * the migration that brings the last snapshot up to them, so a module edited
 * without that migration leaves the two apart. This is the check that the
 * migration was generated: the newest snapshot under `migrations/meta/` and
 * the modules must need no statement between them.
 */

const META = new URL("../../../migrations/meta/", import.meta.url);

async function newestSnapshot(): Promise<Parameters<typeof generateMigration>[0]> {
  const snapshots = (await readdir(META)).filter((name) => name.endsWith("_snapshot.json")).sort();
  const newest = snapshots.at(-1);
  if (newest === undefined) throw new Error("migrations/meta holds no snapshot");
  return JSON.parse(await readFile(new URL(newest, META), "utf8"));
}

test("every schema module change has its generated migration", async () => {
  const statements = await generateMigration(await newestSnapshot(), generateDrizzleJson(schema));
  expect(statements, "run `pnpm db:generate` and commit the migration it writes").toEqual([]);
});

/**
 * The migrator keys a migration by its journal index, so two entries holding
 * one index after a hand-merged conflict would apply one of them and skip the
 * other in production without a word. They need not be contiguous: 22 was
 * dropped long ago.
 */
test("the journal's indexes only increase, with none repeated", async () => {
  const journal: { readonly entries: readonly { readonly idx: number }[] } = JSON.parse(
    await readFile(new URL("_journal.json", META), "utf8"),
  );
  const indexes = journal.entries.map((entry) => entry.idx);
  expect(
    indexes,
    "on a migration conflict, delete this branch's migration SQL, snapshot, and journal entry, rebase, and run `pnpm db:generate` again",
  ).toEqual([...new Set(indexes)].sort((left, right) => left - right));
});
