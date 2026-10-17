import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { cloneFolder, openOnMacScript, worktreeFolder } from "./open-on-mac.js";

/**
 * Open on this Mac's script over real Git and bash, an origin on disk
 * standing in for GitHub: the first run clones it into Luke's own folder
 * and makes a worktree at the agent's branch, and the shell opens there; a
 * later run after the agent pushes more moves the worktree forward and keeps
 * what was made in it; a clone over HTTPS that fails is made over SSH; a
 * branch that cannot be fetched is said and the shell still opens; and no
 * two branches share a worktree.
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

/** The script run as the terminal would run it; what it printed. */
function run(scratch: string, shell: string, script: string): string {
  const file = path.join(scratch, "open.sh");
  writeFileSync(file, script, { mode: 0o700 });
  return execFileSync("/bin/bash", [file], {
    env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: shell },
    encoding: "utf8",
  });
}

const shellOpenedIn = (scratch: string) =>
  readFileSync(path.join(scratch, "shell-opened-in"), "utf8").trim();

test(
  "the first open clones into Luke's folder and opens a shell in the branch's worktree; a later one moves it forward and keeps what was made there",
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
    assert.equal(shellOpenedIn(scratch), worktree);
    writeFileSync(path.join(worktree, "installed.txt"), "");
    const second = push("second\n");
    run(scratch, shell, script());

    assert.equal(clone, path.join(state, "clones", "octocat", "relay"));
    assert.equal(worktree, path.join(state, "worktrees", "octocat", "relay", "luke%2Ffix-relay"));
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
  "a branch that cannot be fetched is said, and the shell still opens, in Luke's clone",
  async (t) => {
    const { scratch, origin, shell, state } = await fixture(t);
    const clone = cloneFolder(state, "acme/app");

    const printed = run(
      scratch,
      shell,
      openOnMacScript({
        repository: "acme/app",
        clone,
        worktree: worktreeFolder(state, "acme/app", "luke/gone"),
        branch: "luke/gone",
        remotes: { https: origin, ssh: origin },
      }),
    );

    assert.match(printed, /Could not bring luke\/gone onto this Mac/u);
    assert.equal(shellOpenedIn(scratch), clone);
  },
  GIT_DEADLINE,
);

test(
  "a run command runs as written in the worktree, quotes and dollars and all, before the shell opens",
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
    assert.equal(shellOpenedIn(scratch), worktree);
  },
  GIT_DEADLINE,
);

test("two branches never share a worktree, and none reaches outside the repository's folder", () => {
  const folders = ["luke/a-b", "luke/a/b", "luke%2Fa-b"].map((branch) =>
    worktreeFolder("/state", "acme/app", branch),
  );

  assert.equal(new Set(folders).size, folders.length);
  for (const folder of folders) assert.equal(path.dirname(folder), "/state/worktrees/acme/app");
});
