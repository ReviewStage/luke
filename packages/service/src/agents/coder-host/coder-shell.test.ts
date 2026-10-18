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
import { bashStartingIn } from "./shell.js";

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
 * offered is recorded the way the wire's schemas are. A command whose
 * outcome Vercel Sandbox's API lost, as `@vercel/sandbox` and undici throw
 * it, answers that it is unknown, and any other failure stands as eve threw it.
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

/** A sandbox as the doubles here stand for one: a real shell, or one whose API loses what it ran. */
type SandboxDouble = ReturnType<typeof shellSandbox> | ReturnType<typeof sandboxLosing>;

/** The context eve calls a tool in, over the sandbox given. */
function contextOver(sandbox: SandboxDouble): EveToolContext {
  return {
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
    // SAFETY: the shell reaches the sandbox only to spawn and run commands, which is what the doubles answer.
    getSandbox: (async () => sandbox) as unknown as EveToolContext["getSandbox"],
  };
}

/** The shell started in the directory given, called as eve calls a tool with the command given, over the sandbox given. */
async function call(directory: string, sandbox: SandboxDouble, command: string) {
  const answer = await bashStartingIn(directory).execute({ command }, contextOver(sandbox));
  assert.ok(!(Symbol.asyncIterator in answer));
  return answer;
}

/** The shell started in the checkout given, called as eve calls a tool with the command and what it is for where given, over a sandbox rooted at the root given. */
async function run(
  root: string,
  checkout: string,
  command: string,
  description?: string,
): Promise<Completed> {
  const shell = bashStartingIn(checkout);
  const input = description === undefined ? { command } : { command, description };
  const answer = await shell.execute(input, contextOver(shellSandbox(root)));
  assert.ok(!(Symbol.asyncIterator in answer) && answer.status === "completed");
  return answer;
}

test("a command starts in the checkout, and a `cd` lasts only for the call it is in", async () => {
  const { root, checkout } = sandboxRoot();
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
  assert.equal((await run(root, checkout, "cd .. && pwd")).stdout.trim(), root);
  assert.equal((await run(root, checkout, "pwd")).stdout.trim(), checkout);
});

/**
 * What `@vercel/sandbox` throws for an answer of Vercel Sandbox's API that
 * is not ok: its status and words in the message, and the response it read
 * them from.
 */
function sandboxApiError(status: number, words: string): Error {
  return Object.assign(new Error(`Status code ${status} is not ok: ${words}`), {
    response: new Response(JSON.stringify({ error: { message: words } }), { status }),
  });
}

/** What undici's fetch throws where the other side closes the socket of a response it is still reading. */
function streamCut(): Error {
  const closed = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  return new TypeError("terminated", { cause: closed });
}

/** An output stream that ends at once, with nothing in it. */
function nothing(): ReadableStream<Uint8Array> {
  return webBytes(Readable.from([]));
}

/** A sandbox whose every command starts, then whose wait for it fails as given. */
function sandboxLosing(failure: Error) {
  return {
    spawn: async () => ({
      stdout: nothing(),
      stderr: nothing(),
      wait: async () => {
        throw failure;
      },
    }),
  };
}

test("a command whose output Vercel answered 404 for answers that its outcome is unknown", async () => {
  const lost = sandboxApiError(404, "Vercel Sandbox not found.");
  const answer = await call("/workspace/repository", sandboxLosing(lost), "git push");
  assert.equal(answer.status, "unknown");
  assert.ok("message" in answer && answer.message.includes("before you run it again"));
});

test("a command whose output stream Vercel cut answers that its outcome is unknown", async () => {
  const answer = await call("/workspace/repository", sandboxLosing(streamCut()), "pnpm test");
  assert.equal(answer.status, "unknown");
});

test("a failure Vercel's API did not lose a command to fails as eve failed it", async () => {
  const refused = sandboxApiError(403, "Forbidden.");
  await assert.rejects(call("/workspace/repository", sandboxLosing(refused), "ls"), refused);
});
