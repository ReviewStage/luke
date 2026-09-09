import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

/**
 * A directory of this test's own, removed when the test ends. Synchronous, so
 * a fixture assembled outside an async helper can have one.
 */
export function temporaryDirectory(t: TestContext, prefix = "luke-"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
