/**
 * migrated-pglite-setup.ts -- vitest's global setup: one migrated PGlite per run, dumped for every test file to load.
 *
 * Vitest gives each test file a module graph of its own, so the dump
 * `openMigratedPglite` keeps was one file's, and every file that opened a
 * database first spent seconds in initdb and every migration. Here a run
 * migrates once, before any file starts, and names the dump in the
 * environment its workers inherit, so a file's first opening is a load. The
 * database, service, and web suites name this file as their `globalSetup`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATED_PGLITE_ENVIRONMENT, writeMigratedPgliteDump } from "./sql-client.js";

export default async function setup(): Promise<() => Promise<void>> {
  const directory = await mkdtemp(join(tmpdir(), "luke-migrated-pglite-"));
  const file = join(directory, "migrated.tar");
  await writeMigratedPgliteDump(file);
  process.env[MIGRATED_PGLITE_ENVIRONMENT.DUMP] = file;
  return () => rm(directory, { recursive: true, force: true });
}
