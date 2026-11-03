import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { ACT_USE, PORT_ACT_USE } from "../../../packages/host/src/contract/kinds.ts";
import { TYPESCRIPT_SOURCE } from "./effect-edges.ts";
import { isTestFile } from "./kept-guard.ts";

/**
 * host-read-guard.ts -- what the `no-follow-outside-host-read` rule reads:
 * the one module a surface reads server data through, the kinds that read
 * it, as `@repo/host`'s `PORT_ACT_USE` declares them, and the files not yet
 * moved, each with the child that moves it.
 */
export const HOST_READ_GUARD_RULE = "anti-slop/no-follow-outside-host-read";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The hook every surface reads server data through, the one module that may open a read. */
const HOOK_FILE = "packages/panel/src/use-host-read.ts";

/** The panel's and the design system's own code, which the rule watches; a test, and what tests share, stand in for the host and are left be. */
export function isWatchedSource(file: string): boolean {
  return (
    (file.startsWith("packages/panel/src/") || file.startsWith("packages/ui/src/")) &&
    TYPESCRIPT_SOURCE.test(file) &&
    !isTestFile(file) &&
    file !== HOOK_FILE
  );
}

/** The helpers that hold a follow open on the window's act port. */
export const FOLLOW_OPENERS: ReadonlySet<string> = new Set(["streamFrom", "followStream"]);

/** The kinds whose answer can change while a surface shows it, by the name a call site spells. */
const READ_KINDS: ReadonlySet<string> = new Set(
  Object.entries(PORT_ACT_USE)
    .filter(([, use]) => use === ACT_USE.READ)
    .map(([name]) => name),
);

/** Whether an act kind reads data a surface shows, which only `useHostRead` may ask. */
export function isReadKind(name: string): boolean {
  return READ_KINDS.has(name);
}

const StepsSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.String.check(Schema.isPattern(/^P\d+(?:, P\d+)*: \S/u)),
);

/**
 * The files that still read outside `useHostRead`, each with the children
 * of the rollout that move it, as `P5: plan comments`. A file here may read;
 * a file that reads nothing fails, so the list only shrinks: each child
 * takes its number out of a row, and the last child a row names deletes it.
 */
export const UNMIGRATED_READS: Readonly<Record<string, string>> = Schema.decodeUnknownSync(
  Schema.fromJsonString(StepsSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "reads-unmigrated.json"), "utf8"));
