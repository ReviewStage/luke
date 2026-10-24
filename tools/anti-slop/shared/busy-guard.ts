import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

/**
 * busy-guard.ts -- what the `async-press-needs-busy` rule reads: which
 * `@luke/ui` components are buttons that take `busy`, the props that carry
 * their press, the calls that start an act, and the baseline of files that
 * still hold a press without it. Every kind of button is busy one way
 * (`BusyProps`), and a press that waits on the server shows it.
 */
export const BUSY_GUARD_RULE = "anti-slop/async-press-needs-busy";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The `@luke/ui` buttons that take `busy` and `busyLabel`, by the name they are exported under. */
export const BUSY_BUTTONS: ReadonlySet<string> = new Set([
  "Button",
  "IconButton",
  "SplitButton",
  "FoldingButton",
  "ProviderButton",
]);

/** The props a busy button hears its press by: `onClick`, and a provider's `onPress`. */
export const PRESS_PROPS: ReadonlySet<string> = new Set(["onClick", "onPress"]);

/** The prop that says a button is busy. */
export const BUSY_PROP = "busy";

/**
 * Calls that answer a promise for an act: `pressAct`, `askAct` and
 * `askActResult` by name, and what `useAct()` hands out (`press`, `act`,
 * `updateSetting`), called bare once destructured or off the handle.
 */
export const ACT_CALLS: ReadonlySet<string> = new Set([
  "pressAct",
  "askAct",
  "askActResult",
  "press",
  "act",
  "updateSetting",
]);

/** The methods a promise is chained with. */
export const PROMISE_CHAIN: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

/** Hooks that hand back the function they are given, so a handler held by one is the function. */
export const HANDLER_HOOKS: ReadonlySet<string> = new Set(["useCallback", "useEffectEvent"]);

/** The package a button is imported from, and what a relative import means inside it. */
const UI_MODULE = /^@luke\/ui(?:\/|$)/u;
const UI_PACKAGE = "packages/ui/";

/** Whether `specifier`, imported by the file at `file`, reaches `@luke/ui`. */
export function isUiModule(specifier: string, file: string): boolean {
  return UI_MODULE.test(specifier) || (file.startsWith(UI_PACKAGE) && specifier.startsWith("."));
}

/** A test draws its buttons for what they do, so the rule leaves it be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

/**
 * The files that still draw a busy-able button with an async press and no
 * `busy`, each with how many. It only shrinks (`shared/baseline.ts`): a file
 * holding more fails, and so does one holding fewer until its count is lowered.
 */
export const BUSY_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "busy-baseline.json"), "utf8"));
