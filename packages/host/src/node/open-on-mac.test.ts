import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { temporaryDirectory } from "@repo/runtime/testing";
import { test } from "vitest";
import { agentWorktreeScript, cloneFolder } from "./open-on-mac.js";

/**
 * A local agent's worktree script over real Git and bash, an origin on disk standing
 * in for GitHub: an agent gets a worktree of the box's shared clone,
 * detached at its branch's head, which the clone lists; a first clone cut
 * off midway leaves nothing at the clone's place; two launches at once
 * before the clone is made each bring in their own branch, and two agents
 * fetch into the clone at once; one waits on a clone another holds while
 * it lives, and takes the lock over once it is gone; a transfer from a remote that
 * never answers fails rather than hangs; and a make that fails or was cut
 * off leaves nothing that blocks the next.
 */

const GIT_ENVIRONMENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@app.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@app.test",
};

// Note that a test here runs real Git and bash, which a macOS runner has taken past vitest's 5s default.
const GIT_DEADLINE = 30_000;

function git(folder: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: folder, env: GIT_ENVIRONMENT, encoding: "utf8" }).trim();
}

/** An origin with `main` and an agent's branch pushed to it, and the state root the app keeps its clone in. */
async function fixture(t: Parameters<typeof temporaryDirectory>[0]) {
  const scratch = await temporaryDirectory(t, "open-on-mac-");
  const origin = path.join(scratch, "origin");
  mkdirSync(origin);
  git(origin, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(path.join(origin, "README.md"), "main\n");
  git(origin, ["add", "--all"]);
  git(origin, ["commit", "--quiet", "-m", "main"]);
  git(origin, ["checkout", "--quiet", "-b", "agent/fix-relay"]);
  // Note that a clone filters blobs only from a server allowing it, as GitHub does; a local origin is asked to.
  git(origin, ["config", "uploadpack.allowFilter", "true"]);
  const push = (text: string) => {
    writeFileSync(path.join(origin, "README.md"), text);
    git(origin, ["commit", "--quiet", "-am", text.trim()]);
    return git(origin, ["rev-parse", "HEAD"]);
  };
  // The developer's login shell, which answers as sh does.
  const shell = path.join(scratch, "login-shell");
  writeFileSync(shell, '#!/bin/sh\nexec /bin/sh "$@"\n', { mode: 0o700 });
  const state = path.join(scratch, "state");
  return { scratch, origin, push, shell, state };
}

/** The script run as the terminal would run it: what it printed, and how it ended. */
function runEnded(scratch: string, shell: string, script: string) {
  const file = path.join(scratch, "open.sh");
  writeFileSync(file, script, { mode: 0o700 });
  const ran = spawnSync("/bin/bash", [file], {
    env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell },
    encoding: "utf8",
  });
  return { printed: ran.stdout, code: ran.status };
}

/** What the script printed, run as the terminal would run it. */
function run(scratch: string, shell: string, script: string): string {
  return runEnded(scratch, shell, script).printed;
}

/** The folders given, each as its real path, sorted, as `worktreesListed` answers them. */
function realPaths(folders: readonly string[]): string[] {
  return folders.map((folder) => realpathSync(folder)).sort();
}

/** The worktrees the shared clone lists, its own among them, each as its real path, sorted. */
function worktreesListed(clone: string): string[] {
  const listed = git(clone, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  return realPaths(listed);
}

test(
  "a first clone cut off midway leaves nothing at the clone's place, and the next launch makes it",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    // A server that takes every connection and says nothing, so the clone stands midway until it is cut off.
    const sockets = new Set<Socket>();
    const silent = createServer((socket) => sockets.add(socket));
    t.onTestFinished(() => {
      for (const socket of sockets) socket.destroy();
      silent.close();
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const address = silent.address();
    assert.ok(address !== null && typeof address === "object");
    const clone = cloneFolder(state, "acme/app");
    const own = path.join(scratch, "agents", "agent", "repository");
    const script = (remote: string) =>
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: own,
        branch: "agent/fix-relay",
        remote,
      });
    const file = path.join(scratch, "open.sh");
    writeFileSync(file, script(`http://127.0.0.1:${address.port}/acme/app.git`), { mode: 0o700 });
    const child = spawn("/bin/bash", [file], {
      env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell },
      stdio: "ignore",
      detached: true,
    });
    const ended = new Promise<void>((resolve) => child.on("exit", () => resolve()));

    // Note that the launch is killed whole once its clone has begun, as a restart kills it, so nothing of it has a say in what it leaves.
    for (let waited = 0; sockets.size === 0 && waited < 20_000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(sockets.size > 0, "the clone never began");
    assert.ok(child.pid !== undefined);
    process.kill(-child.pid, "SIGKILL");
    await ended;

    assert.equal(existsSync(clone), false);
    run(scratch, shell, script(origin));
    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
  },
  GIT_DEADLINE,
);

