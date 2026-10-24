import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";

/**
 * press-listener-guard.ts -- what the `no-document-press-listener` rule
 * reads: the presses a document or window may not listen for outside
 * `@luke/ui`, the one place a press anywhere in the window is heard
 * (`usePressAway`), and the baseline of files that still listen for one. A
 * popover, menu or card closes on a press outside it through the layer it
 * hangs from (`AnchoredPopover`, `RectFloat`) and never a listener of its own.
 */
export const PRESS_LISTENER_GUARD_RULE = "anti-slop/no-document-press-listener";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The events a press is heard by: a document-wide listener for one is a click-away of its own. */
export const PRESS_EVENTS: ReadonlySet<string> = new Set([
  "pointerdown",
  "mousedown",
  "touchstart",
  "click",
  "auxclick",
]);

/** What a listener hangs on that hears the whole window: the globals, and an element's own document or view. */
export const WINDOW_GLOBALS: ReadonlySet<string> = new Set(["document", "window", "globalThis"]);
export const WINDOW_OF_ELEMENT: ReadonlySet<string> = new Set(["ownerDocument", "defaultView"]);

/** The one place that listens for a press anywhere. */
const UI_PACKAGE = "packages/ui/";

export function isUiFile(file: string): boolean {
  return file.startsWith(UI_PACKAGE);
}

/** A test drives a press by dispatching it, so the rule leaves it be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file);
}

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

/**
 * The files that still listen for a press at the document or the window,
 * each with how many: listeners that follow a press rather than close
 * something on one (a modality flag, a press counter, a drag's state), and
 * panes and drawers that are no popover. It only shrinks (`shared/baseline.ts`).
 */
export const PRESS_LISTENER_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "press-listener-baseline.json"), "utf8"));
