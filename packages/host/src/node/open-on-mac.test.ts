import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { cloneFolder, openOnMacScript, worktreeFolder, worktreesRoot } from "./open-on-mac.js";

/**
 * Open on this Mac's script over real Git and bash, an origin on disk
 * standing in for GitHub: the first run clones it into Luke's own folder
 * and makes a worktree on the agent's branch, tracking GitHub's; a later run after the agent pushes more, or
 * force-pushes, brings the worktree to the branch's new head and keeps what
 * Git ignores there; a worktree with the developer's own changes, or
 * commits of theirs GitHub does not have, is left as it stands and its run
 * command not run; a clone over HTTPS that fails is made over SSH; a branch
 * that cannot be fetched is said and the run ends there; the run ends with
 * its command, whose exit is the run's, and opens no shell to type in; one
 * with no command says where to set one; a branch GitHub
 * deleted once its pull request merged opens at that pull request's last
 * head; a worktree folder deleted by hand is made again; one an earlier
 * Luke kept under its application data is left there and said; two opens of
 * the shared clone at once each bring in their own branch; one waits on a
 * clone another holds while it lives, and takes the lock over once it is
 * gone; an open tidies the worktrees, this Luke's and an earlier one's,
 * whose branch is gone from GitHub, unless one is in use, was opened in the
 * last day, or holds the developer's own, and an earlier Luke's clone once
 * it holds none; and no two
 * branches share a worktree or reach outside its repository's folder.
 */

const GIT_ENVIRONMENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@luke.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@luke.test",
};

// Note that a test here runs real Git and bash, which a macOS runner has taken past vitest's 5s default.
const GIT_DEADLINE = 30_000;

function git(folder: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: folder, env: GIT_ENVIRONMENT, encoding: "utf8" }).trim();
}

/** An origin with `main` and an agent's branch pushed to it, and the state root Luke keeps its clone in. */
async function fixture(t: Parameters<typeof temporaryDirectory>[0]) {
  const scratch = await temporaryDirectory(t, "luke-open-on-mac-");
  const origin = path.join(scratch, "origin");
  mkdirSync(origin);
  git(origin, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(path.join(origin, "README.md"), "main\n");
  git(origin, ["add", "--all"]);
  git(origin, ["commit", "--quiet", "-m", "main"]);
  git(origin, ["checkout", "--quiet", "-b", "luke/fix-relay"]);
  // Note that a clone filters blobs only from a server allowing it, as GitHub does; a local origin is asked to.
  git(origin, ["config", "uploadpack.allowFilter", "true"]);
  const push = (text: string) => {
    writeFileSync(path.join(origin, "README.md"), text);
    git(origin, ["commit", "--quiet", "-am", text.trim()]);
    return git(origin, ["rev-parse", "HEAD"]);
  };
  // The developer's login shell: asked for its PATH it answers as sh does; opened for them, it notes where it stands.
  const shell = path.join(scratch, "login-shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-l" ] && [ "$#" -eq 1 ]; then pwd > "$HOME/shell-opened-in"; else exec /bin/sh "$@"; fi\n',
    { mode: 0o700 },
  );
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
  "the first open clones into Luke's folder and makes the branch's worktree; a later one moves it forward and keeps what was made there",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const first = push("first\n");
    const clone = cloneFolder(state, "Octocat/Relay");
    const worktree = worktreeFolder(state, "Octocat/Relay", "luke/fix-relay");
    const script = () =>
      openOnMacScript({
        repository: "Octocat/Relay",
        clone,
        worktree,
        branch: "luke/fix-relay",
        remotes: { https: origin, ssh: origin },
      });

    run(scratch, shell, script());
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), first);
    // Note that the worktree is on the branch itself, as a script naming its run by the branch reads it.
    assert.equal(git(worktree, ["symbolic-ref", "--short", "HEAD"]), "luke/fix-relay");
    assert.equal(
      git(worktree, ["rev-parse", "--abbrev-ref", "@{upstream}"]),
      "origin/luke/fix-relay",
    );
    // What an install leaves, which the repository ignores, as `node_modules` is.
    writeFileSync(path.join(clone, ".git", "info", "exclude"), "installed.txt\n");
    writeFileSync(path.join(worktree, "installed.txt"), "");
    const second = push("second\n");
    run(scratch, shell, script());

    assert.equal(clone, path.join(state, "clones", "octocat", "relay"));
    assert.equal(worktree, path.join(state, "worktrees", "octocat", "relay", "luke+2Ffix-relay"));
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), second);
    assert.equal(readFileSync(path.join(worktree, "README.md"), "utf8"), "second\n");
    assert.equal(readFileSync(path.join(worktree, "installed.txt"), "utf8"), "");
    assert.throws(() => readFileSync(path.join(scratch, "open.sh")), "the script deletes itself");
  },
  GIT_DEADLINE,
);

