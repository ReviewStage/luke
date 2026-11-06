import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "vitest";

export async function temporaryDirectory(t: TestContext, prefix = "luke-"): Promise<string> {
  const stem = prefix.endsWith("-") ? prefix : `${prefix}-`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), stem));
  t.onTestFinished(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
