import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import type { SandboxCommandResult, SandboxRunOptions } from "eve/sandbox";
import type { ToolContext as EveToolContext } from "eve/tools";
import { test } from "vitest";
import { applyPatchIn, globIn, readFileIn } from "../server/hosted/coder-host/files";

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

/**
 * The PATH a sandbox command runs on. eve's `apply_patch` resolves its root
 * with GNU `realpath -e`, which the coding agent's Linux sandbox has and a
 * Mac's BSD `realpath` refuses. Note that we put a `realpath` taking `-e`
 * ahead of the host's when the host's refuses it, because BSD `realpath`
 * already fails on a missing path, which is all `-e` asks.
 */
function sandboxPath(): string {
  const hostPath = process.env.PATH ?? "";
  try {
    execFileSync("/bin/sh", ["-c", "realpath -e /"], { stdio: "ignore" });
    return hostPath;
  } catch {
    const host = execFileSync("/bin/sh", ["-c", "command -v realpath"], {
      encoding: "utf8",
    }).trim();
    const shims = mkdtempSync(join(tmpdir(), "coder-files-path-"));
    const shim = join(shims, "realpath");
    writeFileSync(shim, `#!/bin/sh\n[ "$1" = -e ] && shift\nexec ${host} "$@"\n`);
    chmodSync(shim, 0o755);
    return `${shims}:${hostPath}`;
  }
}

const SANDBOX_PATH = sandboxPath();

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

test("glob searches the checkout unless told a directory", async () => {
  const { root, checkout, sandbox } = directorySandbox();
  writeFileSync(join(checkout, "notes.md"), "hello\n");
  writeFileSync(join(root, "elsewhere.md"), "hello\n");
  const find = globIn(checkout);
  const inCheckout = await whole(find.execute({ pattern: "*.md" }, context(sandbox)));
  assert.deepEqual(
    { path: inCheckout.path, content: inCheckout.content },
    { path: checkout, content: join(checkout, "notes.md") },
  );
  const atRoot = await whole(find.execute({ pattern: "*.md", path: root }, context(sandbox)));
  assert.equal(atRoot.path, root);
  assert.ok(atRoot.content.includes(join(root, "elsewhere.md")));
});

test("apply_patch patches the checkout when told no root", async () => {
  const { checkout, sandbox } = directorySandbox();
  assert.equal((await runShell(checkout, { command: "git init -q" })).exitCode, 0);
  const patch = applyPatchIn(checkout);
  const patchText = "*** Begin Patch\n*** Add File: notes.md\n+hello\n*** End Patch\n";
  const applied = await whole(patch.execute({ patchText }, context(sandbox)));
  assert.deepEqual(applied.files, [{ operation: "add", path: "notes.md" }]);
  assert.equal(readFileSync(join(checkout, "notes.md"), "utf8"), "hello\n");
});
