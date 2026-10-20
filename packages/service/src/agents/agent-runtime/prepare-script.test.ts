import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { type TestContext, test } from "vitest";
import { PREPARE_SCRIPT } from "./sandbox.js";

/**
 * The image's preparation as a sandbox's shell runs it: it installs
 * bubblewrap and socat, the pinned Claude Agent SDK and the pinned Codex as
 * root under their own directories, the `agent` user with a home only it
 * reads, and Codex's `CODEX_HOME` there, owned by `agent`, and drops the
 * default user's sudo after all of them, asking sudo for nothing past that
 * but the check that it is gone. A preparation where sudo still stands, or
 * where a command under the capability drop would still hold one, or
 * where the Codex installed does not print the pin, fails.
 *
 * The script runs in a real bash. Every program it would change the
 * machine with, or that a test machine may lack, is a stand-in on the
 * search path that writes down how it was called: sudo and the package
 * managers among them, so nothing is installed and no sudoers file is
 * touched. The stand-ins answer as a fresh sandbox would: the default user
 * is not root and `agent` does not exist yet.
 */

/** The programs the stand-in answers for; everything else (grep, the shell's builtins) is the machine's own. */
const STOOD_IN = [
  "sudo",
  "dnf",
  "apt-get",
  "npm",
  "pnpm",
  "python3",
  "git",
  "node",
  "tmux",
  "playwright",
  "curl",
  "sha256sum",
  "install",
  "rm",
  "gh",
  "bwrap",
  "claude",
  "codex",
  "id",
  "useradd",
  "usermod",
  "chmod",
  "ln",
  "setpriv",
  "gpasswd",
  "sed",
  "tee",
] as const;

/**
 * One stand-in for every program, by the name it was called as: each call
 * is written down as one line, and `id`, `claude`, `codex`, `sudo`, and `setpriv`
 * answer as the scenario has them.
 */
const STAND_IN = [
  "#!/bin/sh",
  'name="$(basename "$0")"',
  '{ printf "%s" "$name"; for arg in "$@"; do printf " %s" "$arg"; done; } | tr "\\n" " " >> "$PREPARE_LOG"',
  'echo >> "$PREPARE_LOG"',
  'case "$name $*" in',
  '  "id -u") echo 1001 ;;',
  '  "id -un"|"id -gn") echo vercel-sandbox ;;',
  '  "id -u agent") exit 1 ;;',
  '  "claude --version") echo "2.1.304 (Claude Code)" ;;',
  '  "codex --version") echo "codex-cli $CODEX_PRINTS" ;;',
  '  "sudo -n true") [ -e "$PREPARE_STATE/sudo-dropped" ] && exit 1; exit 0 ;;',
  '  "sudo -n sh -c "*) [ "$SUDO_DROPS" = 1 ] && touch "$PREPARE_STATE/sudo-dropped"; exit 0 ;;',
  '  setpriv*) exit "$SETPRIV_EXIT" ;;',
  "esac",
  "exit 0",
].join("\n");

interface Scenario {
  /** Whether the sudoers drop takes sudo away, as it does in a sandbox. */
  readonly sudoDrops: boolean;
  /** How a command started under the capability drop exits: 0 where it holds none. */
  readonly setprivExit: number;
  /** The version the installed `codex` prints. */
  readonly codexPrints?: string;
}

/** The script run once in a bash over the stand-ins: its exit, what it printed on stderr, and every call, in order. */
async function prepare(t: TestContext, scenario: Scenario) {
  const root = await temporaryDirectory(t, "prepare-script-");
  const bin = join(root, "bin");
  const state = join(root, "state");
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(join(root, "stand-in"), `${STAND_IN}\n`, { mode: 0o755 });
  for (const name of STOOD_IN) symlinkSync(join(root, "stand-in"), join(bin, name));
  const log = join(root, "calls");
  writeFileSync(log, "");
  // The script looks for an install already in place under `/opt/luke`, which a machine
  // prepared from the image has, so that directory is the temporary one's instead.
  const opt = join(root, "opt");
  const ran = spawnSync(
    "/bin/bash",
    ["-c", PREPARE_SCRIPT.replaceAll("/opt/luke/", `${opt}/luke/`)],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: root,
        PREPARE_LOG: log,
        PREPARE_STATE: state,
        SUDO_DROPS: scenario.sudoDrops ? "1" : "0",
        SETPRIV_EXIT: String(scenario.setprivExit),
        CODEX_PRINTS: scenario.codexPrints ?? "0.163.0",
      },
    },
  );
  const calls = readFileSync(log, "utf8")
    .replaceAll(`${opt}/luke/`, "/opt/luke/")
    .split("\n")
    .filter(Boolean);
  return { exitCode: ran.status, stderr: ran.stderr, calls };
}

/** Where the first call that starts with the words given stands among the calls; a call never made fails the test. */
function indexOfCall(calls: readonly string[], start: string): number {
  const index = calls.findIndex((call) => call.startsWith(start));
  assert.notEqual(index, -1, `no call starts with: ${start}`);
  return index;
}

test("the image gets Claude Code, Codex, bubblewrap and the agent user, then drops sudo last", async (t) => {
  const { exitCode, stderr, calls } = await prepare(t, { sudoDrops: true, setprivExit: 0 });
  assert.equal(exitCode, 0, stderr);

  const installs = [
    "sudo -n dnf install -y bubblewrap socat",
    "sudo -n env HOME=/root npm install --prefix /opt/luke/claude-agent-sdk --no-audit --no-fund --save-exact @anthropic-ai/claude-agent-sdk@0.3.304",
    "sudo -n ln -sfn /opt/luke/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude /usr/local/bin/claude",
    "sudo -n useradd --create-home --shell /bin/bash agent",
    "sudo -n chmod 700 /home/agent",
    "sudo -n usermod -aG vercel-sandbox agent",
    "sudo -n env HOME=/root npm install --global --prefix /opt/luke/codex --no-audit --no-fund @openai/codex@0.163.0",
    "sudo -n ln -sfn /opt/luke/codex/bin/codex /usr/local/bin/codex",
    "sudo -n install -d -o agent -g agent -m 0700 /home/agent/.codex",
  ].map((start) => indexOfCall(calls, start));
  const dropped = indexOfCall(calls, "sudo -n sh -c ");
  for (const install of installs)
    assert.ok(install < dropped, `${calls[install]} comes after the drop`);

  // Past the drop, sudo is asked only whether it still stands, and the drop is checked to hold.
  const after = calls.slice(dropped + 1);
  assert.deepEqual(
    after.filter((call) => call.startsWith("sudo ")),
    ["sudo -n true"],
  );
  assert.ok(
    after.some((call) =>
      call.startsWith("setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- "),
    ),
  );
});

test("the image fails where the default user's sudo still stands after the drop", async (t) => {
  const { exitCode, stderr } = await prepare(t, { sudoDrops: false, setprivExit: 0 });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /sudo still stands/);
});

test("the image fails where a command under the capability drop still holds a capability", async (t) => {
  const { exitCode, stderr } = await prepare(t, { sudoDrops: true, setprivExit: 1 });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /still holds one/);
});

test("the image fails where the Codex installed does not print the pin", async (t) => {
  // A version that matches the pin only with its dots read as any character fails too.
  for (const codexPrints of ["0.162.0", "0a163b0"]) {
    const { exitCode, stderr } = await prepare(t, { sudoDrops: true, setprivExit: 0, codexPrints });
    assert.notEqual(exitCode, 0, codexPrints);
    assert.match(stderr, /codex does not print 0\.163\.0/);
  }
});
