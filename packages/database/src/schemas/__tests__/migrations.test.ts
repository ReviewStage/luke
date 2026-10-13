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
