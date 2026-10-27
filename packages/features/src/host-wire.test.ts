import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { temporaryDirectory } from "@luke/wire/testing";
import { expect, it } from "vitest";
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

it("the many-servers command reaches every server at once and waits for them all", async (t) => {
  const dir = await temporaryDirectory(t);
  // The first server finishes only once the last has started, so a command that went one server at a time would never see it do so.
  await writeFile(
    join(dir, "ssh"),
    `#!/bin/sh
case "$2" in
  root@server-3) touch "${dir}/started"; echo "done" ;;
  *) for _ in $(seq 100); do [ -e "${dir}/started" ] && break; sleep 0.05; done
     [ -e "${dir}/started" ] && echo "done" || echo "stuck" ;;
esac
`,
  );
  await chmod(join(dir, "ssh"), 0o755);
  const { stdout } = await promisify(execFile)(
    "bash",
    ["-c", hostInstallLoopCommand(SCRIPT, TOKEN)],
    { env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` } },
  );
  assert.deepEqual(stdout.split("\n").filter(Boolean).sort(), [
    "server-1: done",
    "server-2: done",
    "server-3: done",
  ]);
});

it("the setup prompt holds the install command, the expiry, and the order to keep the token to itself", () => {
  const prompt = hostSetupPrompt(SCRIPT, TOKEN, EXPIRES_AT);
  expect(prompt).toContain(`curl -fsSL ${SCRIPT} | sudo sh -s -- --token ${TOKEN}`);
  expect(prompt).toContain("stops working at 2026-10-28T16:00:00.000Z");
  expect(prompt).toContain("never repeat it in your reply or summary");
  assert.equal(prompt.split(TOKEN).length - 1, 1, "the token stands once");
});
