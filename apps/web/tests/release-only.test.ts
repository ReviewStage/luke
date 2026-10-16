import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../scripts/release-only.mjs", import.meta.url));

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

/** A manifest of the workspace `name` at `version`, with one dependency. */
function manifest(name: string, version: string, effect = "catalog:"): string {
  return `${JSON.stringify({ name, version, private: true, dependencies: { effect } }, null, 2)}\n`;
}

type Files = Record<string, string | null>;

/** Writes `files`, deleting each one given null, and commits them; answers the commit. */
function commit(root: string, files: Files): string {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(root, path));
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "--all");
  git(root, "commit", "-q", "--allow-empty", "-m", "change");
  return git(root, "rev-parse", "HEAD");
}

/** A repository at release 0.1.0, as the base a change is measured from. */
async function released(t: TestContext): Promise<{ root: string; base: string }> {
  const root = await temporaryDirectory(t, "luke-release-only-");
  git(root, "init", "-q", "-b", "main");
  const base = commit(root, {
    "package.json": manifest("luke", "0.1.0"),
    "apps/desktop/package.json": manifest("@luke/desktop", "0.1.0"),
    "packages/wire/package.json": manifest("@luke/wire", "0.1.0"),
    "CHANGELOG.md": "# Changelog\n\n## 0.1.0 — 2026-10-01\n",
    "apps/desktop/src/main.ts": "export {};\n",
  });
  return { root, base };
}

function classify(root: string, base: string, head = "HEAD"): string {
  const ran = spawnSync(process.execPath, [SCRIPT, base, head], { cwd: root, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

const BUMP = {
  "package.json": manifest("luke", "0.2.0"),
  "apps/desktop/package.json": manifest("@luke/desktop", "0.2.0"),
  "packages/wire/package.json": manifest("@luke/wire", "0.2.0"),
  "CHANGELOG.md": "# Changelog\n\n## 0.2.0 — 2026-10-16\n\n## 0.1.0 — 2026-10-01\n",
  "apps/web/public/changelog/0.2.0/voice.png": "png",
} satisfies Files;

test("a version bump with its changelog and screenshots is release-only", async (t) => {
  const { root, base } = await released(t);
  commit(root, BUMP);
  assert.equal(classify(root, base), "release_only=true");
});

test("a change beside the bump runs every check", async (t) => {
  const beside: Files[] = [
    { "apps/desktop/src/main.ts": "export const changed = 1;\n" },
    { "packages/wire/package.json": manifest("@luke/wire", "0.2.0", "4.0.5") },
    { "apps/web/fixtures/package.json": manifest("fixture", "0.2.0") },
    { "packages/live/package.json": manifest("@luke/live", "0.2.0") },
    { "packages/wire/package.json": null },
    { "apps/web/public/changelog.html": "<p>changed</p>" },
  ];
  for (const files of beside) {
    const { root, base } = await released(t);
    commit(root, { ...BUMP, ...files });
    assert.equal(classify(root, base), "release_only=false", Object.keys(files).join(", "));
  }
});

test("every commit between the base and the head counts, as a merge group's do", async (t) => {
  const { root, base } = await released(t);
  commit(root, { "apps/desktop/src/main.ts": "export const queued = 1;\n" });
  commit(root, BUMP);
  assert.equal(classify(root, base), "release_only=false");
  assert.equal(classify(root, `${base}`, "HEAD~1"), "release_only=false");
  assert.equal(classify(root, "HEAD~1"), "release_only=true");
});

test("a change that changes nothing, or that cannot be read, runs every check", async (t) => {
  const { root, base } = await released(t);
  assert.equal(classify(root, base), "release_only=false");
  assert.equal(classify(root, "0123456789abcdef0123456789abcdef01234567"), "release_only=false");
});
