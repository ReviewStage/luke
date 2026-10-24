import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

/**
 * kept-guard.ts -- what the `no-direct-view-storage` rule reads: the files
 * that are the one door a view choice is stored through, the files that keep
 * storage that is no view choice (each with its reason), and the baseline of
 * files that still keep a view choice by hand. A fold, a filter, a sort, a
 * view mode, a width or where a list stood scrolled is read and written
 * through `useKept` (`packages/panel/src/use-kept.ts`) and never through the
 * window's storage directly.
 */
export const KEPT_GUARD_RULE = "anti-slop/no-direct-view-storage";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The hook, and the storage it reads and writes through: the only files that touch the window's storage for a view choice. */
const DOOR_FILES: ReadonlySet<string> = new Set([
  "packages/panel/src/use-kept.ts",
  "packages/panel/src/kept-storage.ts",
]);

export function isDoorFile(repositoryPath: string): boolean {
  return DOOR_FILES.has(repositoryPath);
}

/** A test, and what a test shares, seeds and reads storage to drive a surface, so the rule leaves it be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}

/** The storage objects a view choice must not be kept in by hand. */
export const STORAGE_OBJECTS: ReadonlySet<string> = new Set(["localStorage", "sessionStorage"]);

/** The module of the helpers `useKept` is built on, which only `useKept` and storage that is no view choice may import. */
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

/**
 * The files that keep storage that is no view choice, each with the one line
 * that says what it keeps: a draft, a credential's handling, a cache, a read
 * mark, a notice's memory. A file here may touch storage as it likes; one
 * that no longer touches any fails, so the list is only ever what stands.
 */
export const NOT_VIEW_STORAGE: Readonly<Record<string, string>> = Schema.decodeUnknownSync(
  Schema.fromJsonString(ReasonsSchema),
)(readJson("kept-storage-allowed.json"));

/**
 * The files that still keep a view choice by hand, each with how many places
 * they touch storage. It only shrinks (`shared/baseline.ts`).
 */
export const KEPT_STORAGE_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readJson("kept-storage-baseline.json"));