test(
  "a clone over HTTPS that fails is made over SSH",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");

    run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        remotes: { https: path.join(scratch, "nowhere"), ssh: origin },
      }),
    );

    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
  },
  GIT_DEADLINE,
);

test(
  "a branch that cannot be fetched is said, and the run ends there, its command not run",
  async (t) => {
    const { scratch, origin, shell, state } = await fixture(t);
    const clone = cloneFolder(state, "acme/app");

    const { printed, code } = runEnded(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone,
        worktree: worktreeFolder(state, "acme/app", "luke/gone"),
        branch: "luke/gone",
        command: "touch ran",
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.match(printed, /Could not bring luke\/gone onto this Mac/u);
    assert.equal(code, 1);
    assert.equal(existsSync(path.join(clone, "ran")), false);
  },
  GIT_DEADLINE,
);

test(
  "a run command runs as written in the worktree, quotes and dollars and all",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");

    run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        command: `printf '%s' "it's \\$HOME" > said.txt`,
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.equal(readFileSync(path.join(worktree, "said.txt"), "utf8"), "it's $HOME");
  },
  GIT_DEADLINE,
);

test(
  "a branch the agent force-pushed opens at its new head",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = openOnMacScript({
      repository: "acme/app",
      clone: cloneFolder(state, "acme/app"),
      worktree,
      branch: "luke/fix-relay",
      command: "touch ran",
      remotes: { https: origin, ssh: origin },
    });
    run(scratch, shell, script);
    git(worktree, ["clean", "--quiet", "--force"]);

    git(origin, ["reset", "--quiet", "--hard", "main"]);
    const rewritten = push("rewritten\n");
    const printed = run(scratch, shell, script);

    assert.doesNotMatch(printed, /Could not bring/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), rewritten);
    assert.equal(readFileSync(path.join(worktree, "README.md"), "utf8"), "rewritten\n");
    assert.equal(existsSync(path.join(worktree, "ran")), true);
  },
  GIT_DEADLINE,
);

test(
  "a worktree with the developer's own changes is left as it stands, and its run command not run",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const first = push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = (command?: string) =>
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        command,
        remotes: { https: origin, ssh: origin },
      });
    run(scratch, shell, script());
    writeFileSync(path.join(worktree, "README.md"), "mine\n");

    push("second\n");
    const printed = run(scratch, shell, script("touch ran"));

    assert.match(printed, /changes of its own/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), first);
    assert.equal(readFileSync(path.join(worktree, "README.md"), "utf8"), "mine\n");
    assert.equal(existsSync(path.join(worktree, "ran")), false);
  },
  GIT_DEADLINE,
);

test(
  "a worktree with commits of the developer's own not on GitHub is left as it stands, and its run command not run",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = (command?: string) =>
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        command,
        remotes: { https: origin, ssh: origin },
      });
    run(scratch, shell, script());
    writeFileSync(path.join(worktree, "README.md"), "mine\n");
    git(worktree, ["commit", "--quiet", "-am", "mine"]);
    const mine = git(worktree, ["rev-parse", "HEAD"]);

    push("second\n");
    const printed = run(scratch, shell, script("touch ran"));

    assert.match(printed, /commits of its own/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), mine);
    assert.equal(existsSync(path.join(worktree, "ran")), false);
  },
  GIT_DEADLINE,
);

