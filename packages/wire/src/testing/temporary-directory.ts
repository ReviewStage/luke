import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "vitest";

/**
 * A directory of this test's own, removed when the test ends. Every test that
 * seeds a provider home needs one, and a test that forgets to remove it leaves
 * a machine's temporary directory holding fixture trees for as long as it
 * stands — so the removal is registered before the path is handed back rather
 * than left to the caller's own teardown.
 */
export async function temporaryDirectory(t: TestContext, prefix = "luke-"): Promise<string> {
  const stem = prefix.endsWith("-") ? prefix : `${prefix}-`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), stem));
  t.onTestFinished(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
