import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { cloneFolder, openOnMacScript, worktreesFolder } from "./open-on-mac.js";

/**
 * Open on this Mac's script over real Git and bash, an origin on disk
 * standing in for GitHub: a run clones it into Luke's own folder, opens the
 * shell in a fresh worktree at the agent's branch as it stands, and removes
 * that worktree once the shell exits, so a branch the agent force-pushed
 * opens as readily as one it pushed more to; a worktree an earlier terminal
 * left behind is swept once the process that made it is gone, and one still
 * open is kept; a clone over HTTPS that fails is made over SSH; a branch
 * that cannot be fetched is said and the shell still opens.
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
  // The developer's login shell: asked for its PATH it answers as sh does; opened for them, it notes where it stands and what is checked out there.
  const shell = path.join(scratch, "login-shell");
  writeFileSync(
    shell,
    '#!/bin/sh\nif [ "$1" = "-l" ] && [ "$#" -eq 1 ]; then pwd > "$HOME/shell-opened-in"; git rev-parse HEAD > "$HOME/shell-saw-head" 2>/dev/null; cat README.md > "$HOME/shell-saw-readme" 2>/dev/null; true; else exec /bin/sh "$@"; fi\n',
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
const shellSawHead = (scratch: string) =>
  readFileSync(path.join(scratch, "shell-saw-head"), "utf8").trim();
const shellSawReadme = (scratch: string) =>
  readFileSync(path.join(scratch, "shell-saw-readme"), "utf8");

/** The worktrees Git knows of in the clone, the clone's own checkout left out. */
const worktreesOf = (clone: string) =>
  git(clone, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .slice(1);

test("an open clones into Luke's folder, opens the shell in a fresh worktree at the branch, and removes it once the shell exits", async (t) => {
  const { scratch, origin, push, shell, state } = await fixture(t);
  const head = push("first\n");
  const clone = cloneFolder(state, "Octocat/Relay");
  const worktrees = worktreesFolder(state, "Octocat/Relay");

  run(
    scratch,
    shell,
    openOnMacScript({
      repository: "Octocat/Relay",
      clone,
      worktrees,
      branch: "luke/fix-relay",
      remotes: { https: origin, ssh: origin },
    }),
  );

  assert.equal(clone, path.join(state, "clones", "octocat", "relay"));
  assert.equal(worktrees, path.join(state, "worktrees", "octocat", "relay"));
  assert.equal(path.dirname(shellOpenedIn(scratch)), worktrees);
  assert.equal(shellSawHead(scratch), head);
  assert.deepEqual(readdirSync(worktrees), [], "the worktree and its note are gone");
  assert.deepEqual(worktreesOf(clone), []);
  assert.throws(() => readFileSync(path.join(scratch, "open.sh")), "the script deletes itself");
});

test("a branch the agent force-pushed opens at its new head, as one it pushed more to does", async (t) => {
  const { scratch, origin, push, shell, state } = await fixture(t);
  push("first\n");
  const script = openOnMacScript({
    repository: "acme/app",
    clone: cloneFolder(state, "acme/app"),
    worktrees: worktreesFolder(state, "acme/app"),
    branch: "luke/fix-relay",
    remotes: { https: origin, ssh: origin },
  });
  run(scratch, shell, script);

  git(origin, ["reset", "--quiet", "--hard", "main"]);
  const rewritten = push("rewritten\n");
  const printed = run(scratch, shell, script);

  assert.doesNotMatch(printed, /Could not bring/u);
  assert.equal(shellSawHead(scratch), rewritten);
  assert.equal(shellSawReadme(scratch), "rewritten\n");
});

test("a worktree left by a terminal that is gone is swept, and one still open is kept", async (t) => {
  const { scratch, origin, push, shell, state } = await fixture(t);
  push("first\n");
  const clone = cloneFolder(state, "acme/app");
  const worktrees = worktreesFolder(state, "acme/app");
  const script = openOnMacScript({
    repository: "acme/app",
    clone,
    worktrees,
    branch: "luke/fix-relay",
    remotes: { https: origin, ssh: origin },
  });
  run(scratch, shell, script);
  // Two terminals' worktrees as an app that quit hard would leave them: one whose process ended, one whose is still running.
  const left = path.join(worktrees, "luke-fix-relay.left");
  const open = path.join(worktrees, "luke-fix-relay.open");
  git(clone, ["worktree", "add", "--quiet", "--detach", left, "origin/luke/fix-relay"]);
  git(clone, ["worktree", "add", "--quiet", "--detach", open, "origin/luke/fix-relay"]);
  const ended = spawnSync("/bin/sh", ["-c", "exit 0"]).pid;
  writeFileSync(`${left}.pid`, `${ended}\n`);
  writeFileSync(`${open}.pid`, `${process.pid}\n`);

  run(scratch, shell, script);

  assert.equal(existsSync(left), false);
  assert.equal(existsSync(`${left}.pid`), false);
  assert.equal(existsSync(open), true);
  assert.deepEqual(worktreesOf(clone), [`worktree ${open}`]);
});

test("a clone over HTTPS that fails is made over SSH", async (t) => {
  const { scratch, origin, push, shell, state } = await fixture(t);
  const head = push("first\n");

  run(
    scratch,
    shell,
    openOnMacScript({
      repository: "acme/app",
      clone: cloneFolder(state, "acme/app"),
      worktrees: worktreesFolder(state, "acme/app"),
      branch: "luke/fix-relay",
      remotes: { https: path.join(scratch, "nowhere"), ssh: origin },
    }),
  );

  assert.equal(shellSawHead(scratch), head);
});

test("a branch that cannot be fetched is said, and the shell still opens, in Luke's clone", async (t) => {
  const { scratch, origin, shell, state } = await fixture(t);
  const clone = cloneFolder(state, "acme/app");
  const worktrees = worktreesFolder(state, "acme/app");

  const printed = run(
    scratch,
    shell,
    openOnMacScript({
      repository: "acme/app",
      clone,
      worktrees,
      branch: "luke/gone",
      remotes: { https: origin, ssh: origin },
    }),
  );

  assert.match(printed, /Could not bring luke\/gone onto this Mac/u);
  assert.equal(shellOpenedIn(scratch), clone);
  assert.deepEqual(readdirSync(worktrees), []);
});

test("a run command runs as written in the worktree, quotes and dollars and all, before the shell opens", async (t) => {
  const { scratch, origin, push, shell, state } = await fixture(t);
  push("first\n");

  run(
    scratch,
    shell,
    openOnMacScript({
      repository: "acme/app",
      clone: cloneFolder(state, "acme/app"),
      worktrees: worktreesFolder(state, "acme/app"),
      branch: "luke/fix-relay",
      command: `printf '%s' "it's \\$HOME" > "$HOME/said.txt"; pwd > "$HOME/ran-in"`,
      remotes: { https: origin, ssh: origin },
    }),
  );

  assert.equal(readFileSync(path.join(scratch, "said.txt"), "utf8"), "it's $HOME");
  assert.equal(readFileSync(path.join(scratch, "ran-in"), "utf8").trim(), shellOpenedIn(scratch));
});
