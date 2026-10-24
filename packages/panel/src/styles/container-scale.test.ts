import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * container-scale.test.ts -- every width a container query reads is written `width < N`, on the one scale or said to be off it.
 *
 * `max-width: 639px` beside `min-width: 640px` leaves a fractional width
 * between them that neither matches, so each query is a range on the
 * container's width, `width < N` or `width >= N`, from 240, 360, 480, 640,
 * 720, and 880 pixels. A width that is not on the scale is kept where moving
 * it would shift a layout by more than a few pixels, and the line above it
 * says `off-scale:` and why. Read from the sheets themselves, `@luke/ui`'s and
 * the panel's.
 */

const SCALE = [240, 360, 480, 640, 720, 880];

/** The `src` folders whose sheets are read. */
const SOURCES = ["../../../ui/src", ".."].map((from) =>
  join(dirname(fileURLToPath(import.meta.url)), from),
);

/** Every stylesheet under a folder. */
function sheets(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".css"))
    .map((name) => join(folder, name));
}

/** Each container query on a width, with the line before it and where it stands. */
function widthQueries(file: string) {
  const lines = readFileSync(file, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    const query = /^\s*@container\b[^{(]*(\((?:max-width|min-width|width)\b[^)]*\))/.exec(line);
    if (query === null) return [];
    return [
      { at: `${file}:${index + 1}`, condition: query[1] ?? "", before: lines[index - 1] ?? "" },
    ];
  });
}

test("a container query reads its width as a range", () => {
  const queries = SOURCES.flatMap(sheets).flatMap(widthQueries);
  assert.ok(queries.length > 50, "the queries were found");
  for (const { at, condition } of queries) {
    assert.match(condition, /^\(width (?:<|<=|>=) \d+px\)$/, `${at} writes ${condition}`);
  }
});

test("a container query's width is on the scale or its line before says why not", () => {
  for (const { at, condition, before } of SOURCES.flatMap(sheets).flatMap(widthQueries)) {
    const width = Number(/(\d+)px/.exec(condition)?.[1]);
    assert.ok(
      SCALE.includes(width) || before.includes("off-scale:"),
      `${at} reads ${width}px, off the scale, with no off-scale: line above it`,
    );
  }
});
