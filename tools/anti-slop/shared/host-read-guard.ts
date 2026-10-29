import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { TYPESCRIPT_SOURCE } from "./effect-edges.ts";
import { isTestFile } from "./kept-guard.ts";

/**
 * host-read-guard.ts -- what the `no-follow-outside-host-read` rule reads:
 * the one module a surface reads server data through, the kinds that read
 * it otherwise, and the files not yet moved, each with its migration step.
 */
export const HOST_READ_GUARD_RULE = "anti-slop/no-follow-outside-host-read";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The hook every surface reads server data through, the one module that may open a follow. */
const HOOK_FILE = "packages/panel/src/use-host-read.ts";

/** The panel's own code, which the rule watches; a test, and what tests share, stand in for the host and are left be. */
export function isWatchedPanelSource(file: string): boolean {
  return (
    file.startsWith("packages/panel/src/") &&
    TYPESCRIPT_SOURCE.test(file) &&
    !isTestFile(file) &&
    file !== HOOK_FILE
  );
}

/** The helpers that hold a follow open on the window's act port. */
export const FOLLOW_OPENERS: ReadonlySet<string> = new Set(["streamFrom", "followStream"]);

/** The kinds a surface reads server data by that are not named `*_FOLLOW`: the streamed ones, and `AGENTS_LIST`, whose rows the task list's `liveAgents` carries. */
const UNNAMED_FOLLOWS: ReadonlySet<string> = new Set([
  "AGENTS_TRANSCRIPT",
  "WORKSPACE_PEOPLE",
  "WORKSPACE_INVITATIONS",
  "AGENTS_LIST",
]);

/** Whether an act kind is one a surface reads server data by outside `useHostRead`. */
export function isFollowKind(name: string): boolean {
  return name.endsWith("_FOLLOW") || UNNAMED_FOLLOWS.has(name);
}

const StepsSchema = Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString);

/**
 * The files that still open a follow, each with the migration step that
 * moves it onto `useHostRead` (STAG-715's plan). A file here may open one; a
 * file that opens none fails, so the list only shrinks, and the step that
 * moves the last of them deletes it.
 */
export const UNMIGRATED_FOLLOWS: Readonly<Record<string, string>> = Schema.decodeUnknownSync(
  Schema.fromJsonString(StepsSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "follows-unmigrated.json"), "utf8"));
