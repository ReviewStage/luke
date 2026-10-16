// release-only.mjs -- whether a change touches nothing but the changelog and package versions.

import { spawnSync } from "node:child_process";

// A release's version change moves three things: CHANGELOG.md, the
// screenshots its feature sections show under apps/web/public/changelog/, and
// the "version" of package manifests. None of them is read by a test outside
// web's changelog tests, a migration, or the store, so CI skips its test
// shards and its Postgres job for a change made of nothing else and runs the
// rest: the repository checks, lint, typecheck, the build that renders the
// changelog, and web's tests. Each skipped job still reports its required
// name, as a success, so the merge queue lets the change through.
//
// Usage: node scripts/release-only.mjs <base> <head>. It prints
// `release_only=true` or `release_only=false` for $GITHUB_OUTPUT, and false
// whenever it cannot tell, since running every check is never wrong.

const CHANGELOG = "CHANGELOG.md";
const CHANGELOG_ASSETS = "apps/web/public/changelog/";
const MANIFEST = /^(?:(?:apps|packages|tools)\/[^/]+\/)?package\.json$/u;

function git(args) {
  const ran = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr.trim()}`);
  return ran.stdout;
}

/** The manifest at `commit` without its version, or undefined where there is none to read. */
function manifestBesideVersion(commit, path) {
  const shown = spawnSync("git", ["show", `${commit}:${path}`], { encoding: "utf8" });
  if (shown.status !== 0) return undefined;
  try {
    const { version: _version, ...rest } = JSON.parse(shown.stdout);
    return JSON.stringify(rest);
  } catch {
    return undefined;
  }
}

// Note that a manifest counts only where it exists on both sides and nothing
// but its version moved, so an added, deleted, or reordered one runs every
// check.
function releaseOnlyPath(base, head, path) {
  if (path === CHANGELOG || path.startsWith(CHANGELOG_ASSETS)) return true;
  if (!MANIFEST.test(path)) return false;
  const before = manifestBesideVersion(base, path);
  return before !== undefined && before === manifestBesideVersion(head, path);
}

function releaseOnly(base, head) {
  const paths = git(["diff", "--name-only", "--no-renames", "-z", base, head])
    .split("\0")
    .filter(Boolean);
  return paths.length > 0 && paths.every((path) => releaseOnlyPath(base, head, path));
}

const [base, head, ...rest] = process.argv.slice(2);
if (!base || !head || rest.length > 0) {
  process.stderr.write("usage: release-only.mjs <base> <head>\n");
  process.exit(2);
}
let verdict = false;
try {
  verdict = releaseOnly(base, head);
} catch (error) {
  process.stderr.write(
    `::warning::could not classify the change, so every check runs: ${error.message}\n`,
  );
}
process.stdout.write(`release_only=${verdict}\n`);