test(
  "two launches at once, before the shared clone is made, each bring in their own branch",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const relay = push("relay\n");
    git(origin, ["checkout", "--quiet", "-b", "agent/other", "main"]);
    writeFileSync(path.join(origin, "README.md"), "other\n");
    git(origin, ["commit", "--quiet", "-am", "other"]);
    const other = git(origin, ["rev-parse", "HEAD"]);
    const clone = cloneFolder(state, "acme/app");
    const own = (name: string) => path.join(scratch, "agents", name, "repository");
    const launching = (branch: string, name: string) => {
      const file = path.join(scratch, `${name}.sh`);
      writeFileSync(
        file,
        agentWorktreeScript({
          repository: "acme/app",
          clone,
          worktree: own(name),
          branch,
          remote: origin,
        }),
        { mode: 0o700 },
      );
      // Note that each launch answers what it printed, so one that failed says which step of Git refused it.
      return new Promise<string>((resolve) =>
        execFile(
          "/bin/bash",
          [file],
          { env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell } },
          (_error, stdout, stderr) => resolve(`${branch}:\n${stdout}${stderr}`),
        ),
      );
    };

    const first = await Promise.all([
      launching("agent/fix-relay", "one"),
      launching("agent/other", "two"),
    ]);
    // Note that once the clone is made, six launches at once each fetch into it, which only the lock keeps from refusing each other.
    const more = ["a", "b", "c", "d", "e", "f"].map((name) => `agent/more-${name}`);
    for (const branch of more) git(origin, ["branch", branch, "main"]);
    const then = await Promise.all(more.map((branch, index) => launching(branch, `more-${index}`)));
    const said = [...first, ...then].join("\n");
    for (const name of ["one", "two", ...more.map((_, index) => `more-${index}`)]) {
      assert.ok(existsSync(path.join(own(name), ".git")), said);
    }
    // Note that two agents then fetch into the one clone at once, under no lock of ours.
    const fetching = (worktree: string) =>
      new Promise<string>((resolve) =>
        execFile(
          "git",
          ["fetch", "--quiet", "origin"],
          { cwd: worktree, env: GIT_ENVIRONMENT },
          (error, _stdout, stderr) => resolve(error === null ? "" : `${worktree}: ${stderr}`),
        ),
      );
    const fetched = await Promise.all([fetching(own("one")), fetching(own("two"))]);

    assert.equal(git(own("one"), ["rev-parse", "HEAD"]), relay, first.join("\n"));
    assert.equal(git(own("two"), ["rev-parse", "HEAD"]), other, first.join("\n"));
    assert.deepEqual(
      worktreesListed(clone),
      realPaths([clone, own("one"), own("two"), ...more.map((_, index) => own(`more-${index}`))]),
      said,
    );
    assert.deepEqual(fetched, ["", ""]);
  },
  GIT_DEADLINE,
);

test(
  "a launch waits on a clone another holds while it lives, and takes the lock over once it is gone",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const own = path.join(scratch, "agents", "agent", "repository");
    const holder = spawn("sleep", ["60"]);
    mkdirSync(`${clone}.lock`, { recursive: true });
    writeFileSync(path.join(`${clone}.lock`, "pid"), String(holder.pid));
    const file = path.join(scratch, "open.sh");
    writeFileSync(
      file,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: own,
        branch: "agent/fix-relay",
        remote: origin,
      }),
      { mode: 0o700 },
    );
    const ended = new Promise<void>((resolve) =>
      execFile(
        "/bin/bash",
        [file],
        { env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell } },
        () => resolve(),
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    assert.equal(existsSync(path.join(clone, ".git")), false);
    assert.equal(existsSync(`${clone}.lock`), true);
    holder.kill();
    await ended;

    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
    assert.equal(existsSync(`${clone}.lock`), false);
  },
  GIT_DEADLINE,
);