test(
  "a worktree from before Luke marked its head, detached with a commit of the developer's own, is left as it stands",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = openOnMacScript({
      repository: "acme/app",
      clone: cloneFolder(state, "acme/app"),
      worktree,
      branch: "luke/fix-relay",
      command: "touch ran",
      remotes: { https: origin, ssh: origin },
    });
    run(scratch, shell, script);
    git(worktree, ["update-ref", "-d", "refs/worktree/luke-opened"]);
    git(worktree, ["checkout", "--quiet", "--detach"]);
    git(worktree, ["clean", "--quiet", "--force"]);
    writeFileSync(path.join(worktree, "README.md"), "mine\n");
    git(worktree, ["commit", "--quiet", "-am", "mine"]);
    const mine = git(worktree, ["rev-parse", "HEAD"]);

    const printed = run(scratch, shell, script);

    assert.match(printed, /commits of its own/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), mine);
    assert.equal(existsSync(path.join(worktree, "ran")), false);
  },
  GIT_DEADLINE,
);

test(
  "a branch the developer committed to in Luke's clone is left as it stands",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const clone = cloneFolder(state, "acme/app");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = openOnMacScript({
      repository: "acme/app",
      clone,
      worktree,
      branch: "luke/fix-relay",
      remotes: { https: origin, ssh: origin },
    });
    run(scratch, shell, script);
    git(clone, ["worktree", "remove", "--force", worktree]);
    git(clone, ["checkout", "--quiet", "luke/fix-relay"]);
    writeFileSync(path.join(clone, "README.md"), "mine\n");
    git(clone, ["commit", "--quiet", "-am", "mine"]);
    const mine = git(clone, ["rev-parse", "HEAD"]);

    const printed = run(scratch, shell, script);

    assert.match(printed, /has commits of its own/u);
    assert.equal(git(clone, ["rev-parse", "luke/fix-relay"]), mine);
  },
  GIT_DEADLINE,
);

test(
  "a branch GitHub deleted once its pull request merged opens at the pull request's last head",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("merged\n");
    git(origin, ["update-ref", "refs/pull/3270/head", head]);
    git(origin, ["checkout", "--quiet", "main"]);
    git(origin, ["branch", "--quiet", "-D", "luke/fix-relay"]);
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");

    const printed = run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        pullRequest: 3270,
        command: "touch ran",
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.match(printed, /fetching the last head of pull request #3270/u);
    assert.doesNotMatch(printed, /Could not bring/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.equal(existsSync(path.join(worktree, "ran")), true);
  },
  GIT_DEADLINE,
);

test(
  "a worktree folder deleted by hand is made again",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const script = openOnMacScript({
      repository: "acme/app",
      clone: cloneFolder(state, "acme/app"),
      worktree,
      branch: "luke/fix-relay",
      remotes: { https: origin, ssh: origin },
    });
    run(scratch, shell, script);
    rmSync(worktree, { recursive: true, force: true });
    const second = push("second\n");

    const printed = run(scratch, shell, script);

    assert.doesNotMatch(printed, /Could not bring/u);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), second);
  },
  GIT_DEADLINE,
);

test(
  "a worktree an earlier Luke kept under its application data is left there and said, and a fresh one made",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const earlierRoot = path.join(scratch, "Application Support", "Luke Dev");
    const earlier = path.join(earlierRoot, "worktrees", "acme", "app", "luke%2Ffix-relay");
    mkdirSync(path.join(earlier, ".git"), { recursive: true });
    writeFileSync(path.join(earlier, "mine.txt"), "");
    const root = path.join(state, ".luke");
    const worktree = worktreeFolder(root, "acme/app", "luke/fix-relay");

    const printed = run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(root, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        remotes: { https: origin, ssh: origin },
        earlier: { worktrees: path.dirname(earlier) },
      }),
    );

    assert.match(printed, /An earlier worktree of luke\/fix-relay stays at .*luke%2Ffix-relay/u);
    assert.equal(existsSync(path.join(earlier, "mine.txt")), true);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
  },
  GIT_DEADLINE,
);

