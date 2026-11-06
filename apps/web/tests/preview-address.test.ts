import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@repo/runtime/testing";
import { type TestContext, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPTS = [
  "scripts/preview-address.sh",
  "scripts/vercel-ignore.sh",
  "scripts/vercel-deployed-paths.mjs",
];
const WORKSPACE = {
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n',
  "vercel.json": `${JSON.stringify({ services: { web: { root: "apps/web" } } })}\n`,
  "apps/web/package.json": `${JSON.stringify({ name: "@repo/web" })}\n`,
} as const;
const REPOSITORY = "acme/web";
const BRANCH = "agent/rebased";

const EXIT_NOT_AFFECTED = 3;
const EXIT_NOT_READY = 6;
const EXIT_UNREADABLE = 7;
const EXIT_NOT_REQUESTED = 8;

const FAKE_GH = `#!/usr/bin/env bash
[[ $1 == api ]] || exit 2
path=$2
filter=.
[[ \${3:-} == --jq ]] && filter=$4
file="$FAKE_GH_ANSWERS/$(printf '%s' "$path" | tr -c 'A-Za-z0-9' '_')"
[[ -f $file ]] || { printf '[]' | jq -r "$filter"; exit; }
grep -qx REFUSED "$file" && { echo 'HTTP 503' >&2; exit 1; }
jq -r "$filter" "$file"
`;

const FAKE_CURL = "#!/bin/sh\nexit 0\n";

function git(root: string, ...args: string[]): string {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=Vespin",
      "-c",
      "user.email=agent@example.com",
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

function commit(root: string, path: string, content: string): string {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", `change ${path}`);
  return git(root, "rev-parse", "HEAD");
}

const REFUSED = Symbol("refused");

function answer(answers: string, path: string, body: unknown): void {
  writeFileSync(
    join(answers, path.replace(/[^A-Za-z0-9]/g, "_")),
    body === REFUSED ? "REFUSED\n" : JSON.stringify(body),
  );
}

function built(
  answers: string,
  sha: string,
  id: number,
  address: string,
  state: "success" | "failure" = "success",
): void {
  deployed(answers, sha, [{ id, address, state, at: "2026-10-20T10:00:00Z" }]);
}

interface Build {
  readonly id: number;
  readonly address: string;
  readonly state: "success" | "failure";
  readonly at: string;
}

function deployed(answers: string, sha: string, builds: readonly Build[]): void {
  answer(
    answers,
    `repos/${REPOSITORY}/deployments?sha=${sha}&environment=Preview&per_page=10`,
    builds.map((build) => ({ id: build.id, created_at: build.at })),
  );
  for (const build of builds) {
    answer(answers, `repos/${REPOSITORY}/deployments/${build.id}/statuses?per_page=10`, [
      {
        state: build.state,
        description: build.state === "success" ? "Deployment has completed" : "Build failed",
        environment_url: build.address,
        created_at: build.at,
      },
    ]);
  }
}

function skipped(answers: string, sha: string): void {
  answer(answers, `repos/${REPOSITORY}/commits/${sha}/status`, {
    statuses: [
      { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
    ],
  });
}

function pushed(answers: string, heads: readonly string[] | typeof REFUSED): void {
  answer(
    answers,
    `repos/${REPOSITORY}/activity?ref=refs/heads/${BRANCH}&per_page=100`,
    heads === REFUSED
      ? REFUSED
      : heads.map((after, index) => ({
          activity_type: index === heads.length - 1 ? "branch_creation" : "force_push",
          after,
        })),
  );
}

interface Fixture {
  readonly checkout: string;
  readonly answers: string;
  readonly bin: string;
  readonly earlier: string;
  readonly between: string;
  readonly head: string;
}

async function rebasedBranch(t: TestContext, webBeforeRebase: string): Promise<Fixture> {
  const origin = await temporaryDirectory(t, "preview-address-origin-");
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  for (const script of SCRIPTS) {
    mkdirSync(join(origin, "scripts"), { recursive: true });
    copyFileSync(join(ROOT, script), join(origin, script));
  }
  for (const [path, content] of Object.entries(WORKSPACE)) {
    mkdirSync(dirname(join(origin, path)), { recursive: true });
    writeFileSync(join(origin, path), content);
  }
  commit(origin, "README.md", "base\n");
  git(origin, "checkout", "-q", "-b", BRANCH);
  const earlier = commit(origin, "apps/web/src/main.tsx", webBeforeRebase);
  git(origin, "update-ref", "refs/kept/earlier", earlier);
  const between = commit(origin, "docs/NOTES.md", "notes\n");
  git(origin, "update-ref", "refs/kept/between", between);
  git(origin, "checkout", "-q", "main");
  commit(origin, "apps/desktop/src/main/main.ts", "desktop\n");
  git(origin, "branch", "-q", "-f", BRANCH, "main");
  git(origin, "checkout", "-q", BRANCH);
  const head = commit(origin, "apps/web/src/main.tsx", "web v1\n");
  git(origin, "checkout", "-q", "main");

  const checkout = await temporaryDirectory(t, "preview-address-checkout-");
  git(checkout, "clone", "-q", "--branch", BRANCH, `file://${origin}`, ".");
  const answers = await temporaryDirectory(t, "preview-address-answers-");
  const bin = await temporaryDirectory(t, "preview-address-bin-");
  writeFileSync(join(bin, "gh"), FAKE_GH);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  return { checkout, answers, bin, earlier, between, head };
}

function previewAddress(
  fixture: Fixture,
  attempts = 1,
): { status: number | null; address: string } {
  const ran = spawnSync("bash", ["scripts/preview-address.sh", "--repo", REPOSITORY], {
    cwd: fixture.checkout,
    encoding: "utf8",
    env: {
      PATH: `${fixture.bin}${delimiter}${process.env.PATH}`,
      HOME: fixture.checkout,
      GIT_CONFIG_NOSYSTEM: "1",
      FAKE_GH_ANSWERS: fixture.answers,
      PREVIEW_ADDRESS_INTERVAL_SECONDS: "0",
      PREVIEW_ADDRESS_ATTEMPTS: String(attempts),
      PREVIEW_ADDRESS_QUIET_ATTEMPTS: "2",
    },
  });
  return { status: ran.status, address: ran.stdout.trim() };
}

test("a rebased head the ignore step skipped resolves to the build of the branch's earlier head that serves its tree", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  built(fixture.answers, fixture.earlier, 7, "https://earlier.vercel.app");
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.earlier]);
  assert.deepEqual(previewAddress(fixture), {
    status: 0,
    address: "https://earlier.vercel.app",
  });
});

