import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * guard.ts -- what a repository guard is, and the reads every guard shares.
 *
 * A repository guard holds a rule about the repository's state that a lint
 * rule cannot see, since oxlint reads one file at a time and none of
 * `package.json`, `node_modules`, a directory listing, HTML or CSS:
 * `repository-guard.ts` runs each one from `scripts/repository-checks.sh`.
 * Each guard's comparison is a pure function its own test drives with drifted
 * values; its `problems` reads the repository and hands them on.
 */

export interface RepositoryGuard {
  /** What the guard holds, in a line, said when it fails. */
  readonly holds: string;
  /** Each way the repository breaks the rule, as a line naming where; none when it holds. */
  readonly problems: (root: string) => Promise<readonly string[]>;
}

/** A module of the repository, evaluated under the tsx loader the runner starts with. */
export async function loadModule(root: string, file: string): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(pathToFileURL(path.join(root, file)).href);
  if (loaded === null || typeof loaded !== "object") throw new Error(`${file} loaded no module`);
  return loaded as Record<string, unknown>;
}

/** A file of the repository as text. */
export function readText(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

/** A JSON file of the repository as an object. */
export function readJson(root: string, file: string): Record<string, unknown> {
  return record(JSON.parse(readText(root, file)), file);
}

/** `value` as an object, or a throw naming where it was read. */
export function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

/** `value` as a string, or a throw naming where it was read. */
export function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} is not a string`);
  return value;
}

/** `value` as a list of strings, any iterable of them, or a throw naming where it was read. */
export function texts(value: unknown, where: string): readonly string[] {
  if (value === null || typeof value !== "object" || !(Symbol.iterator in value)) {
    throw new Error(`${where} is not a list`);
  }
  return [...(value as Iterable<unknown>)].map((item) => text(item, where));
}

/** What one list names and the other does not, each way, as problem lines. */
export function setDrift(
  label: string,
  found: readonly string[],
  expected: readonly string[],
): readonly string[] {
  const wanted = new Set(expected);
  const present = new Set(found);
  return [
    ...[...present]
      .filter((name) => !wanted.has(name))
      .map((name) => `${label}: ${name} is not expected`),
    ...[...wanted]
      .filter((name) => !present.has(name))
      .map((name) => `${label}: ${name} is missing`),
  ].sort();
}