test(
  "two opens of the shared clone at once, before it is made, each bring in their own branch",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const relay = push("relay\n");
    git(origin, ["checkout", "--quiet", "-b", "luke/other", "main"]);
    writeFileSync(path.join(origin, "README.md"), "other\n");
    git(origin, ["commit", "--quiet", "-am", "other"]);
    const other = git(origin, ["rev-parse", "HEAD"]);
    const root = path.join(state, ".luke");
    const opening = (branch: string, name: string) => {
      const file = path.join(scratch, `${name}.sh`);
      writeFileSync(
        file,
        openOnMacScript({
          repository: "acme/app",
          clone: cloneFolder(root, "acme/app"),
          worktree: worktreeFolder(root, "acme/app", branch),
          branch,
          remotes: { https: origin, ssh: origin },
        }),
        { mode: 0o700 },
      );
      // Note that each open answers what it printed, so an open that failed says which step of Git refused it.
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
      opening("luke/fix-relay", "one"),
      opening("luke/other", "two"),
    ]);
    // Note that once the clone is made, six opens at once each fetch into it, make a worktree of it and write its config, which only the lock keeps from refusing each other.
    const more = ["a", "b", "c", "d", "e", "f"].map((name) => `luke/more-${name}`);
    for (const branch of more) git(origin, ["branch", branch, "main"]);
    const then = await Promise.all(more.map((branch, index) => opening(branch, `more-${index}`)));
    const said = [...first, ...then].join("\n");
    for (const branch of more) {
      assert.ok(existsSync(worktreeFolder(root, "acme/app", branch)), said);
      assert.equal(
        git(worktreeFolder(root, "acme/app", branch), ["config", `branch.${branch}.remote`]),
        "origin",
        said,
      );
    }

    assert.ok(existsSync(worktreeFolder(root, "acme/app", "luke/fix-relay")), first.join("\n"));
    assert.ok(existsSync(worktreeFolder(root, "acme/app", "luke/other")), first.join("\n"));
    assert.equal(
      git(worktreeFolder(root, "acme/app", "luke/fix-relay"), ["rev-parse", "HEAD"]),
      relay,
    );
    assert.equal(git(worktreeFolder(root, "acme/app", "luke/other"), ["rev-parse", "HEAD"]), other);
  },
  GIT_DEADLINE,
);

test("the shared root sits in the home folder, its path holding no space", () => {
  assert.equal(worktreesRoot("/Users/someone"), "/Users/someone/.luke");
});

