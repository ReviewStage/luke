import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { Redacted } from "effect";
import type { SandboxSpawnOptions } from "eve/sandbox";
import type { ToolContext as EveToolContext } from "eve/tools";
import { test } from "vitest";
import { bashStartingIn } from "./shell.js";
import { MASKED_SECRET, type ShellEnvironment } from "./workspace-environment.js";

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
 * inside its own directory. A command's description is for the developer's
 * transcript, so it reaches the shell as nothing, and what the model is
 * offered is recorded the way the wire's schemas are. A workspace's
 * variables and secrets stand in the command's environment as they were
 * saved, and a secret's value never stands in what the command answers.
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

/** The shell started in the checkout given, called as eve calls a tool with the command and what it is for where given, over a sandbox rooted at the root given. */
async function run(
  root: string,
  checkout: string,
  command: string,
  description?: string,
  environment?: ShellEnvironment,
): Promise<Completed> {
  const shell = bashStartingIn(
    checkout,
    environment === undefined ? undefined : async () => environment,
  );
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
  const input = description === undefined ? { command } : { command, description };
  const answer = await shell.execute(input, context);
  assert.ok(!(Symbol.asyncIterator in answer) && answer.status === "completed");
  return answer;
}

test("a command starts in the checkout, and a `cd` lasts only for the call it is in", async () => {
  const { root, checkout } = sandboxRoot();
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
  assert.equal((await run(root, checkout, "cd .. && pwd")).stdout.trim(), root);
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
});

/** A workspace's environment as the host reads it: a variable, and a secret to be masked. */
const WORKSPACE: ShellEnvironment = {
  values: [
    ["APP_MODE", Redacted.make('it\'s a "dev" $HOME run')],
    ["STRIPE_KEY", Redacted.make("sk_test_secret_value")],
  ],
  secrets: [Redacted.make("sk_test_secret_value")],
};

test("a workspace's variables stand in the command's environment exactly as they were saved", async () => {
  const { root, checkout } = sandboxRoot();
  const answer = await run(root, checkout, 'printf "%s" "$APP_MODE"', undefined, WORKSPACE);
  assert.equal(answer.stdout, `it's a "dev" $HOME run`);
});

test("a secret reaches the command, but its value is masked out of everything the command answers", async () => {
  const { root, checkout } = sandboxRoot();
  const answer = await run(
    root,
    checkout,
    'printf "key=%s" "$STRIPE_KEY"; printf "also %s" "$STRIPE_KEY" >&2; [ -n "$STRIPE_KEY" ]',
    undefined,
    WORKSPACE,
  );
  assert.deepEqual(
    [answer.exitCode, answer.stdout, answer.stderr],
    [0, `key=${MASKED_SECRET}`, `also ${MASKED_SECRET}`],
  );
});

test("a command run with no environment sees none of a workspace's names", async () => {
  const { root, checkout } = sandboxRoot();
  const answer = await run(root, checkout, 'printf "[%s]" "$APP_MODE"');
  assert.equal(answer.stdout, "[]");
});
