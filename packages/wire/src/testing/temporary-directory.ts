import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

/**
 * A directory of this test's own, removed when the test ends. Every test that
 * seeds a provider home needs one, and a test that forgets to remove it leaves
 * a machine's temporary directory holding fixture trees for as long as it
 * stands — so the removal is registered before the path is handed back rather
 * than left to the caller's own dispose. Synchronous, so a fixture assembled
 * outside an async helper can have one.
 */
export function temporaryDirectory(t: TestContext, prefix = "luke-"): string {
  const stem = prefix.endsWith("-") ? prefix : `${prefix}-`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), stem));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
