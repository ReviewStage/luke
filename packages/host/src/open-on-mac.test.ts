import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { openOnMacScript, worktreeFolder } from "./open-on-mac.js";

/**
 * Open on this Mac's script over real Git and bash: run in a developer's
 * clone of an origin that holds an agent's pushed branch, it makes a
 * worktree at the branch's head and runs the command there; run again after
 * the agent pushes more, it moves the worktree forward and keeps what the
 * last run installed; and values with quotes in them stay values.
 */

const GIT_ENVIRONMENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@luke.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@luke.test",
};

function git(folder: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: folder, env: GIT_ENVIRONMENT, encoding: "utf8" }).trim();
}

/** An origin with `main`, a developer's clone of it, and an agent's branch pushed to the origin. */
async function fixture(t: Parameters<typeof temporaryDirectory>[0]) {
  const scratch = await temporaryDirectory(t, "luke-open-on-mac-");
  const origin = path.join(scratch, "origin");
  mkdirSync(origin);
  git(origin, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(path.join(origin, "README.md"), "main\n");
  git(origin, ["add", "--all"]);
  git(origin, ["commit", "--quiet", "-m", "main"]);
  const clone = path.join(scratch, "clone");
  git(scratch, ["clone", "--quiet", origin, clone]);
  git(origin, ["checkout", "--quiet", "-b", "luke/fix-relay"]);
  const push = (text: string) => {
    writeFileSync(path.join(origin, "README.md"), text);
    git(origin, ["commit", "--quiet", "-am", text.trim()]);
    return git(origin, ["rev-parse", "HEAD"]);
  };
  return { scratch, origin, clone, push };
}

/** The script run as Terminal would run it, the shell after the command a no-op so the test ends. */
function run(scratch: string, script: string): void {
  const file = path.join(scratch, "open.command");
  writeFileSync(file, script, { mode: 0o700 });
  execFileSync("/bin/bash", [file], {
    env: { ...GIT_ENVIRONMENT, HOME: scratch, SHELL: "/bin/sh" },
    stdio: "ignore",
  });
}

test("the agent's branch is checked out in a worktree of the clone and the command runs there; a later run moves it forward and keeps what was installed", async (t) => {
  const { scratch, clone, push } = await fixture(t);
  const first = push("first\n");
  const worktree = worktreeFolder(path.join(scratch, "state"), "Octocat/Relay", "luke/fix-relay");
  const script = () =>
    openOnMacScript({
      clone,
      worktree,
      branch: "luke/fix-relay",
      command: "git rev-parse HEAD > ran.txt; touch installed.txt",
    });

  run(scratch, script());
  assert.equal(readFileSync(path.join(worktree, "ran.txt"), "utf8").trim(), first);
  const second = push("second\n");
  run(scratch, script());

  assert.equal(
    worktree,
    path.join(scratch, "state", "worktrees", "octocat", "relay", "luke%2Ffix-relay"),
  );
  assert.equal(readFileSync(path.join(worktree, "ran.txt"), "utf8").trim(), second);
  assert.equal(readFileSync(path.join(worktree, "README.md"), "utf8"), "second\n");
  assert.equal(readFileSync(path.join(worktree, "installed.txt"), "utf8"), "");
  // The developer's own checkout is left on its branch.
  assert.equal(git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
});

test("a command with quotes and dollars in it runs as written, and the script deletes itself", async (t) => {
  const { scratch, clone, push } = await fixture(t);
  push("first\n");
  const worktree = path.join(scratch, "worktree");

  run(
    scratch,
    openOnMacScript({
      clone,
      worktree,
      branch: "luke/fix-relay",
      command: `printf '%s' "it's \\$HOME" > said.txt`,
    }),
  );

  assert.equal(readFileSync(path.join(worktree, "said.txt"), "utf8"), "it's $HOME");
  assert.throws(() => readFileSync(path.join(scratch, "open.command")));
});

test("two branches never share a worktree, and none reaches outside the repository's folder", () => {
  const folders = ["luke/a-b", "luke/a/b", "luke%2Fa-b"].map((branch) =>
    worktreeFolder("/state", "acme/app", branch),
  );

  assert.equal(new Set(folders).size, folders.length);
  for (const folder of folders) assert.equal(path.dirname(folder), "/state/worktrees/acme/app");
});
