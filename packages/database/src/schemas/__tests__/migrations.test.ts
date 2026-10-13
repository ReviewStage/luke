import { readdir, readFile } from "node:fs/promises";
import { generateDrizzleJson, generateMigration, up } from "drizzle-kit/api-postgres";
import { expect, test } from "vitest";
import * as schema from "../index.js";

/**
 * The schema modules are the source of truth and `pnpm db:generate` writes
 * the migration that brings the last snapshot up to them, so a module edited
 * without that migration leaves the two apart. This is the check that the
 * migration was generated: the newest snapshot under `migrations/meta/` and
 * the modules must need no statement between them. The snapshots on disk are
 * drizzle-kit 0.x's version 7, so the newest is read through v1's own `up`
 * before the diff, which is what `drizzle-kit up` would write for it.
 */

const META = new URL("../../../migrations/meta/", import.meta.url);

async function newestSnapshot(): Promise<Parameters<typeof generateMigration>[0]> {
  const snapshots = (await readdir(META)).filter((name) => name.endsWith("_snapshot.json")).sort();
  const newest = snapshots.at(-1);
  if (newest === undefined) throw new Error("migrations/meta holds no snapshot");
  return up(JSON.parse(await readFile(new URL(newest, META), "utf8"))).snapshot;
}

test("every schema module change has its generated migration", async () => {
  const statements = await generateMigration(
    await newestSnapshot(),
    await generateDrizzleJson(schema),
  );
  expect(statements, "run `pnpm db:generate` and commit the migration it writes").toEqual([]);
});
