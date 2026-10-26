import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, it } from "vitest";
import { gitCommonDir } from "./launch.js";

const GIT_ENVIRONMENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@luke.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@luke.test",
};

const made: string[] = [];

afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function git(folder: string, args: readonly string[]) {
  execFileSync("git", args, { cwd: folder, env: GIT_ENVIRONMENT, stdio: "ignore" });
}

/** A clone with one commit, and a worktree of it elsewhere, as a local agent's is made. */
function cloneWithWorktree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "luke-git-common-")));
  made.push(root);
  const clone = join(root, "clone");
  const worktree = join(root, "agents", "repository");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", clone], {
    env: GIT_ENVIRONMENT,
  });
  writeFileSync(join(clone, "README.md"), "main\n");
  git(clone, ["add", "--all"]);
  git(clone, ["commit", "--quiet", "-m", "main"]);
  git(clone, ["worktree", "add", "--quiet", "--detach", worktree]);
  return { root, clone, worktree };
}

describe("gitCommonDir", () => {
  it("names the clone's Git folder a worktree commits to, none for a clone's own checkout, and none a rewritten .git points outside Luke's clones", () => {
    const { root, clone, worktree } = cloneWithWorktree();
    const elsewhere = cloneWithWorktree();

    assert.strictEqual(gitCommonDir(worktree, root), join(clone, ".git"));
    assert.strictEqual(gitCommonDir(clone, root), undefined);
    assert.strictEqual(gitCommonDir(worktree, join(elsewhere.root, "clone")), undefined);
  });
});
