import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checkScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "check.mjs");
const LAST_LINE = "the line that names the failure";

// A pnpm on PATH whose `test` writes far more than a pipe holds and fails, so
// the check's own exit is what decides whether the tail reaches the reader.
function fakePnpm(directory) {
  const script = path.join(directory, "pnpm");
  fs.writeFileSync(
    script,
    [
      "#!/usr/bin/env node",
      'if (process.argv[3] !== "test") process.exit(0);',
      'process.stdout.write("x".repeat(1024 * 1024) + "\\n");',
      `process.stdout.write(${JSON.stringify(`${LAST_LINE}\n`)});`,
      "process.exitCode = 1;",
    ].join("\n"),
  );
  fs.chmodSync(script, 0o755);
}

function runCheck(directory) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn(process.execPath, [checkScript], {
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (status) => resolve({ status, stdout: Buffer.concat(chunks).toString() }));
  });
}

test("a failing check's output reaches the reader whole before the check exits", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-check-"));
  try {
    fakePnpm(directory);
    const { status, stdout } = await runCheck(directory);
    assert.equal(status, 1);
    assert.ok(stdout.trimEnd().endsWith(LAST_LINE), "the failing check's last line is printed");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
