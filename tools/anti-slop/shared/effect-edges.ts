import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PLUGIN_DIRECTORY, "..", "..");

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

export const RUN_ALLOWLIST = allowlist([
  ALLOWLIST_GROUP.RUNTIME_EDGES,
  ALLOWLIST_GROUP.RUN_SHIMS,
  ALLOWLIST_GROUP.RUN_ON_HANDED_RUNTIME,
]);

export const RAW_ASYNC_PRIMITIVE_ALLOWLIST = allowlist([ALLOWLIST_GROUP.RAW_ASYNC_PRIMITIVES]);

export function repositoryPathOf(filename: string): string {
  return path.relative(REPOSITORY_ROOT, filename).split(path.sep).join("/");
}

export const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts)$/u;

function isTestFile(relativePath: string): boolean {
  return /\.test\.(?:ts|tsx|mts)$/u.test(relativePath);
}

export function isAllowedFile(filename: string, allowed: ReadonlySet<string>): boolean {
  const relativePath = repositoryPathOf(filename);
  return (
    !TYPESCRIPT_SOURCE.test(relativePath) || isTestFile(relativePath) || allowed.has(relativePath)
  );
}
