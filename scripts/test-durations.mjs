// test-durations.mjs -- record how long each test file ran in a CI run, for CI's shards to balance on.

import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { TEST_DURATIONS_FILE } from "./lib/test-shards.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A file's line in vitest's default reporter: its project, its path, and its time. */
const FILE_LINE = /[✓×]\s+(\S+)\s+(\S+\.test\.tsx?) \(\d+ tests?[^)]*\)\s+(\d+(?:\.\d+)?)(ms|s)\b/u;

/** The CI test jobs' logs hold no more than this, the largest about 10 MB. */
const LOG_BYTES = 256 * 1024 * 1024;

function gh(args) {
  const run = spawnSync("gh", args, { encoding: "utf8", maxBuffer: LOG_BYTES });
  if (run.status !== 0) throw new Error(`gh ${args.join(" ")} failed:\n${run.stderr}`);
  return run.stdout;
}

/** The workspaces whose config shards by recorded time, by vitest project name. */
function shardedWorkspaces() {
  const workspaces = new Map();
  for (const config of globSync("{apps,packages,tools}/*/vitest.config.ts", {
    cwd: REPOSITORY_ROOT,
  })) {
    const text = readFileSync(path.join(REPOSITORY_ROOT, config), "utf8");
    const name = /test:\s*\{\s*name:\s*"([^"]+)"/u.exec(text)?.[1];
    if (name && text.includes("DurationSharding")) {
      workspaces.set(name, path.join(REPOSITORY_ROOT, path.dirname(config)));
    }
  }
  return workspaces;
}

/**
 * Reads every file line of a CI run's test jobs. Note that a job turbo
 * replayed from its cache prints the run that passed first, times included,
 * so any run of every job carries every file once.
 */
function fileTimes(runId) {
  const jobs = JSON.parse(
    gh(["api", "--paginate", `repos/{owner}/{repo}/actions/runs/${runId}/jobs`, "--jq", ".jobs"]),
  ).filter((job) => job.name.startsWith("Tests ("));
  const times = [];
  for (const job of jobs) {
    const log = gh(["api", `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`]);
    for (const line of stripVTControlCharacters(log).split("\n")) {
      const [, project, file, amount, unit] = FILE_LINE.exec(line) ?? [];
      if (project)
        times.push({ project, file, ms: Math.round(Number(amount) * (unit === "s" ? 1000 : 1)) });
    }
  }
  return times;
}

const [runId] = process.argv.slice(2);
if (!runId) {
  process.stderr.write(
    "usage: node scripts/test-durations.mjs <run id of a CI run whose test jobs all passed>\n",
  );
  process.exitCode = 2;
} else {
  const workspaces = shardedWorkspaces();
  const byWorkspace = new Map([...workspaces.keys()].map((name) => [name, new Map()]));
  for (const { project, file, ms } of fileTimes(runId)) {
    const root = workspaces.get(project);
    if (root && existsSync(path.join(root, file))) byWorkspace.get(project).set(file, ms);
  }
  for (const [name, durations] of byWorkspace) {
    const sorted = Object.fromEntries([...durations].sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(
      path.join(workspaces.get(name), TEST_DURATIONS_FILE),
      `${JSON.stringify(sorted, null, 2)}\n`,
    );
    process.stdout.write(`${name}: recorded ${durations.size} files\n`);
  }
}
