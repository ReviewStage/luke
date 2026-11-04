import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { temporaryDirectory } from "@repo/runtime/testing";
import { test } from "vitest";
import {
  agentSalvageScript,
  agentUnsavedWorkScript,
  agentWorktreeScript,
  cloneFolder,
  WORKTREE_LOCK_BUSY,
} from "./open-on-mac.js";

/**
 * A local agent's scripts over real Git and bash, an origin on disk standing
 * in for GitHub: an agent gets a repository of its own at its branch's head,
 * made from the app's shared clone, which a clone over HTTPS that fails makes
 * over SSH; two launches at once before the clone is made each bring in their
 * own branch, none taking the lock from one that took it after the holder it
 * read let go; one waits on a clone another holds while it lives, takes the
 * lock over once it is gone, and gives up, leaving a live holder's lock, once
 * it has waited its bound; a transfer from a remote that never answers fails
 * rather than hangs; a discard finds work in an agent's
 * repository only where something of it is nowhere else; and a salvage keeps
 * an agent's changes as a diff that applies, and past its bound keeps its
 * commits and changes but not its untracked files, saying so.
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

test(
  "a clone over HTTPS that fails is made over SSH",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");

    run(
      scratch,
      shell,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: path.join(scratch, "agents", "agent", "repository"),
        branch: "agent/fix-relay",
        remotes: { https: path.join(scratch, "nowhere"), ssh: origin },
      }),
    );

    assert.equal(git(clone, ["rev-parse", "refs/remotes/origin/agent/fix-relay"]), head);
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
          remotes: { https: origin, ssh: origin },
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
    for (const index of more.keys()) {
      assert.ok(existsSync(path.join(own(`more-${index}`), ".git")), said);
    }

    assert.equal(git(own("one"), ["rev-parse", "HEAD"]), relay, first.join("\n"));
    assert.equal(git(own("two"), ["rev-parse", "HEAD"]), other, first.join("\n"));
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
        remotes: { https: origin, ssh: origin },
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
  "a launch gives up waiting on a clone a live holder keeps past its bound, and leaves the holder's lock",
  async (t) => {
    const { scratch, origin, shell, state } = await fixture(t);
    const clone = cloneFolder(state, "acme/app");
    const lock = `${clone}.lock`;
    const holder = spawn("sleep", ["60"]);
    t.onTestFinished(() => void holder.kill());
    mkdirSync(lock, { recursive: true });
    writeFileSync(path.join(lock, "pid"), String(holder.pid));

    const ended = runEnded(
      scratch,
      shell,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: path.join(scratch, "agents", "agent", "repository"),
        branch: "agent/fix-relay",
        remotes: { https: origin, ssh: origin },
        seconds: { stall: 60, lockWait: 1 },
      }),
    );

    assert.equal(ended.code, WORKTREE_LOCK_BUSY);
    assert.equal(readFileSync(path.join(lock, "pid"), "utf8"), String(holder.pid));
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
        remotes: {
          https: `http://127.0.0.1:${address.port}/acme/app.git`,
          ssh: path.join(scratch, "nowhere"),
        },
        seconds: { stall: 1, lockWait: 60 },
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
  "a launch that finds the holder it read gone leaves the lock to the one that took it since",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const own = path.join(scratch, "agents", "agent", "repository");
    const lock = `${clone}.lock`;
    // The holder the launch first reads, which has let go and ended, and the one that took the lock after it, alive.
    const gone = spawnSync("true").pid;
    const next = spawn("sleep", ["60"]);
    t.onTestFinished(() => void next.kill());
    mkdirSync(lock, { recursive: true });
    writeFileSync(path.join(lock, "pid"), String(next.pid));
    // Note that the launch's first read of the lock answers the holder before, as a read made just before that holder let go would; every later read is the file's own.
    const tools = path.join(scratch, "tools");
    mkdirSync(tools);
    writeFileSync(
      path.join(tools, "cat"),
      [
        "#!/bin/sh",
        'if [ "$1" = "$LOCK_PID" ] && [ ! -e "$LOCK_PID_READ" ]; then',
        '  : > "$LOCK_PID_READ"',
        '  printf %s "$GONE"',
        "  exit 0",
        "fi",
        'exec /bin/cat "$@"',
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    const file = path.join(scratch, "open.sh");
    writeFileSync(
      file,
      agentWorktreeScript({
        repository: "acme/app",
        clone,
        worktree: own,
        branch: "agent/fix-relay",
        remotes: { https: origin, ssh: origin },
      }),
      { mode: 0o700 },
    );
    const ended = new Promise<void>((resolve) =>
      execFile(
        "/bin/bash",
        [file],
        {
          env: {
            ...GIT_ENVIRONMENT,
            PATH: `${tools}:${GIT_ENVIRONMENT.PATH}`,
            HOME: scratch,
            SHELL: shell,
            LOCK_PID: path.join(lock, "pid"),
            LOCK_PID_READ: path.join(scratch, "lock-pid-read"),
            GONE: String(gone),
          },
        },
        () => resolve(),
      ),
    );

    // Wait for the launch to read the holder, however slow the machine, then give it the time it had to act on what it read.
    const read = path.join(scratch, "lock-pid-read");
    for (let waited = 0; !existsSync(read) && waited < 20_000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(existsSync(read), true);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    assert.equal(existsSync(path.join(clone, ".git")), false);
    assert.equal(readFileSync(path.join(lock, "pid"), "utf8"), String(next.pid));
    next.kill();
    await ended;

    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
    assert.equal(existsSync(lock), false);
  },
  GIT_DEADLINE,
);

test(
  "two local agents starting from one branch each get a repository of their own at its head, and one already made keeps the agent's work",
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
        remotes: { https: origin, ssh: origin },
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
  "an agent gets a repository of its own at the branch's head, which works with the shared clone out of reach and has the rest from GitHub",
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
        remotes: { https: origin, ssh: origin },
      }),
    );
    // Note that the agent's repository stands on its own, so the shared clone is moved out of reach.
    rmSync(clone, { recursive: true, force: true });

    assert.equal(git(own, ["rev-parse", "HEAD"]), head);
    assert.equal(readFileSync(path.join(own, "README.md"), "utf8"), "second\n");
    assert.equal(git(own, ["status", "--porcelain"]), "");
    assert.equal(git(own, ["remote", "get-url", "origin"]), origin);
    assert.equal(git(own, ["show", "HEAD~1:README.md"]), "first");
  },
  GIT_DEADLINE,
);

test(
  "a discard finds work in an agent's worktree only where it is changed, ahead of its upstream, on no remote branch, on a branch left checked out or not, stashed, or has files and no repository",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = path.join(scratch, "agents", "one", "repository");
    run(
      scratch,
      shell,
      agentWorktreeScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "agent/fix-relay",
        remotes: { https: origin, ssh: origin },
      }),
    );
    const found = () =>
      runEnded(scratch, shell, agentUnsavedWorkScript({ worktree })).printed.trim();
    const commit = (name: string) => {
      writeFileSync(path.join(worktree, name), `${name}\n`);
      git(worktree, ["add", "--all"]);
      git(worktree, ["commit", "--quiet", "-m", name]);
    };

    assert.equal(found(), "", "a clean worktree on GitHub's head holds nothing");

    // Note that the developer's own Git setting that hides untracked files must not hide them here.
    git(worktree, ["config", "status.showUntrackedFiles", "no"]);

    writeFileSync(path.join(worktree, "notes.md"), "unsaved\n");
    assert.match(found(), /changes not committed/u);
    git(worktree, ["add", "--all"]);
    git(worktree, ["commit", "--quiet", "-m", "notes"]);
    assert.match(found(), /no remote branch/u, "a commit on a detached head, on no upstream");

    git(worktree, ["checkout", "--quiet", "--track", "-b", "mine", "origin/agent/fix-relay"]);
    assert.equal(found(), "", "a branch level with its upstream holds nothing");
    commit("ahead.md");
    assert.match(found(), /its upstream does not/u);

    git(worktree, ["checkout", "--quiet", "-b", "unpublished", "origin/agent/fix-relay"]);
    git(worktree, ["branch", "--unset-upstream"]);
    assert.match(found(), /a branch with commits/u, "a branch left for another keeps its commits");
    git(worktree, ["branch", "--quiet", "-D", "mine"]);
    assert.equal(found(), "", "a branch with no upstream and no commits of its own holds nothing");
    writeFileSync(path.join(worktree, "README.md"), "stashed\n");
    git(worktree, ["stash", "--quiet"]);
    assert.match(found(), /stashed/u);
    git(worktree, ["stash", "drop", "--quiet"]);
    commit("local.md");
    assert.match(found(), /no remote branch/u);

    const plain = path.join(scratch, "agents", "plain", "repository");
    mkdirSync(plain, { recursive: true });
    assert.equal(
      runEnded(scratch, shell, agentUnsavedWorkScript({ worktree: plain })).printed,
      "",
      "an empty folder holds nothing",
    );
    writeFileSync(path.join(plain, "report.md"), "written by an agent with no repository\n");
    assert.match(
      runEnded(scratch, shell, agentUnsavedWorkScript({ worktree: plain })).printed,
      /no repository/u,
    );

    const missing = path.join(scratch, "agents", "none", "repository");
    assert.deepEqual(
      runEnded(scratch, shell, agentUnsavedWorkScript({ worktree: missing })),
      { printed: "", code: 0 },
      "an agent that never had a worktree holds nothing",
    );
  },
  GIT_DEADLINE,
);

test(
  "a salvage keeps an agent's changes as a diff that applies, and past its bound keeps its commits and changes but not its untracked files, saying so",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = path.join(scratch, "agents", "one", "repository");
    run(
      scratch,
      shell,
      agentWorktreeScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "agent/fix-relay",
        remotes: { https: origin, ssh: origin },
      }),
    );
    writeFileSync(path.join(worktree, "fix.md"), "unpushed\n");
    git(worktree, ["add", "fix.md"]);
    git(worktree, ["commit", "--quiet", "-m", "fix"]);
    writeFileSync(path.join(worktree, "README.md"), "changed\n");
    writeFileSync(path.join(worktree, "big.bin"), "x".repeat(64 * 1024));
    const salvage = path.join(state, "salvage", "one", "1");

    const ran = runEnded(
      scratch,
      shell,
      agentSalvageScript({ worktree, salvage, maxBytes: 32 * 1024 }),
    );

    assert.equal(ran.code, 0);
    assert.match(ran.printed, /^commits commits\.bundle$/mu);
    assert.match(ran.printed, /^changes changes\.diff$/mu);
    assert.match(ran.printed, /^skipped the untracked files/mu);
    assert.equal(existsSync(path.join(salvage, "untracked.tar")), false);
    git(worktree, ["checkout", "--quiet", "--", "README.md"]);
    git(worktree, ["apply", path.join(salvage, "changes.diff")]);
    assert.equal(readFileSync(path.join(worktree, "README.md"), "utf8"), "changed\n");
  },
  GIT_DEADLINE,
);
