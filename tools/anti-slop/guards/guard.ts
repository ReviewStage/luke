import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RepositoryGuard {
  readonly holds: string;
  readonly problems: (root: string) => Promise<readonly string[]>;
}

export async function loadModule(root: string, file: string): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(pathToFileURL(path.join(root, file)).href);
  if (loaded === null || typeof loaded !== "object") throw new Error(`${file} loaded no module`);
  return loaded as Record<string, unknown>;
}

export function readText(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

export function readJson(root: string, file: string): Record<string, unknown> {
  return record(JSON.parse(readText(root, file)), file);
}

export function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} is not a string`);
  return value;
}

export function texts(value: unknown, where: string): readonly string[] {
  if (value === null || typeof value !== "object" || !(Symbol.iterator in value)) {
    throw new Error(`${where} is not a list`);
  }
  return [...(value as Iterable<unknown>)].map((item) => text(item, where));
}

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
