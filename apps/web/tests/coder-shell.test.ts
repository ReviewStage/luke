import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import type { SandboxSpawnOptions } from "eve/sandbox";
import type { ToolContext as EveToolContext } from "eve/tools";
import { test } from "vitest";
import { bashStartingIn } from "../server/hosted/coder-host/shell";

/**
 * The coding agent's shell: every command starts in the checkout, in a
 * fresh shell, so the model never opens one with a `cd` and a `cd` it does
 * run lasts only for its own call; the command's own exit and output come
 * back as eve's `bash` answers them; and a checkout that is not there runs
 * nothing at the sandbox's root. The sandbox is a real POSIX shell in a
 * directory the test made, standing for the sandbox's root. Note that its
 * search path holds nothing, so only the shell's builtins run, and that
 * with no `bash` on it eve's launcher evaluates the command in place
 * rather than backgrounding it under `/tmp/.eve`, which keeps the test
 * inside its own directory.
 */

/** What eve's `bash` answers a command that finished. */
interface Completed {
  readonly status: "completed";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A sandbox root with a checkout standing one directory below it, as the coding agent's does. */
function sandboxRoot() {
  const root = mkdtempSync(join(tmpdir(), "coder-shell-"));
  const checkout = join(root, "repository");
  mkdirSync(checkout);
  return { root, checkout };
}

/** A child's output as the web stream eve reads a sandbox process's output from. */
function webBytes(output: Readable): ReadableStream<Uint8Array> {
  // SAFETY: a child's stdio carries bytes, so the web stream over it yields Uint8Array chunks.
  return Readable.toWeb(output) as ReadableStream<Uint8Array>;
}

/** A sandbox whose every process is a POSIX shell started at the root given, with only its builtins. */
function shellSandbox(root: string) {
  return {
    spawn: async ({ command }: SandboxSpawnOptions) => {
      const child = spawn("/bin/sh", ["-c", command], { cwd: root, env: { PATH: root } });
      const exited = once(child, "exit");
      return {
        stdout: webBytes(child.stdout),
        stderr: webBytes(child.stderr),
        wait: async () => {
          await exited;
          // A shell killed by a signal has no exit code of its own, and reads as failed.
          return { exitCode: child.exitCode ?? 1 };
        },
      };
    },
  };
}

function unreached(name: string): () => never {
  return () => assert.fail(`${name} is not reached by the shell`);
}

/** The shell started in the checkout given, called as eve calls a tool, over a sandbox rooted at the root given. */
async function run(root: string, checkout: string, command: string): Promise<Completed> {
  const shell = bashStartingIn(checkout);
  const context: EveToolContext = {
    session: {
      id: "session-1",
      auth: { current: null, initiator: null },
      turn: { id: "turn_0", sequence: 0 },
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: "bash",
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    // SAFETY: the shell reaches the sandbox only to spawn the command, which is what the double answers.
    getSandbox: (async () => shellSandbox(root)) as unknown as EveToolContext["getSandbox"],
  };
  const answer = await shell.execute({ command }, context);
  assert.ok(!(Symbol.asyncIterator in answer) && answer.status === "completed");
  return answer;
}

test("a command starts in the checkout, and a `cd` lasts only for the call it is in", async () => {
  const { root, checkout } = sandboxRoot();
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
  assert.equal((await run(root, checkout, "cd .. && pwd")).stdout.trim(), root);
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
});

test("the command's own exit and output come back whole, a multi-line script and a heredoc among them", async () => {
  const { root, checkout } = sandboxRoot();
  const failed = await run(root, checkout, "echo out\necho err >&2\nexit 3");
  assert.deepEqual(
    { exitCode: failed.exitCode, stdout: failed.stdout, stderr: failed.stderr },
    { exitCode: 3, stdout: "out\n", stderr: "err\n" },
  );
  const read = await run(
    root,
    checkout,
    "while read -r line; do echo \"[$line]\"; done <<'EOF'\na b\nEOF",
  );
  assert.equal(read.stdout, "[a b]\n");
});

test("a checkout that is not there fails the call and runs nothing at the sandbox's root", async () => {
  const { root } = sandboxRoot();
  const answer = await run(root, join(root, "missing"), "echo ran; pwd");
  assert.notEqual(answer.exitCode, 0);
  assert.equal(answer.stdout, "");
});
