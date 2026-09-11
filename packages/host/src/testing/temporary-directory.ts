import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "vitest";

/**
 * A directory of this test's own, removed when the test ends. `@sidecar/wire`'s
 * own `temporaryDirectory` is typed against `node:test`'s `TestContext` and
 * calls `t.after`, which vitest's context does not carry; this package runs on
 * vitest, so it keeps its own copy calling `t.onTestFinished` instead.
 */
export async function temporaryDirectory(t: TestContext, prefix = "luke-"): Promise<string> {
  const stem = prefix.endsWith("-") ? prefix : `${prefix}-`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), stem));
  t.onTestFinished(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