test(
  "a clone from a remote that never answers fails once its transfer stalls, and the launch ends",
  async (t) => {
    const { scratch, shell, state } = await fixture(t);
    // A server that takes every connection and says nothing, as a dead network does.
    const sockets = new Set<Socket>();
    const silent = createServer((socket) => sockets.add(socket));
    t.onTestFinished(() => {
      for (const socket of sockets) socket.destroy();
      silent.close();
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const address = silent.address();
    assert.ok(address !== null && typeof address === "object");
    const clone = cloneFolder(state, "acme/app");
    const file = path.join(scratch, "open.sh");
    writeFileSync(
      file,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: path.join(scratch, "agents", "agent", "repository"),
        branch: "agent/fix-relay",
        remote: `http://127.0.0.1:${address.port}/acme/app.git`,
        stallSeconds: 1,
      }),
      { mode: 0o700 },
    );

    // Note that a script that hangs is killed by the test's own bound, which reads as a signal rather than a code.
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn("/bin/bash", [file], {
        env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell },
        stdio: "ignore",
      });
      const bound = setTimeout(() => child.kill("SIGKILL"), 15_000);
      child.on("exit", (status) => {
        clearTimeout(bound);
        resolve(status);
      });
    });

    assert.equal(code, 1);
    assert.equal(existsSync(`${clone}.lock`), false);
  },
  GIT_DEADLINE,
);

test(
  "two local agents starting from one branch each get a worktree of their own at its head, and one already made keeps the agent's work",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const agent = (name: string) => path.join(scratch, "agents", name, "repository");
    const script = (worktree: string) =>
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree,
        branch: "agent/fix-relay",
        remote: origin,
      });

    run(scratch, shell, script(agent("first")));
    run(scratch, shell, script(agent("second")));
    writeFileSync(path.join(agent("first"), "README.md"), "the agent's edit\n");
    push("second\n");
    run(scratch, shell, script(agent("first")));

    assert.equal(git(agent("second"), ["rev-parse", "HEAD"]), head);
    assert.equal(git(agent("first"), ["rev-parse", "HEAD"]), head);
    assert.equal(
      readFileSync(path.join(agent("first"), "README.md"), "utf8"),
      "the agent's edit\n",
    );
  },
  GIT_DEADLINE,
);

test(
  "an agent's worktree is the shared clone's, which lists it, detached at the branch's head with its files checked out and its history",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const head = push("second\n");
    const clone = cloneFolder(state, "acme/app");
    const own = path.join(scratch, "agents", "agent", "repository");

    run(
      scratch,
      shell,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: own,
        branch: "agent/fix-relay",
        remote: origin,
      }),
    );

    assert.deepEqual(worktreesListed(clone), realPaths([clone, own]));
    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
    assert.equal(git(own, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD", "its head is detached");
    assert.equal(readFileSync(path.join(own, "README.md"), "utf8"), "second\n");
    assert.equal(git(own, ["status", "--porcelain"]), "");
    assert.equal(git(own, ["show", "HEAD~1:README.md"]), "first");
  },
  GIT_DEADLINE,
);

test(
  "a make that fails after its worktree is added takes the worktree and its entry away, so the next launch starts clean",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const own = path.join(scratch, "agents", "agent", "repository");
    const script = agentWorktreeScript({
      repository: "acme/app",
      clone,
      worktree: own,
      branch: "agent/fix-relay",
      remote: origin,
    });
    // A folder in the worktree's place holding files and no repository, which the make never takes away, so its last step fails.
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, "notes.md"), "kept\n");

    const ended = runEnded(scratch, shell, script);

    assert.equal(ended.code, 1);
    assert.deepEqual(worktreesListed(clone), realPaths([clone]));
    assert.equal(existsSync(`${own}.making`), false);
    assert.equal(readFileSync(path.join(own, "notes.md"), "utf8"), "kept\n");
    rmSync(own, { recursive: true });
    run(scratch, shell, script);
    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
  },
  GIT_DEADLINE,
);

test(
  "a make cut off midway leaves nothing the next launch trusts or is blocked by, its half-made worktree and locked entry taken over",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const agent = (name: string) => path.join(scratch, "agents", name, "repository");
    const script = (name: string) =>
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: agent(name),
        branch: "agent/fix-relay",
        remote: origin,
      });
    run(scratch, shell, script("other"));
    // What a launch killed while Git checked its worktree out leaves: the worktree half made beside its place, its entry still locked.
    mkdirSync(path.dirname(agent("agent")), { recursive: true });
    git(clone, [
      "worktree",
      "add",
      "--quiet",
      "--lock",
      "--detach",
      `${agent("agent")}.making`,
      head,
    ]);
    rmSync(path.join(`${agent("agent")}.making`, "README.md"));

    run(scratch, shell, script("agent"));

    assert.equal(git(agent("agent"), ["rev-parse", "HEAD"]), head);
    assert.equal(git(agent("agent"), ["status", "--porcelain"]), "");
    assert.equal(existsSync(`${agent("agent")}.making`), false);
    assert.deepEqual(worktreesListed(clone), realPaths([clone, agent("other"), agent("agent")]));
    assert.doesNotMatch(git(clone, ["worktree", "list", "--porcelain"]), /^locked/mu);
  },
  GIT_DEADLINE,
);
