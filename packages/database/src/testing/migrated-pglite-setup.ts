import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATED_PGLITE_ENVIRONMENT, writeMigratedPgliteDump } from "./sql-client.js";

export default async function setup(): Promise<() => Promise<void>> {
  const directory = await mkdtemp(join(tmpdir(), "luke-migrated-pglite-"));
  const removeDirectory = () => rm(directory, { recursive: true, force: true });
  const file = join(directory, "migrated.tar");
  try {
    await writeMigratedPgliteDump(file);
  } catch (error) {
    await removeDirectory();
    throw error;
  }
  process.env[MIGRATED_PGLITE_ENVIRONMENT.DUMP] = file;
  return removeDirectory;
}
