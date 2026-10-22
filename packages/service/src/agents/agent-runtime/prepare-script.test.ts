import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { type TestContext, test } from "vitest";
import { PREPARE_SCRIPT } from "./sandbox-image.js";

/**
 * The image's preparation as a sandbox's shell runs it: it installs
 * bubblewrap and socat, the pinned Claude Agent SDK and the pinned Codex as
 * root under their own directories, the `agent` user with a home only it
 * reads, and Codex's `CODEX_HOME` there, owned by `agent`, then checks
 * last that a command under the capability drop holds none. It keeps the
 * default user's sudo, which the sandbox's API runs the runner's launch
 * through, and adds one sudoers drop-in, checked by `visudo`, so that sudo
 * keeps the launch's environment as Vercel documents. A preparation where a
 * command under the capability drop would still hold a capability, where
 * the Codex installed does not print the pin, or where sudo still drops a
 * variable, fails.
 *
 * The script runs in a real bash. Every program it would change the
 * machine with, or that a test machine may lack, is a stand-in on the
 * search path that writes down how it was called: sudo and the package
 * managers among them, so nothing is installed and no sudoers file is
 * touched. Rust's installer is downloaded to a path the stand-ins never
 * write, so the proxies it would make are none, and no wrapper is written.
 * The stand-ins answer as a fresh sandbox would: the default user
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
  "visudo",
  "cc",
  "cmake",
  "pkg-config",
  "cargo",
  "rustc",
] as const;

/**
 * One stand-in for every program, by the name it was called as: each call
 * is written down as one line, and `id`, `claude`, `codex`, and `setpriv`
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
  '  setpriv*) exit "$SETPRIV_EXIT" ;;',
  '  "sudo -n bash -c "*) exit "$SUDO_KEEPS_EXIT" ;;',
  '  "cargo --version") exit "$CARGO_EXIT" ;;',
  "esac",
  "exit 0",
].join("\n");

interface Scenario {
  /** How a command started under the capability drop exits: 0 where it holds none. */
  readonly setprivExit: number;
  /** The version the installed `codex` prints. */
  readonly codexPrints?: string;
  /** How the check that `sudo` keeps a variable exits: 0 where it keeps it. */
  readonly sudoKeepsExit?: number;
  /** How `cargo --version` exits as the default user runs it: 0 where its wrapper finds the toolchain. */
  readonly cargoExit?: number;
}

/** The script run once in a bash over the stand-ins: its exit, what it printed on stderr, and every call, in order. */
async function prepare(t: TestContext, scenario: Scenario) {
  const root = await temporaryDirectory(t, "prepare-script-");
  const bin = join(root, "bin");
  mkdirSync(bin);
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
        SETPRIV_EXIT: String(scenario.setprivExit),
        CODEX_PRINTS: scenario.codexPrints ?? "0.163.0",
        SUDO_KEEPS_EXIT: String(scenario.sudoKeepsExit ?? 0),
        CARGO_EXIT: String(scenario.cargoExit ?? 0),
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

test("the image gets Claude Code, Codex, bubblewrap and the agent user, keeps the default user's sudo, and checks the capability drop last", async (t) => {
  const { exitCode, stderr, calls } = await prepare(t, { setprivExit: 0 });
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
  const checked = indexOfCall(
    calls,
    "setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- grep ",
  );
  for (const install of installs)
    assert.ok(install < checked, `${calls[install]} comes after the capability check`);

  // The sandbox's API runs a root command through the default user's sudo, so nothing takes it away.
  assert.deepEqual(
    calls.filter((call) => /^(gpasswd|sudo -n sh -c |sudo -n sed |sed -i .*sudoers)/u.test(call)),
    [],
  );
});

test("the image fails where a command under the capability drop still holds a capability", async (t) => {
  const { exitCode, stderr } = await prepare(t, { setprivExit: 1 });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /still holds one/);
});

test("the image fails where the Codex installed does not print the pin", async (t) => {
  // A version that matches the pin only with its dots read as any character fails too.
  for (const codexPrints of ["0.162.0", "0a163b0"]) {
    const { exitCode, stderr } = await prepare(t, { setprivExit: 0, codexPrints });
    assert.notEqual(exitCode, 0, codexPrints);
    assert.match(stderr, /codex does not print 0\.163\.0/);
  }
});

test("the image makes the runner's directory root's and keeps the sandbox user's sudo environment, as Vercel documents, through a drop-in visudo checks", async (t) => {
  const { exitCode, stderr, calls } = await prepare(t, { setprivExit: 0 });
  assert.equal(exitCode, 0, stderr);

  const steps = [
    "sudo -n install -d -o root -g root -m 0755 /opt/luke/agent-runner",
    "sudo -n tee /etc/sudoers.d/luke-env",
    "sudo -n chmod 0440 /etc/sudoers.d/luke-env",
    "sudo -n visudo -c -q -f /etc/sudoers.d/luke-env",
    "sudo -n bash -c ",
  ].map((start) => indexOfCall(calls, start));
  assert.deepEqual(
    steps,
    [...steps].sort((a, b) => a - b),
  );
});

test("the image fails where sudo still drops a variable it was handed", async (t) => {
  const { exitCode, stderr } = await prepare(t, { setprivExit: 0, sudoKeepsExit: 1 });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /sudo does not keep the environment/);
});

test("the image gets a C toolchain and Rust's stable toolchain as root, and checks as the default user that Cargo answers, before the capability check", async (t) => {
  const { exitCode, stderr, calls } = await prepare(t, { setprivExit: 0 });
  assert.equal(exitCode, 0, stderr);

  const steps = [
    "sudo -n dnf install -y gcc gcc-c++ make cmake pkgconf-pkg-config openssl-devel git-lfs",
    "sudo -n git lfs install --system",
    "curl -fsSL -o /tmp/rustup-init https://static.rust-lang.org/rustup/archive/1.29.2/x86_64-unknown-linux-gnu/rustup-init",
    "sha256sum --check --quiet",
    "sudo -n env HOME=/root RUSTUP_HOME=/opt/luke/rust/rustup CARGO_HOME=/opt/luke/rust/cargo /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain stable --component clippy,rustfmt",
    "cargo --version",
    "cargo clippy --version",
    "cargo fmt --version",
    "setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- grep ",
  ].map((start) => indexOfCall(calls, start));
  assert.deepEqual(
    steps,
    [...steps].sort((a, b) => a - b),
  );
  // Cargo is checked as the default user runs it, which no sudo stands in front of.
  assert.deepEqual(
    calls.filter((call) => /^sudo -n (cargo|rustc|rustup)/u.test(call)),
    [],
  );
});

test("the image fails where Cargo does not answer as the default user runs it", async (t) => {
  const { exitCode } = await prepare(t, { setprivExit: 0, cargoExit: 1 });
  assert.notEqual(exitCode, 0);
});
