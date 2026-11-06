import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LUCIDE_GUARD_RULE = "anti-slop/no-lucide-outside-door";

const DOOR_DIRECTORY = "packages/ui/src/icons/";

const BASELINE_FILE = path.join(PLUGIN_DIRECTORY, "lucide-baseline.json");

export function isLucideModule(specifier: unknown): boolean {
  return typeof specifier === "string" && /^lucide-react(?:\/|$)/u.test(specifier);
}

export function isDoorFile(repositoryPath: string): boolean {
  return repositoryPath.startsWith(DOOR_DIRECTORY);
}

export function parseBaseline(text: string): ReadonlyMap<string, number> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("lucide-baseline.json must hold an object of repository paths and counts");
  }
  const counts = new Map<string, number>();
  for (const [file, count] of Object.entries(parsed)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new Error(
        `lucide-baseline.json's "${file}" must be a whole number of imports, 1 or more`,
      );
    }
    counts.set(file, count);
  }
  return counts;
}

export const LUCIDE_BASELINE: ReadonlyMap<string, number> = parseBaseline(
  readFileSync(BASELINE_FILE, "utf8"),
);
