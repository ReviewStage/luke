import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = "scripts/vercel-ignore.sh";
const SCRIPTS = [SCRIPT, "scripts/vercel-deployed-paths.mjs"];

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

/** What Vercel names a build of `main` itself, the production deployment. */
const PRODUCTION = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" } as const;
/** What Vercel names a build of any other branch. */
const PREVIEW = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/branch" } as const;

/**
 * A workspace shaped like the repository's: the two services `vercel.json`
 * names, the web one reaching `service` and, through its devDependencies,
 * `wire`; and a desktop app reaching `host`, which no service does.
 */
const WORKSPACE: Readonly<Record<string, unknown>> = {
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n\ncatalog:\n  effect: 4.0.4\n',
  "vercel.json": { services: { web: { root: "apps/web" }, dev: { root: "apps/dev" } } },
  "apps/web/package.json": { name: "@luke/web", dependencies: { "@luke/service": "workspace:*" } },
  "apps/dev/package.json": { name: "@luke/coder", dependencies: { effect: "catalog:" } },
  "apps/desktop/package.json": {
    name: "@luke/desktop",
    dependencies: { "@luke/host": "workspace:*" },
  },
  "packages/service/package.json": {
    name: "@luke/service",
    devDependencies: { "@luke/wire": "workspace:^" },
  },
  "packages/wire/package.json": { name: "@luke/wire" },
  "packages/host/package.json": {
    name: "@luke/host",
    dependencies: { "@luke/wire": "workspace:*" },
  },
};

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

/** A repository holding the ignore step and the workspace, so its first commit has the step to run. */
async function repository(t: TestContext, withScript = true): Promise<string> {
  const root = await temporaryDirectory(t, "luke-vercel-ignore-");
  if (withScript) {
    mkdirSync(join(root, "scripts"));
    for (const script of SCRIPTS) copyFileSync(join(ROOT, script), join(root, script));
  }
  for (const [path, content] of Object.entries(WORKSPACE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof content === "string" ? content : `${JSON.stringify(content)}\n`,
    );
  }
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", "workspace");
  return root;
}

/** A clone of `origin`, at the branch given where one is, shallow where a depth is given, as Vercel's is. */
async function cloneOf(
  t: TestContext,
  origin: string,
  branch?: string,
  depth?: number,
): Promise<string> {
  const root = await temporaryDirectory(t, "luke-vercel-ignore-clone-");
  git(
    root,
    "clone",
    "-q",
    ...(branch ? ["--branch", branch, "--single-branch"] : []),
    ...(depth ? [`--depth=${depth}`] : []),
    `file://${origin}`,
    ".",
  );
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
function decide(
  root: string,
  previous?: string,
  path = process.env.PATH,
  vercel: Readonly<Record<string, string>> = {},
): Verdict {
  const ran = spawnSync("bash", ["-c", IGNORED_BUILD_STEP], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: path,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      // Note that a branch with no successful deployment yet carries the variable empty.
      VERCEL_GIT_PREVIOUS_SHA: previous ?? "",
      ...vercel,
    },
  });
  if (ran.status === 0) return VERDICT.SKIP;
  return ran.status === 1 ? VERDICT.BUILD : VERDICT.FAIL;
}

test("a push that changes only the desktop app or the docs since the last deployment is skipped", async (t) => {
  const root = await repository(t);
  const deployed = commit(root, "apps/web/src/main.tsx");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, deployed), VERDICT.SKIP);
  commit(root, "docs/DESIGN.md");
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
    "apps/web/server/routes/github/webhook.ts",
    "apps/dev/sandbox.ts",
    "packages/service/src/index.ts",
    "packages/service/src/testing/coder-scripted-model.ts",
    "packages/wire/src/index.ts",
    "patches/drizzle-orm.patch",
    "pnpm-lock.yaml",
    "CHANGELOG.md",
    "PRIVACY.md",
    "vercel.json",
    "scripts/eve-source-maps.sh",
    "scripts/vercel-deployed-paths.mjs",
  ]) {
    const root = await repository(t);
    const deployed = commit(root, "README.md");
    commit(root, path);
    assert.equal(decide(root, deployed), VERDICT.BUILD, path);
  }
});

test("a push that changes only a package no service reaches, or what no build reads in one that does, is skipped", async (t) => {
  for (const path of [
    "packages/host/src/index.ts",
    "apps/web/server/README.md",
    "packages/service/AGENTS.md",
    "packages/service/src/agents/runner.test.ts",
    "packages/wire/src/models/__tests__/message.test.ts",
    "packages/service/src/triggers/__fixtures__/issue.json",
    "packages/wire/fixtures/ui-messages/compaction.json",
    "apps/web/tests/support/builders.ts",
  ]) {
    const root = await repository(t);
    const deployed = commit(root, "README.md");
    commit(root, path);
    assert.equal(decide(root, deployed), VERDICT.SKIP, path);
  }
});

test("a service that comes to reach a package is built when that package changes", async (t) => {
  const root = await repository(t);
  commit(
    root,
    "apps/dev/package.json",
    `${JSON.stringify({ name: "@luke/coder", dependencies: { "@luke/host": "workspace:*" } })}\n`,
  );
  const deployed = git(root, "rev-parse", "HEAD");
  commit(root, "packages/host/src/index.ts");
  assert.equal(decide(root, deployed), VERDICT.BUILD);
});

test("a deployed tree that cannot be read is built rather than skipped", async (t) => {
  const root = await repository(t);
  const deployed = commit(root, "vercel.json", "{ not json\n");
  commit(root, "docs/DESIGN.md");
  assert.equal(decide(root, deployed), VERDICT.BUILD);
});

