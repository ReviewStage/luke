import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPTS = ["scripts/preview-address.sh", "scripts/vercel-ignore.sh"];
const REPOSITORY = "ReviewStage/luke";
const BRANCH = "luke/rebased";

/** The script's own exit for a commit no build serves the deployed tree of. */
const EXIT_NOT_AFFECTED = 3;

/**
 * GitHub's answers, one file a request path, which the fake `gh` filters with
 * the script's own `--jq`; a path with no file answers an empty list.
 */
const FAKE_GH = `#!/usr/bin/env bash
[[ $1 == api ]] || exit 2
path=$2
filter=.
[[ \${3:-} == --jq ]] && filter=$4
file="$FAKE_GH_ANSWERS/$(printf '%s' "$path" | tr -c 'A-Za-z0-9' '_')"
[[ -f $file ]] || { printf '[]' | jq -r "$filter"; exit; }
jq -r "$filter" "$file"
`;

/** A preview that answers a stranger without sending them to Vercel's SSO. */
const FAKE_CURL = "#!/bin/sh\nexit 0\n";

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

function commit(root: string, path: string, content: string): string {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", `change ${path}`);
  return git(root, "rev-parse", "HEAD");
}

function answer(answers: string, path: string, body: unknown): void {
  writeFileSync(join(answers, path.replace(/[^A-Za-z0-9]/g, "_")), JSON.stringify(body));
}

/** Records the build Vercel made of `sha`, as its GitHub deployment record and that record's newest status. */
function built(answers: string, sha: string, id: number, address: string): void {
  answer(answers, `repos/${REPOSITORY}/deployments?sha=${sha}&environment=Preview&per_page=10`, [
    { id, created_at: "2026-10-20T10:00:00Z" },
  ]);
  answer(answers, `repos/${REPOSITORY}/deployments/${id}/statuses?per_page=10`, [
    {
      state: "success",
      description: "Deployment has completed",
      environment_url: address,
      created_at: "2026-10-20T10:02:00Z",
    },
  ]);
}

/** Records that the project's Ignored Build Step skipped `sha`, which writes no deployment record. */
function skipped(answers: string, sha: string): void {
  answer(answers, `repos/${REPOSITORY}/commits/${sha}/status`, {
    statuses: [
      { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
    ],
  });
}

/** The heads the branch was pushed at, newest first, as GitHub's repository activity lists them. */
function pushed(answers: string, heads: readonly string[]): void {
  answer(
    answers,
    `repos/${REPOSITORY}/activity?ref=refs/heads/${BRANCH}&per_page=100`,
    heads.map((after, index) => ({
      activity_type: index === heads.length - 1 ? "branch_creation" : "force_push",
      after,
    })),
  );
}

interface Fixture {
  readonly checkout: string;
  readonly answers: string;
  readonly bin: string;
  /** The branch's head before the rebase, built and then force-pushed away. */
  readonly earlier: string;
  /** The rebased head, which the checkout is at. */
  readonly head: string;
}

/**
 * An origin whose main moves on with a desktop-only commit after the branch
 * was first pushed and built, and a checkout of the branch rebased onto it.
 */
async function rebasedBranch(t: TestContext, webBeforeRebase: string): Promise<Fixture> {
  const origin = await temporaryDirectory(t, "luke-preview-address-origin-");
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  for (const script of SCRIPTS) {
    mkdirSync(join(origin, "scripts"), { recursive: true });
    copyFileSync(join(ROOT, script), join(origin, script));
  }
  commit(origin, "README.md", "base\n");
  git(origin, "checkout", "-q", "-b", BRANCH);
  const earlier = commit(origin, "apps/web/src/main.tsx", webBeforeRebase);
  // Note that the earlier head stays fetchable by its sha, as GitHub keeps a force-pushed commit.
  git(origin, "update-ref", "refs/kept/earlier", earlier);
  git(origin, "checkout", "-q", "main");
  commit(origin, "apps/desktop/src/main/main.ts", "desktop\n");
  git(origin, "branch", "-q", "-f", BRANCH, "main");
  git(origin, "checkout", "-q", BRANCH);
  const head = commit(origin, "apps/web/src/main.tsx", "web v1\n");
  git(origin, "checkout", "-q", "main");

  const checkout = await temporaryDirectory(t, "luke-preview-address-checkout-");
  git(checkout, "clone", "-q", "--branch", BRANCH, `file://${origin}`, ".");
  const answers = await temporaryDirectory(t, "luke-preview-address-answers-");
  const bin = await temporaryDirectory(t, "luke-preview-address-bin-");
  writeFileSync(join(bin, "gh"), FAKE_GH);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  return { checkout, answers, bin, earlier, head };
}

function previewAddress(fixture: Fixture): { status: number | null; address: string } {
  const ran = spawnSync("bash", ["scripts/preview-address.sh", "--repo", REPOSITORY], {
    cwd: fixture.checkout,
    encoding: "utf8",
    env: {
      PATH: `${fixture.bin}${delimiter}${process.env.PATH}`,
      HOME: fixture.checkout,
      GIT_CONFIG_NOSYSTEM: "1",
      FAKE_GH_ANSWERS: fixture.answers,
      PREVIEW_ADDRESS_INTERVAL_SECONDS: "0",
      PREVIEW_ADDRESS_ATTEMPTS: "1",
    },
  });
  return { status: ran.status, address: ran.stdout.trim() };
}

test("a rebased head the ignore step skipped resolves to the build of the branch's earlier head that serves its tree", async (t) => {
  const fixture = await rebasedBranch(t, "web v1\n");
  built(fixture.answers, fixture.earlier, 7, "https://luke-earlier.vercel.app");
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.earlier]);
  assert.deepEqual(previewAddress(fixture), {
    status: 0,
    address: "https://luke-earlier.vercel.app",
  });
});

test("an earlier head of the branch that deployed a different tree is passed over", async (t) => {
  const fixture = await rebasedBranch(t, "web v0\n");
  built(fixture.answers, fixture.earlier, 7, "https://luke-earlier.vercel.app");
  skipped(fixture.answers, fixture.head);
  pushed(fixture.answers, [fixture.head, fixture.earlier]);
  assert.equal(previewAddress(fixture).status, EXIT_NOT_AFFECTED);
});