test("an earlier head of the branch that deployed a different tree is passed over", async (t) => {
  const fixture = await rebasedBranch(t, "web v0\n");
  built(fixture.answers, fixture.earlier, 7, "https://earlier.vercel.app");
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.earlier]);
  assert.equal(previewAddress(fixture).status, EXIT_NOT_AFFECTED);
});

test("an earlier head whose own build failed is passed over for an older one that served the tree", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  built(fixture.answers, fixture.earlier, 7, "https://earlier.vercel.app");
  built(fixture.answers, fixture.between, 8, "https://between.vercel.app", "failure");
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.between, fixture.earlier]);
  assert.deepEqual(previewAddress(fixture), {
    status: 0,
    address: "https://earlier.vercel.app",
  });
});

test("a rebased branch whose pushes GitHub will not list answers unreadable rather than another branch's preview", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  built(fixture.answers, fixture.head, 9, "https://other-branch.vercel.app");
  commit(fixture.checkout, "docs/NOTES.md", "notes\n");
  skipped(fixture.answers, git(fixture.checkout, "rev-parse", "HEAD"));
  pushed(fixture.answers, REFUSED);
  assert.equal(previewAddress(fixture).status, EXIT_UNREADABLE);
});

test("an earlier head redeployed and failed still resolves to its first build, which serves the tree", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  deployed(fixture.answers, fixture.earlier, [
    {
      id: 7,
      address: "https://earlier.vercel.app",
      state: "success",
      at: "2026-10-20T10:00:00Z",
    },
    {
      id: 8,
      address: "https://redeploy.vercel.app",
      state: "failure",
      at: "2026-10-20T11:00:00Z",
    },
  ]);
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.earlier]);
  assert.deepEqual(previewAddress(fixture), {
    status: 0,
    address: "https://earlier.vercel.app",
  });
});

test("an agent's branch Vercel stays quiet on is taken as never asked for, after a grace that lets a just-asked preview show up", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  answer(fixture.answers, `repos/${REPOSITORY}/commits/${fixture.head}/status`, { statuses: [] });
  assert.equal(previewAddress(fixture, 1).status, EXIT_NOT_READY);
  assert.equal(previewAddress(fixture, 2).status, EXIT_NOT_REQUESTED);
});
