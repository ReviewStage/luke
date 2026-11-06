import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

export const ARROW_KEY_GUARD_RULE = "anti-slop/no-hand-written-arrow-keys";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ARROW_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export const SHORTCUT_KEY_REGISTRY = "SHORTCUT_KEY";
export const SHORTCUT_ARROW_NAMES: ReadonlySet<string> = new Set([
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "HOME",
  "END",
]);

export const KEY_PROPERTIES: ReadonlySet<string> = new Set(["key", "code"]);

export const NAMES_ARROW_KEY = /["'`](?:Arrow(?:Up|Down|Left|Right)|Home|End)["'`]/u;

const NonEmpty = Schema.NonEmptyString;

const ArrowKeysFileSchema = Schema.Struct({
  exempt: Schema.Array(Schema.Struct({ path: NonEmpty, reason: NonEmpty })),
  baseline: Schema.Record(NonEmpty, Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});

const ARROW_KEYS_FILE = Schema.decodeUnknownSync(Schema.fromJsonString(ArrowKeysFileSchema), {
  onExcessProperty: "error",
})(readFileSync(path.join(PLUGIN_DIRECTORY, "arrow-keys.json"), "utf8"));

export const ARROW_KEY_EXEMPTIONS: readonly string[] = ARROW_KEYS_FILE.exempt.map(
  (entry) => entry.path,
);

export const ARROW_KEY_BASELINE: Baseline = ARROW_KEYS_FILE.baseline;

const UI_PACKAGE = "packages/ui/";

export function isUiFile(file: string): boolean {
  return file.startsWith(UI_PACKAGE);
}

export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

export function isExempt(file: string): boolean {
  return ARROW_KEY_EXEMPTIONS.some((prefix) => file.startsWith(prefix));
}
