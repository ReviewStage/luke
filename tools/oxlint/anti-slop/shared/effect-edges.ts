import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PLUGIN_DIRECTORY, "..", "..", "..");

/**
 * The machine-readable twin of the "Where an Effect may run" section of
 * `docs/adr/0001-effect.md`. The ADR states each entry's reason in prose and
 * names the PR that deletes it; this holds the same set as data, so the rules
 * below read one list rather than each re-deriving one, and
 * `scripts/repository-checks.sh` fails a deletion PR that shrinks one side of
 * the pair and not the other.
 */
const ALLOWLIST_FILE = path.join(PLUGIN_DIRECTORY, "effect-edges.json");

const ALLOWLIST_GROUP = {
  RUNTIME_EDGES: "runtimeEdges",
  RUN_SHIMS: "runShims",
  RUN_ON_HANDED_RUNTIME: "runOnHandedRuntime",
  RAW_ASYNC_PRIMITIVES: "rawAsyncPrimitives",
} as const;

type AllowlistGroup = (typeof ALLOWLIST_GROUP)[keyof typeof ALLOWLIST_GROUP];

function parseAllowlist(text: string): ReadonlyMap<string, readonly string[]> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("effect-edges.json must hold an object of named path lists");
  }
  const groups = new Map<string, readonly string[]>();
  for (const [group, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new Error(`effect-edges.json's "${group}" must hold repository-relative paths`);
    }
    groups.set(group, entries);
  }
  return groups;
}

function allowlist(wanted: readonly AllowlistGroup[]): ReadonlySet<string> {
  const groups = parseAllowlist(readFileSync(ALLOWLIST_FILE, "utf8"));
  return new Set(
    wanted.flatMap((group) => {
      const entries = groups.get(group);
      if (entries === undefined) throw new Error(`effect-edges.json is missing "${group}"`);
      return entries;
    }),
  );
}

/**
 * Files that may run an Effect: the ADR's runtime edges, the shims on its run
 * allowlist, and the few it records as running on a runtime an edge handed
 * them rather than one they built.
 */
export const RUN_ALLOWLIST = allowlist([
  ALLOWLIST_GROUP.RUNTIME_EDGES,
  ALLOWLIST_GROUP.RUN_SHIMS,
  ALLOWLIST_GROUP.RUN_ON_HANDED_RUNTIME,
]);

/** Files that still hold a raw timer, promise, abort controller, or `fs.watch`. */
export const RAW_ASYNC_PRIMITIVE_ALLOWLIST = allowlist([ALLOWLIST_GROUP.RAW_ASYNC_PRIMITIVES]);

export function repositoryPathOf(filename: string): string {
  return path.relative(REPOSITORY_ROOT, filename).split(path.sep).join("/");
}

/**
 * The migration is TypeScript's: the repository's `.mjs` build and evidence
 * scripts are plain Node harnesses that reach no Effect at all, so the rules
 * that read this allowlist are scoped by extension exactly as `no-node-test`
 * is, never by a row apiece.
 */
export const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts)$/u;

/**
 * A test body is its own edge: it runs what it asserts on, and a never-settling
 * `new Promise` is how several suites here stand in for a service that never
 * answers. Exempting them by extension rather than by path keeps the allowlist
 * a record of product code alone.
 */
function isTestFile(relativePath: string): boolean {
  return /\.test\.(?:ts|tsx|mts)$/u.test(relativePath);
}

export function isAllowedFile(filename: string, allowed: ReadonlySet<string>): boolean {
  const relativePath = repositoryPathOf(filename);
  return (
    !TYPESCRIPT_SOURCE.test(relativePath) || isTestFile(relativePath) || allowed.has(relativePath)
  );
}