test(
  "an open waits on a clone another holds while it lives, and takes the lock over once it is gone",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const root = path.join(state, ".luke");
    const clone = cloneFolder(root, "acme/app");
    const worktree = worktreeFolder(root, "acme/app", "luke/fix-relay");
    const holder = spawn("sleep", ["60"]);
    mkdirSync(`${clone}.lock`, { recursive: true });
    writeFileSync(path.join(`${clone}.lock`, "pid"), String(holder.pid));
    const file = path.join(scratch, "open.sh");
    writeFileSync(
      file,
      openOnMacScript({
        repository: "acme/app",
        clone,
        worktree,
        branch: "luke/fix-relay",
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

    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.equal(existsSync(`${clone}.lock`), false);
  },
  GIT_DEADLINE,
);

test(
  "the run ends with its command, and its exit is the command's",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const { code } = runEnded(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree: worktreeFolder(state, "acme/app", "luke/fix-relay"),
        branch: "luke/fix-relay",
        command: "exit 7",
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.equal(code, 7);
    // Note that the developer's login shell is never opened to type in.
    assert.equal(existsSync(path.join(scratch, "shell-opened-in")), false);
  },
  GIT_DEADLINE,
);

test(
  "a repository with no run command on this Mac brings the branch in and says where to set one",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    const head = push("first\n");
    const worktree = worktreeFolder(state, "acme/app", "luke/fix-relay");
    const { printed, code } = runEnded(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(state, "acme/app"),
        worktree,
        branch: "luke/fix-relay",
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.match(printed, /No run command is set/u);
    assert.equal(code, 0);
  },
  GIT_DEADLINE,
);

test(
  "an open tidies the worktrees whose branch is gone from GitHub, unless in use, opened in the last day, or holding the developer's own",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    const root = path.join(state, ".luke");
    const trash = path.join(root, "trash");
    const branches = ["luke/merged", "luke/changed", "luke/recent", "luke/running", "luke/open"];
    for (const branch of branches) git(origin, ["branch", branch]);
    const open = (branch: string) =>
      run(
        scratch,
        shell,
        openOnMacScript({
          repository: "acme/app",
          clone: cloneFolder(root, "acme/app"),
          worktree: worktreeFolder(root, "acme/app", branch),
          branch,
          remotes: { https: origin, ssh: origin },
          trash,
        }),
      );
    for (const branch of branches) open(branch);
    const folder = (branch: string) => worktreeFolder(root, "acme/app", branch);
    const gitDir = (branch: string) => git(folder(branch), ["rev-parse", "--absolute-git-dir"]);
    const daysAgo = (branch: string) => {
      const then = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      utimesSync(path.join(gitDir(branch), "luke-opened-at"), then, then);
    };
    for (const branch of ["luke/merged", "luke/changed", "luke/running", "luke/open"])
      daysAgo(branch);
    writeFileSync(path.join(folder("luke/changed"), "README.md"), "mine\n");
    const holder = spawn("sleep", ["60"]);
    t.onTestFinished(() => void holder.kill());
    writeFileSync(path.join(gitDir("luke/running"), "luke-running"), String(holder.pid));
    for (const branch of ["luke/merged", "luke/changed", "luke/recent", "luke/running"])
      git(origin, ["branch", "-D", branch]);

    const printed = open("luke/fix-relay");

    assert.match(printed, /Removed the worktree of luke\/merged/u);
    assert.equal(existsSync(folder("luke/merged")), false);
    assert.doesNotMatch(
      git(cloneFolder(root, "acme/app"), ["worktree", "list"]),
      /luke\+2Fmerged/u,
    );
    for (const kept of ["luke/changed", "luke/recent", "luke/running", "luke/open"])
      assert.equal(existsSync(path.join(folder(kept), ".git")), true, kept);
    assert.deepEqual(existsSync(trash) ? readdirSync(trash) : [], []);
  },
  GIT_DEADLINE,
);

test(
  "an open tidies an earlier Luke's worktree whose branch is gone, and its clone once it holds none",
  async (t) => {
    const { scratch, origin, push, shell, state } = await fixture(t);
    push("first\n");
    git(origin, ["branch", "luke/merged"]);
    const earlierRoot = path.join(scratch, "Application Support", "Luke Dev");
    const earlierClone = cloneFolder(earlierRoot, "acme/app");
    const earlierWorktree = worktreeFolder(earlierRoot, "acme/app", "luke/merged");
    run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: earlierClone,
        worktree: earlierWorktree,
        branch: "luke/merged",
        remotes: { https: origin, ssh: origin },
      }),
    );
    const opened = path.join(
      git(earlierWorktree, ["rev-parse", "--absolute-git-dir"]),
      "luke-opened-at",
    );
    const then = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(opened, then, then);
    git(origin, ["branch", "-D", "luke/merged"]);
    const root = path.join(state, ".luke");

    const printed = run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone: cloneFolder(root, "acme/app"),
        worktree: worktreeFolder(root, "acme/app", "luke/fix-relay"),
        branch: "luke/fix-relay",
        remotes: { https: origin, ssh: origin },
        earlier: { worktrees: path.dirname(earlierWorktree), clone: earlierClone },
        trash: path.join(root, "trash"),
      }),
    );

    assert.match(printed, /Removed the worktree of luke\/merged/u);
    assert.match(printed, /Removed the clone an earlier Luke kept/u);
    assert.equal(existsSync(earlierWorktree), false);
    assert.equal(existsSync(earlierClone), false);
  },
  GIT_DEADLINE,
);

test("two branches never share a worktree, none reaches outside the repository's folder, and none holds a %", () => {
  const folders = ["luke/a-b", "luke/a/b", "luke%2Fa-b", "luke+2Fa-b"].map((branch) =>
    worktreeFolder("/state", "acme/app", branch),
  );

  assert.equal(new Set(folders).size, folders.length);
  for (const folder of folders) {
    assert.equal(path.dirname(folder), "/state/worktrees/acme/app");
    assert.doesNotMatch(path.basename(folder), /%/u);
  }
});
