import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import { callerDirectories, checkApiCallers, PATHS_MODULE } from "../server/api-callers";

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");

test("every /api/ path a client in the repository builds resolves to a route", async () => {
  const directories = await callerDirectories(REPO_ROOT);
  assert.equal(directories.includes(PATHS_MODULE.split("/").slice(0, 3).join("/")), true);
  const report = await checkApiCallers({ repoRoot: REPO_ROOT, web: WEB });
  assert.deepEqual(report.refused, []);
  assert.notEqual(report.resolved.length, 0);
  assert.notEqual(report.filesScanned, 0);
});