test("every commit since the branch's last successful deployment counts, not the head's alone", async (t) => {
  const root = await repository(t);
  const deployed = commit(root, "README.md");
  const service = commit(root, "packages/service/src/index.ts");
  commit(root, "apps/desktop/src/main/main.ts");
  assert.equal(decide(root, deployed), VERDICT.BUILD);
  assert.equal(decide(root, service), VERDICT.SKIP);
});

/** An origin whose `main` moved on, past the branch's fork, with a web change of its own, as `main` does. */
async function forkedOrigin(t: TestContext, branchPaths: readonly string[]): Promise<string> {
  const origin = await repository(t);
  commit(origin, "README.md");
  git(origin, "checkout", "-q", "-b", PREVIEW.VERCEL_GIT_COMMIT_REF);
  for (const path of branchPaths) commit(origin, path);
  git(origin, "checkout", "-q", "main");
  commit(origin, "apps/web/src/main.tsx");
  commit(origin, "packages/service/src/index.ts");
  return origin;
}

test("a branch's first push is skipped where it changes nothing deployed since its merge-base with main", async (t) => {
  const origin = await forkedOrigin(t, ["apps/desktop/src/main/main.ts", "docs/DESIGN.md"]);
  const root = await cloneOf(t, origin, PREVIEW.VERCEL_GIT_COMMIT_REF);
  assert.equal(decide(root, undefined, process.env.PATH, PREVIEW), VERDICT.SKIP);
});

test("a branch's first push is built where it changes something deployed since its merge-base with main", async (t) => {
  const origin = await forkedOrigin(t, ["apps/desktop/src/main/main.ts", "apps/dev/sandbox.ts"]);
  const root = await cloneOf(t, origin, PREVIEW.VERCEL_GIT_COMMIT_REF);
  assert.equal(decide(root, undefined, process.env.PATH, PREVIEW), VERDICT.BUILD);
});

test("a shallow clone is deepened until the branch meets main, as Vercel's clone is", async (t) => {
  const skipped = await forkedOrigin(t, ["apps/desktop/src/main/main.ts", "docs/DESIGN.md"]);
  const root = await cloneOf(t, skipped, PREVIEW.VERCEL_GIT_COMMIT_REF, 1);
  assert.equal(git(root, "rev-parse", "--is-shallow-repository"), "true");
  assert.equal(decide(root, undefined, process.env.PATH, PREVIEW), VERDICT.SKIP);
  const built = await forkedOrigin(t, ["apps/web/src/main.tsx", "docs/DESIGN.md"]);
  const builtRoot = await cloneOf(t, built, PREVIEW.VERCEL_GIT_COMMIT_REF, 1);
  assert.equal(decide(builtRoot, undefined, process.env.PATH, PREVIEW), VERDICT.BUILD);
});

test("a last deployment that cannot be fetched is compared with the merge-base with main instead", async (t) => {
  const skipped = await forkedOrigin(t, ["apps/desktop/src/main/main.ts"]);
  const root = await cloneOf(t, skipped, PREVIEW.VERCEL_GIT_COMMIT_REF);
  assert.equal(decide(root, UNKNOWN_COMMIT, process.env.PATH, PREVIEW), VERDICT.SKIP);
  const built = await forkedOrigin(t, ["packages/service/src/agents/runner.ts"]);
  const builtRoot = await cloneOf(t, built, PREVIEW.VERCEL_GIT_COMMIT_REF);
  assert.equal(decide(builtRoot, UNKNOWN_COMMIT, process.env.PATH, PREVIEW), VERDICT.BUILD);
});

test("a branch that shares no history with main is built", async (t) => {
  const origin = await repository(t);
  git(origin, "checkout", "-q", "--orphan", PREVIEW.VERCEL_GIT_COMMIT_REF);
  commit(origin, "screenshot.png");
  git(origin, "checkout", "-q", "main");
  const root = await cloneOf(t, origin, PREVIEW.VERCEL_GIT_COMMIT_REF);
  assert.equal(decide(root, undefined, process.env.PATH, PREVIEW), VERDICT.BUILD);
});

test("production with no last deployment to compare with is built, whatever it changed", async (t) => {
  const origin = await repository(t);
  commit(origin, "apps/desktop/src/main/main.ts");
  const root = await cloneOf(t, origin);
  assert.equal(decide(root, undefined, process.env.PATH, PRODUCTION), VERDICT.BUILD);
  assert.equal(decide(root, UNKNOWN_COMMIT, process.env.PATH, PRODUCTION), VERDICT.BUILD);
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

test("a checkout with no usable origin fetches the last deployment from the repository Vercel names, as Vercel's own does", async (t) => {
  const origin = await repository(t);
  commit(origin, "README.md");
  const clone = await temporaryDirectory(t, "luke-vercel-ignore-clone-");
  git(clone, "clone", "-q", `file://${origin}`, ".");
  git(clone, "remote", "remove", "origin");
  const deployed = commit(origin, "apps/web/src/main.tsx", "web v1\n");
  commit(clone, "apps/desktop/src/main/main.ts");
  commit(clone, "apps/web/src/main.tsx", "web v1\n");
  assert.equal(decide(clone, deployed), VERDICT.BUILD);
  // Note that git's own URL rewriting stands the origin in for GitHub, so the test reaches no network.
  const vercel = {
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "ReviewStage",
    VERCEL_GIT_REPO_SLUG: "luke",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${origin}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/ReviewStage/luke.git",
  };
  assert.equal(decide(clone, deployed, process.env.PATH, vercel), VERDICT.SKIP);
  commit(clone, "apps/web/src/main.tsx", "web v2\n");
  assert.equal(decide(clone, deployed, process.env.PATH, vercel), VERDICT.BUILD);
});
