import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, type TestContext, test, vi } from "vitest";
import { openMigratedPglite } from "../sql-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The first opening migrates, about 4 s on an idle machine, so the test is held to the config's hook bar. */
const MIGRATING_TIMEOUT_MS = 30_000;

/** A migrated PGlite of the test's own, closed when the test ends. */
async function opened(t: TestContext): Promise<PGlite> {
  const client = await openMigratedPglite();
  t.onTestFinished(() => client.close());
  return client;
}

async function tables(client: PGlite): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    "select table_name as name from information_schema.tables where table_schema = 'public' order by 1",
  );
  return rows.map((row) => row.name);
}

test(
  "every opening carries every migration, and what one writes no later one sees",
  async (t) => {
    const first = await opened(t);
    const migrated = await tables(first);
    assert.ok(migrated.length > 0);
    await first.exec("create table written_after_opening (id int)");

    const second = await opened(t);
    assert.deepEqual(await tables(second), migrated);
    await second.exec("create table written_in_the_second (id int)");

    const third = await opened(t);
    assert.deepEqual(await tables(third), migrated);
    assert.deepEqual(
      (await tables(first)).filter((name) => !migrated.includes(name)),
      ["written_after_opening"],
    );
  },
  MIGRATING_TIMEOUT_MS,
);

test(
  "a first opening whose dump fails leaves a later opening free to migrate afresh",
  async (t) => {
    // Note that we load a module of the test's own, so no earlier opening has dumped already.
    vi.resetModules();
    const fresh = await import("../sql-client.js");
    vi.spyOn(PGlite.prototype, "dumpDataDir").mockRejectedValueOnce(new Error("dump refused"));

    await assert.rejects(fresh.openMigratedPglite(), /dump refused/);

    const client = await fresh.openMigratedPglite();
    t.onTestFinished(() => client.close());
    assert.ok((await tables(client)).length > 0);
  },
  MIGRATING_TIMEOUT_MS,
);
