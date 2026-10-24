import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

/**
 * arrow-key-guard.ts -- what the `no-hand-written-arrow-keys` rule reads: the
 * keys that step a list, the files outside `@luke/ui` that may still match
 * them (each with its reason), and the baseline of files that still step a
 * list by hand. A list or menu is stepped by `useRovingKeys` and `List`
 * (`@luke/ui`), never a handler that matches `ArrowDown` itself.
 */
export const ARROW_KEY_GUARD_RULE = "anti-slop/no-hand-written-arrow-keys";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The keys that move a list's focus or highlight: a hand-written match for any of them is the walk written again. */
export const ARROW_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

/** Where a key's name is read off an event: `event.key`, `event.code`, or a local bound to one. */
export const KEY_PROPERTIES: ReadonlySet<string> = new Set(["key", "code"]);

/** A file's text names one of the arrow keys as a string, which is all the suppression check needs to know to watch it. */
export const NAMES_ARROW_KEY = /["'`](?:Arrow(?:Up|Down|Left|Right)|Home|End)["'`]/u;

const NonEmpty = Schema.NonEmptyString;

const ArrowKeysFileSchema = Schema.Struct({
  exempt: Schema.Array(Schema.Struct({ path: NonEmpty, reason: NonEmpty })),
  baseline: Schema.Record(NonEmpty, Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});

const ARROW_KEYS_FILE = Schema.decodeUnknownSync(Schema.fromJsonString(ArrowKeysFileSchema), {
  onExcessProperty: "error",
})(readFileSync(path.join(PLUGIN_DIRECTORY, "arrow-keys.json"), "utf8"));

/**
 * The paths (prefixes from the repository's root) that need the raw arrow
 * keys for a purpose of their own, a caret, a cursor, a date or a pty, each
 * with why: not one of them steps a list.
 */
export const ARROW_KEY_EXEMPTIONS: readonly string[] = ARROW_KEYS_FILE.exempt.map(
  (entry) => entry.path,
);

/** The files that still step a list by hand, each with how many places. It only shrinks (`shared/baseline.ts`). */
export const ARROW_KEY_BASELINE: Baseline = ARROW_KEYS_FILE.baseline;

/** The one package that writes the walk. */
const UI_PACKAGE = "packages/ui/";

export function isUiFile(file: string): boolean {
  return file.startsWith(UI_PACKAGE);
}

/** A test drives a key by dispatching it, so the rule leaves it be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

export function isExempt(file: string): boolean {
  return ARROW_KEY_EXEMPTIONS.some((prefix) => file.startsWith(prefix));
}
