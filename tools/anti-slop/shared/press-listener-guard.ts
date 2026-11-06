import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

export const PRESS_LISTENER_GUARD_RULE = "anti-slop/no-document-press-listener";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRESS_EVENTS: ReadonlySet<string> = new Set([
  "pointerdown",
  "mousedown",
  "touchstart",
  "click",
  "auxclick",
]);

export const WINDOW_GLOBALS: ReadonlySet<string> = new Set(["document", "window", "globalThis"]);
export const WINDOW_OF_ELEMENT: ReadonlySet<string> = new Set(["ownerDocument", "defaultView"]);

const UI_PACKAGE = "packages/ui/";

export function isUiFile(file: string): boolean {
  return file.startsWith(UI_PACKAGE);
}

export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

export const PRESS_LISTENER_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "press-listener-baseline.json"), "utf8"));
