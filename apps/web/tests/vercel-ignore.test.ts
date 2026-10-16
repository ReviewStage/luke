import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = "scripts/vercel-ignore.sh";

// SAFETY: the file is this repository's own vercel.json, read for its services' ignore steps.
const { services } = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
  readonly services: Readonly<Record<string, { readonly ignoreCommand: string }>>;
};

/** What Vercel makes of the steps' exits: the deployment is skipped when every service's exits zero, and built otherwise. */
const VERDICT = { SKIP: "skip", BUILD: "build" } as const;
type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/** A commit Vercel's clone does not hold, as a rebased branch's last deployment is. */
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

/** A repository holding the ignore step and one file, so its first commit has the step to run. */
async function repository(t: TestContext): Promise<string> {
  const root = await temporaryDirectory(t, "luke-vercel-ignore-");
  mkdirSync(join(root, "scripts"));
  copyFileSync(join(ROOT, SCRIPT), join(root, SCRIPT));
  git(root, "init", "-q", "-b", "main");
  return root;
}

let edits = 0;

/** Commits a change to one file and answers the commit. */
function commit(root: string, path: string): string {
  edits += 1;
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `${path}, edit ${edits}\n`);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", `change ${path}`);
  return git(root, "rev-parse", "HEAD");
}

/** Runs every service's own ignoreCommand at the head, from `directory`, as Vercel would. */
function decide(root: string, previous?: string, directory = root): Verdict {
  const skipped = Object.values(services).every(({ ignoreCommand }) => {
    const ran = spawnSync("bash", ["-c", ignoreCommand], {
      cwd: directory,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: root,
        GIT_CONFIG_NOSYSTEM: "1",
        // Note that a branch with no successful deployment yet carries the variable empty.
        VERCEL_GIT_PREVIOUS_SHA: previous ?? "",
      },
    });
    return ran.status === 0;
  });
  return skipped ? VERDICT.SKIP : VERDICT.BUILD;
}

test("a push that changes only the desktop app or the docs is skipped, from whichever directory the step runs in", async (t) => {
  const root = await repository(t);
  commit(root, "apps/web/package.json");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root), VERDICT.SKIP);
  commit(root, "docs/proposals/factory/index.html");
  assert.equal(decide(root, undefined, join(root, "apps/web")), VERDICT.SKIP);
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
  ]) {
    const root = await repository(t);
    commit(root, "README.md");
    commit(root, path);
    assert.equal(decide(root), VERDICT.BUILD, path);
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

test("a last deployment the clone does not hold falls back to the head's own change", async (t) => {
  const root = await repository(t);
  commit(root, "packages/service/src/index.ts");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, UNKNOWN_COMMIT), VERDICT.SKIP);
  commit(root, "packages/database/src/index.ts");
  assert.equal(decide(root, UNKNOWN_COMMIT), VERDICT.BUILD);
});

test("a commit with nothing to compare it against is built", async (t) => {
  const root = await repository(t);
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root), VERDICT.BUILD);
});
