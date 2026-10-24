import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { SELECTABLE_SURFACE } from "./selectable-list.js";

/**
 * selectable-lists.test.ts -- a list cannot opt into selection without the
 * shared contract running on it (`selectable-list.ts`). The surfaces are
 * found by reading the source tree for what opts in, a `selection` passed
 * to a `List` or a `SelectionRegion` stood over a page's own rows, so
 * there is no list here to forget a surface in; what `SELECTABLE_SURFACE`
 * names is the source and the test that runs the contract on it, and each
 * must still be so.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The workspaces that draw the app's surfaces. */
const WORKSPACES = ["packages", "apps"];

/** Folders that hold no source of ours. */
const SKIPPED = new Set(["node_modules", "dist", "build", ".turbo"]);

/** The model's own home, where `selection` is declared rather than passed. */
const MODEL = "packages/ui/src/";

/** What opts a file into selection: a `selection={…}` prop, or a `<SelectionRegion` standing over rows. */
const OPTS_IN = /\bselection=\{|<SelectionRegion\b/u;

/** Every source file under `folder`, as a path from the repository's root. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(path.join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourcesUnder(relative);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [relative] : [];
  });
}

/** `file`'s text with its comments taken out, so a name only a comment mentions does not count. */
function codeOf(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

/** The source files, outside the model's own home, that opt into selection. */
function surfacesFound(): string[] {
  return WORKSPACES.flatMap(sourcesUnder)
    .filter((file) => !file.startsWith(MODEL))
    .filter((file) => OPTS_IN.test(codeOf(file)))
    .sort();
}

test("every file that opts into selection is a surface the contract runs on, and each named is still one", () => {
  const named = Object.values(SELECTABLE_SURFACE)
    .map((surface) => surface.source)
    .sort();
  expect(surfacesFound()).toEqual(named);
});

test("each surface has a test that runs the contract on it", () => {
  for (const [name, surface] of Object.entries(SELECTABLE_SURFACE)) {
    const test = codeOf(surface.test);
    assert.match(
      test,
      new RegExp(`selectableListBehaviour\\(\\s*"${name}"`, "u"),
      `${surface.test} runs the contract as ${name}`,
    );
  }
});
