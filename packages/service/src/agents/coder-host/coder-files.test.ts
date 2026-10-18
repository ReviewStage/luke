import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import type { SandboxCommandResult, SandboxRunOptions } from "eve/sandbox";
import type { ToolContext as EveToolContext } from "eve/tools";
import { test } from "vitest";
import { linuxShellPath } from "../../testing/linux-shell-tools.js";
import { applyPatchIn, grepIn, readFileIn } from "./files.js";

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
  // Note that the root is resolved, because a Mac's temporary directory sits behind a
  // symlink (`/var` is `/private/var`) and eve patches the resolved path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "coder-files-")));
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

/** A sandbox double: the directory sandbox, or as much of one as a test's tool reaches. */
type SandboxDouble = Partial<ReturnType<typeof directorySandbox>["sandbox"]>;

/** A tool's context as eve hands it, over the sandbox given. */
function context(sandbox: SandboxDouble): EveToolContext {
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

/** A checkout under a directory sandbox that is a git work tree, holding the files given, as `apply_patch` requires one. */
function gitCheckout(files: Record<string, string>) {
  const made = directorySandbox();
  execFileSync("git", ["init", "--quiet", made.checkout]);
  for (const [path, contents] of Object.entries(files))
    writeFileSync(join(made.checkout, path), contents);
  return made;
}

test("apply_patch applies two Update sections of one file in the order written", async () => {
  const { checkout, sandbox } = gitCheckout({ "list.txt": "one\ntwo\nthree\nfour\n" });
  const patch = applyPatchIn(checkout);
  const patchText = [
    "*** Begin Patch",
    "*** Update File: list.txt",
    "@@",
    "-one",
    "+ONE",
    "*** Update File: list.txt",
    "@@",
    " three",
    "-four",
    "+FOUR",
    "*** End Patch",
  ].join("\n");
  await whole(patch.execute({ patchText }, context(sandbox)));
  assert.equal(readFileSync(join(checkout, "list.txt"), "utf8"), "ONE\ntwo\nthree\nFOUR\n");
});

test("apply_patch refuses Update sections of one file written bottom to top rather than edit a repeat of a line", async () => {
  const { checkout, sandbox } = gitCheckout({ "list.txt": "same\nmiddle\nsame\n" });
  const patch = applyPatchIn(checkout);
  const patchText = [
    "*** Begin Patch",
    "*** Update File: list.txt",
    "@@",
    "-middle",
    "+MIDDLE",
    "*** Update File: list.txt",
    "@@",
    "-same",
    "+SAME",
    "*** End Patch",
  ].join("\n");
  await assert.rejects(
    whole(patch.execute({ patchText }, context(sandbox))),
    /overlapping file operations/,
  );
  assert.equal(readFileSync(join(checkout, "list.txt"), "utf8"), "same\nmiddle\nsame\n");
});

test("apply_patch applies a patch written without its Begin and End lines", async () => {
  const { checkout, sandbox } = gitCheckout({ "list.txt": "one\ntwo\n" });
  const patch = applyPatchIn(checkout);
  const patchText = [
    "*** Update File: list.txt",
    "@@",
    "-two",
    "+TWO",
    "*** Add File: new.txt",
    "+fresh",
  ].join("\n");
  await whole(patch.execute({ patchText }, context(sandbox)));
  assert.equal(readFileSync(join(checkout, "list.txt"), "utf8"), "one\nTWO\n");
  assert.equal(readFileSync(join(checkout, "new.txt"), "utf8"), "fresh\n");
});

test("apply_patch still refuses an Add and an Update of one file, saying how to write it", async () => {
  const { checkout, sandbox } = gitCheckout({});
  const patch = applyPatchIn(checkout);
  const patchText = [
    "*** Begin Patch",
    "*** Add File: new.txt",
    "+fresh",
    "*** Update File: new.txt",
    "@@",
    "-fresh",
    "+stale",
    "*** End Patch",
  ].join("\n");
  await assert.rejects(
    whole(patch.execute({ patchText }, context(sandbox))),
    /overlapping file operations[\s\S]*give an added, deleted, or moved file no other section/,
  );
  assert.equal(existsSync(join(checkout, "new.txt")), false);
});

test("apply_patch tells the model to re-read a file another writer changed while it patched", async () => {
  const { checkout, sandbox } = gitCheckout({ "list.txt": "one\n" });
  const target = join(checkout, "list.txt");
  let reads = 0;
  const racing = {
    ...sandbox,
    // The second read of the file is the check before the write: another writer gets there first.
    readTextFile: ({ path }: { path: string }) => {
      if (path === target && ++reads === 2) writeFileSync(target, "someone else\n");
      return sandbox.readTextFile({ path });
    },
  };
  const patch = applyPatchIn(checkout);
  const patchText = [
    "*** Begin Patch",
    "*** Update File: list.txt",
    "@@",
    "-one",
    "+ONE",
    "*** End Patch",
  ].join("\n");
  await assert.rejects(
    whole(patch.execute({ patchText }, context(racing))),
    /stale write[\s\S]*Re-read the file and patch it again/,
  );
  assert.equal(readFileSync(target, "utf8"), "someone else\n");
});

test("grep searches a pattern that is not a valid regex as a fixed string, and says so", async () => {
  const sandbox = {
    resolvePath: (path: string) => (path === "" ? "/workspace" : path),
    run: ({ command }: SandboxRunOptions): Promise<SandboxCommandResult> => {
      const realpath = /^realpath -z -- '(.*)'$/u.exec(command);
      if (realpath !== null)
        return Promise.resolve({ exitCode: 0, stdout: `${realpath[1]}\0`, stderr: "" });
      return Promise.resolve(
        command.includes("--fixed-strings")
          ? { exitCode: 0, stdout: "/workspace/repository/store.ts\n", stderr: "" }
          : {
              exitCode: 2,
              stdout:
                "rg: regex parse error:\n    (?:ensureWorkspace(\n    ^\nerror: unclosed group\n",
              stderr: "",
            },
      );
    },
  };
  const search = grepIn("/workspace/repository");
  const answer = await whole(search.execute({ pattern: "ensureWorkspace(" }, context(sandbox)));
  assert.match(answer.content, /searched as a fixed string/);
  assert.match(answer.content, /\/workspace\/repository\/store\.ts/);
});
