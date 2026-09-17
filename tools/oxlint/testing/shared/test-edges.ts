import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repositoryPathOf } from "../../anti-slop/shared/effect-edges.ts";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The machine-readable twin of root AGENTS.md's "Testing" section. The two
 * holdout lists record the test files still short of `it.effect` and
 * `TestClock` when the rules landed: they shrink and are deleted with their
 * last entry, never grow. `liveClockTests` is permanent: a test whose subject
 * is a real socket or a process timeout, each named with its reason in
 * AGENTS.md. `scripts/repository-checks.sh` fails a holdout that no longer
 * violates its rule and a `liveClockTests` entry AGENTS.md does not name.
 */
const EDGES_FILE = path.join(PLUGIN_DIRECTORY, "test-edges.json");

/**
 * The drift check sets this to read the rules with every holdout list empty,
 * which is how it asks the rule itself, rather than a regex beside it, whether
 * a holdout still violates. A test body reads no environment; this is the
 * plugin's own, read once as it loads.
 */
const IGNORE_HOLDOUTS_VARIABLE = "LUKE_TESTING_IGNORE_HOLDOUTS";

export const EDGES_GROUP = {
  RUNNER_HOLDOUTS: "runnerHoldouts",
  REAL_TIME_HOLDOUTS: "realTimeHoldouts",
  LIVE_CLOCK_TESTS: "liveClockTests",
} as const;

type EdgesGroup = (typeof EDGES_GROUP)[keyof typeof EDGES_GROUP];

function parseEdges(text: string): ReadonlyMap<string, readonly string[]> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("test-edges.json must hold an object of named path lists");
  }
  const groups = new Map<string, readonly string[]>();
  for (const [group, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new Error(`test-edges.json's "${group}" must hold repository-relative paths`);
    }
    groups.set(group, entries);
  }
  return groups;
}

function edges(group: EdgesGroup): ReadonlySet<string> {
  const groups = parseEdges(readFileSync(EDGES_FILE, "utf8"));
  const entries = groups.get(group);
  // A holdout list is deleted with its last entry, so a missing one is empty.
  if (entries === undefined && group !== EDGES_GROUP.LIVE_CLOCK_TESTS) return new Set();
  if (entries === undefined) throw new Error(`test-edges.json is missing "${group}"`);
  return new Set(process.env[IGNORE_HOLDOUTS_VARIABLE] === "1" ? [] : entries);
}

/** Test files that still run an Effect in a test body; `testing/no-runner` skips them. */
export const RUNNER_HOLDOUTS = edges(EDGES_GROUP.RUNNER_HOLDOUTS);

/** Test files that still arm a real timer or sleep; `testing/no-real-time` skips them. */
export const REAL_TIME_HOLDOUTS = edges(EDGES_GROUP.REAL_TIME_HOLDOUTS);

/** Tests whose subject is a real socket or process timeout; `it.live` and real time are theirs. */
export const LIVE_CLOCK_TESTS = edges(EDGES_GROUP.LIVE_CLOCK_TESTS);

/** Every rule in this plugin gates on this and nothing nearer: a test file, by extension alone. */
export function isTestFile(filename: string): boolean {
  return /\.test\.(?:ts|tsx|mts)$/u.test(repositoryPathOf(filename));
}

export function isTestFileOutside(filename: string, exempt: ReadonlySet<string>): boolean {
  return isTestFile(filename) && !exempt.has(repositoryPathOf(filename));
}
