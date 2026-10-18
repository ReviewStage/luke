import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = "scripts/vercel-ignore.sh";

/**
 * The Vercel project's Ignored Build Step, as set in its Git settings: the
 * script where the branch has it, and a build where it does not, since
 * Vercel fails a deployment whose step exits anything but 0 or 1.
 */
const IGNORED_BUILD_STEP =
  "[ -f scripts/vercel-ignore.sh ] && bash scripts/vercel-ignore.sh || exit 1";

/** What Vercel makes of the step's exit: 0 skips the deployment, 1 builds it, and anything else fails it. */
const VERDICT = { SKIP: "skip", BUILD: "build", FAIL: "fail" } as const;
type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/** A commit no remote holds, so the step cannot fetch it. */
const UNKNOWN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function git(root: string, ...args: string[]): string {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=Luke",
      "-c",
      "user.email=luke@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

/** A repository holding the ignore step, so its first commit has the step to run. */
async function repository(t: TestContext, withScript = true): Promise<string> {
  const root = await temporaryDirectory(t, "luke-vercel-ignore-");
  if (withScript) {
    mkdirSync(join(root, "scripts"));
    copyFileSync(join(ROOT, SCRIPT), join(root, SCRIPT));
  }
  git(root, "init", "-q", "-b", "main");
  return root;
}

let edits = 0;

/** Commits a change to one file, to `content` where given, and answers the commit. */
function commit(root: string, path: string, content?: string): string {
  edits += 1;
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content ?? `${path}, edit ${edits}\n`);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", `change ${path}`);
  return git(root, "rev-parse", "HEAD");
}

/** Runs the project's Ignored Build Step at the head, as Vercel does, from the repository's root. */
function decide(root: string, previous?: string, path = process.env.PATH): Verdict {
  const ran = spawnSync("bash", ["-c", IGNORED_BUILD_STEP], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: path,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      // Note that a branch with no successful deployment yet carries the variable empty.
      VERCEL_GIT_PREVIOUS_SHA: previous ?? "",
    },
  });
  if (ran.status === 0) return VERDICT.SKIP;
  return ran.status === 1 ? VERDICT.BUILD : VERDICT.FAIL;
}

test("a push that changes only the desktop app or the docs since the last deployment is skipped", async (t) => {
  const root = await repository(t);
  const deployed = commit(root, "apps/web/package.json");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, deployed), VERDICT.SKIP);
  commit(root, "docs/proposals/factory/index.html");
  assert.equal(decide(root, deployed), VERDICT.SKIP);
});

test("a branch that predates the script is built rather than failed", async (t) => {
  const root = await repository(t, false);
  const deployed = commit(root, "README.md");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, deployed), VERDICT.BUILD);
});

test("a push that changes anything a service installs or builds from is built", async (t) => {
  for (const path of [
    "apps/web/server/routes/plans.ts",
    "apps/luke/agent.ts",
    "apps/dev/sandbox.ts",
    "packages/service/src/index.ts",
    "patches/drizzle-orm.patch",
    "pnpm-lock.yaml",
    "CHANGELOG.md",
    "vercel.json",
    "scripts/eve-source-maps.sh",
  ]) {
    const root = await repository(t);
    const deployed = commit(root, "README.md");
    commit(root, path);
    assert.equal(decide(root, deployed), VERDICT.BUILD, path);
  }
});

test("every commit since the branch's last successful deployment counts, not the head's alone", async (t) => {
  const root = await repository(t);
  const deployed = commit(root, "README.md");
  const service = commit(root, "packages/service/src/index.ts");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, deployed), VERDICT.BUILD);
  assert.equal(decide(root, service), VERDICT.SKIP);
});

test("a branch with no successful deployment yet is built, whatever its last commit changed", async (t) => {
  const root = await repository(t);
  commit(root, "apps/web/src/main.tsx");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root), VERDICT.BUILD);
});

test("a last deployment that cannot be fetched is built against", async (t) => {
  const root = await repository(t);
  commit(root, "README.md");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, UNKNOWN_COMMIT), VERDICT.BUILD);
});

test("a rebased branch whose deployed tree is the one already deployed is skipped, its last deployment fetched by sha", async (t) => {
  const origin = await repository(t);
  commit(origin, "README.md");
  const clone = await temporaryDirectory(t, "luke-vercel-ignore-clone-");
  git(clone, "clone", "-q", `file://${origin}`, ".");
  // Note that the deployment is pushed to the origin after the clone, so the clone does not hold it.
  const deployed = commit(origin, "apps/web/src/main.tsx", "web v1\n");
  commit(clone, "apps/desktop/src/main/main.ts");
  commit(clone, "apps/web/src/main.tsx", "web v1\n");
  assert.equal(decide(clone, deployed), VERDICT.SKIP);
  commit(clone, "apps/web/src/main.tsx", "web v2\n");
  assert.equal(decide(clone, deployed), VERDICT.BUILD);
});

test("a host whose `timeout` is missing still fetches the last deployment by sha, as a Mac does", async (t) => {
  const origin = await repository(t);
  commit(origin, "README.md");
  const clone = await temporaryDirectory(t, "luke-vercel-ignore-clone-");
  git(clone, "clone", "-q", `file://${origin}`, ".");
  const deployed = commit(origin, "apps/web/src/main.tsx", "web v1\n");
  commit(clone, "apps/desktop/src/main/main.ts");
  commit(clone, "apps/web/src/main.tsx", "web v1\n");
  // Note that a `timeout` answering 127 first on the PATH is the shell's own "command not found".
  const bin = await temporaryDirectory(t, "luke-vercel-ignore-bin-");
  writeFileSync(join(bin, "timeout"), "#!/bin/sh\nexit 127\n");
  chmodSync(join(bin, "timeout"), 0o755);
  assert.equal(decide(clone, deployed, `${bin}${delimiter}${process.env.PATH}`), VERDICT.SKIP);
});
