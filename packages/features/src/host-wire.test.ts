import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { temporaryDirectory } from "@luke/wire/testing";
import { expect, it, type TestContext } from "vitest";
import { hostInstallLoopCommand, hostSetupPrompt } from "./host-wire.js";

/**
 * host-wire.test.ts -- the many-servers command installs on its servers at
 * once, and the setup prompt carries the install command and the token's
 * expiry. A fake ssh on the PATH, and a fake token.
 */

const SCRIPT = "https://luke.test/install.sh";
const TOKEN = "lkh_fake-token-for-tests";
// 2026-10-28T16:00:00.000Z
const EXPIRES_AT = 1_793_203_200_000;

/** Runs the many-servers command in bash with a fake ssh, whose script answers each server, and says how it ended. */
async function runLoop(t: TestContext, ssh: string) {
  const dir = await temporaryDirectory(t);
  await writeFile(join(dir, "ssh"), `#!/bin/sh\n${ssh.replaceAll("$DIR", dir)}\n`);
  await chmod(join(dir, "ssh"), 0o755);
  // The command is run from a file, as the member's shell reads it from a paste.
  await writeFile(join(dir, "loop.sh"), hostInstallLoopCommand(SCRIPT, TOKEN));
  try {
    const { stdout } = await promisify(execFile)("bash", [join(dir, "loop.sh")], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    return { code: 0, lines: stdout.split("\n").filter(Boolean).sort() };
  } catch (failure) {
    const { code, stdout } = failure as { code: number; stdout: string };
    return { code, lines: stdout.split("\n").filter(Boolean).sort() };
  }
}

it("the many-servers command reaches every server at once and waits for them all", async (t) => {
  // The first server finishes only once the last has started, so a command that went one server at a time would never see it do so.
  const { code, lines } = await runLoop(
    t,
    `case "$2" in
  root@server-3) touch "$DIR/started"; echo "done" ;;
  *) for _ in $(seq 100); do [ -e "$DIR/started" ] && break; sleep 0.05; done
     [ -e "$DIR/started" ] && echo "done" || echo "stuck" ;;
esac`,
  );
  assert.equal(code, 0);
  assert.deepEqual(lines, ["server-1: done", "server-2: done", "server-3: done"]);
});

it("the many-servers command exits non-zero when any server fails, and still shows the rest", async (t) => {
  const { code, lines } = await runLoop(
    t,
    `case "$2" in
  root@server-2) echo "no route to host"; exit 255 ;;
  *) echo "done" ;;
esac`,
  );
  assert.notEqual(code, 0);
  assert.deepEqual(lines, ["server-1: done", "server-2: no route to host", "server-3: done"]);
});

it("the setup prompt holds the install command, the expiry, and the order to keep the token to itself", () => {
  const prompt = hostSetupPrompt(SCRIPT, TOKEN, EXPIRES_AT);
  expect(prompt).toContain(`curl -fsSL ${SCRIPT} | sudo sh -s -- --token ${TOKEN}`);
  expect(prompt).toContain("stops working at 2026-10-28T16:00:00.000Z");
  expect(prompt).toContain("never repeat it in your reply or summary");
  expect(prompt).toContain("read its whole output, not just its end");
  assert.equal(prompt.split(TOKEN).length - 1, 1, "the token stands once");
});
