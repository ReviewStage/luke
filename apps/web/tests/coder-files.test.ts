import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import type { SandboxCommandResult, SandboxRunOptions } from "eve/sandbox";
import type { ToolContext as EveToolContext } from "eve/tools";
import { test } from "vitest";
import { readFileIn } from "../server/hosted/coder-host/files";
import { linuxShellPath } from "./support/linux-shell-tools";

/**
 * The coding agent's file tools resolve every path from the checkout: a
 * relative path lands inside it, an absolute one is taken as written, a
 * directory left out is the checkout, and `apply_patch` patches the
 * checkout unless told another root. One tool stands for each of those
 * shapes. The sandbox is a directory the test made, standing for the
 * sandbox's root with the checkout one directory below it: a command runs
 * in a real POSIX shell there, and a file read, written, or removed is the
 * directory's own. Note that the sandbox answers `read_file` no file and
 * keeps the path it was asked for, since a read that finds one ends in
 * eve's own session context, which these tests do not stand up, and the
 * path the sandbox is asked for is the whole of what the tool decides.
 */

const SANDBOX_PATH = linuxShellPath();

/** A command in a real shell started at the directory given, as eve's sandbox runs one. */
async function runShell(cwd: string, run: SandboxRunOptions): Promise<SandboxCommandResult> {
  const env = { ...process.env, PATH: SANDBOX_PATH, ...run.env };
  const child = spawn("/bin/sh", ["-c", run.command], { cwd, env });
  const closed = once(child, "close");
  const [stdout, stderr] = await Promise.all([text(child.stdout), text(child.stderr)]);
  const [exitCode] = await closed;
  // A shell killed by a signal has no exit code of its own, and reads as failed.
  return { exitCode: exitCode ?? 1, stdout, stderr };
}

/** A sandbox rooted at a directory the test made, with a checkout one directory below it, as the coding agent's stands. */
function directorySandbox() {
  const root = mkdtempSync(join(tmpdir(), "coder-files-"));
  const checkout = join(root, "repository");
  mkdirSync(checkout);
  const reads: string[] = [];
  const sandbox = {
    resolvePath: (path: string) => (path === "" ? root : path),
    run: (run: SandboxRunOptions) => runShell(root, run),
    readBinaryFile: ({ path }: { path: string }) => {
      reads.push(path);
      return Promise.resolve(null);
    },
    readTextFile: ({ path }: { path: string }) =>
      Promise.resolve(existsSync(path) ? readFileSync(path, "utf8") : null),
    writeTextFile: ({ path, content }: { path: string; content: string }) => {
      writeFileSync(path, content);
      return Promise.resolve();
    },
    removePath: ({ path }: { path: string }) => {
      rmSync(path, { force: true, recursive: true });
      return Promise.resolve();
    },
  };
  return { root, checkout, reads, sandbox };
}

/** A tool's answer, which the file tools return whole rather than streamed. */
async function whole<T extends object>(answer: T | Promise<T> | AsyncIterable<T>): Promise<T> {
  const settled = await answer;
  assert.ok(!(Symbol.asyncIterator in settled));
  return settled;
}

function unreached(name: string): () => never {
  return () => assert.fail(`${name} is not reached by a file tool`);
}

/** A tool's context as eve hands it, over the sandbox given. */
function context(sandbox: ReturnType<typeof directorySandbox>["sandbox"]): EveToolContext {
  return {
    session: {
      id: "session-1",
      auth: { current: null, initiator: null },
      turn: { id: "turn_0", sequence: 0 },
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: "file-tool",
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    // SAFETY: the tools reach the sandbox only through the methods the double answers.
    getSandbox: (async () => sandbox) as unknown as EveToolContext["getSandbox"],
  };
}

test("read_file resolves a relative path from the checkout and takes an absolute one as written", async () => {
  const { root, checkout, reads, sandbox } = directorySandbox();
  const read = readFileIn(checkout);
  await assert.rejects(
    whole(read.execute({ filePath: "notes.md" }, context(sandbox))),
    /File not found/,
  );
  await assert.rejects(
    whole(read.execute({ filePath: join(root, "notes.md") }, context(sandbox))),
    /File not found/,
  );
  assert.deepEqual(reads, [join(checkout, "notes.md"), join(root, "notes.md")]);
});
