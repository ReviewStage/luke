import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

export const KEPT_GUARD_RULE = "anti-slop/no-direct-view-storage";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DOOR_FILES: ReadonlySet<string> = new Set([
  "packages/panel/src/use-kept.ts",
  "packages/panel/src/kept-storage.ts",
]);

export function isDoorFile(repositoryPath: string): boolean {
  return DOOR_FILES.has(repositoryPath);
}

export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}

export const STORAGE_OBJECTS: ReadonlySet<string> = new Set(["localStorage", "sessionStorage"]);

export function isKeptStorageModule(source: unknown): boolean {
  return typeof source === "string" && /(?:^|\/)kept-storage(?:\.[cm]?[jt]s)?$/u.test(source);
}

const ReasonsSchema = Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString);

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

function readJson(name: string): string {
  return readFileSync(path.join(PLUGIN_DIRECTORY, name), "utf8");
}

export const NOT_VIEW_STORAGE: Readonly<Record<string, string>> = Schema.decodeUnknownSync(
  Schema.fromJsonString(ReasonsSchema),
)(readJson("kept-storage-allowed.json"));

export const KEPT_STORAGE_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readJson("kept-storage-baseline.json"));
