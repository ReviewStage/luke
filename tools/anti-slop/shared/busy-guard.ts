import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

export const BUSY_GUARD_RULE = "anti-slop/async-press-needs-busy";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BUSY_BUTTONS: ReadonlySet<string> = new Set([
  "Button",
  "IconButton",
  "SplitButton",
  "FoldingButton",
  "ProviderButton",
]);

export const PRESS_PROPS: ReadonlySet<string> = new Set(["onClick", "onPress"]);

export const BUSY_PROP = "busy";

export const ACT_CALLS: ReadonlySet<string> = new Set([
  "pressAct",
  "askAct",
  "askActResult",
  "press",
  "act",
  "updateSetting",
]);

export const PROMISE_CHAIN: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

export const HANDLER_HOOKS: ReadonlySet<string> = new Set(["useCallback", "useEffectEvent"]);

const UI_MODULE = /^@repo\/ui(?:\/|$)/u;
const UI_PACKAGE = "packages/ui/";

export function isUiModule(specifier: string, file: string): boolean {
  return UI_MODULE.test(specifier) || (file.startsWith(UI_PACKAGE) && specifier.startsWith("."));
}

export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

export const BUSY_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "busy-baseline.json"), "utf8"));
