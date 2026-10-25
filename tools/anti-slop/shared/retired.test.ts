import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { configWeakensGuard, guardSuppressionLines } from "./press-guard.ts";
import {
  namesRetired,
  parseRetiredFile,
  RETIRED,
  RETIRED_GUARD_RULE,
  readRetired,
  retiredCssPlaces,
} from "./retired.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const VALID = { instead: "Use Thing.", classes: [{ class: "old-thing", allow: ["packages/ui/"] }] };

describe("a retired file", () => {
  it("reads a well-formed file into its retirements", () => {
    const [retirement] = parseRetiredFile("thing.json", JSON.stringify(VALID));
    expect(retirement).toMatchObject({ kind: "class", name: "old-thing", file: "thing.json" });
  });

  it.each([
    ["no JSON", "{ classes: [] "],
    ["no `instead`", JSON.stringify({ classes: [] })],
    ["a field the schema does not know", JSON.stringify({ ...VALID, colours: [] })],
    ["an entry missing its `allow`", JSON.stringify({ instead: "x", glyphs: [{ glyph: "Bot" }] })],
    [
      "a misspelt entry field",
      JSON.stringify({ instead: "x", patterns: [{ props: "a", allow: [] }] }),
    ],
    [
      "a baseline count below 1",
      JSON.stringify({
        instead: "x",
        classes: [{ class: "a", allow: [], baseline: { "a.tsx": 0 } }],
      }),
    ],
  ])("fails loudly on %s, naming the file", (_, text) => {
    expect(() => parseRetiredFile("broken.json", text)).toThrow(/retired\/broken\.json/u);
  });

  describe("in a folder", () => {
    let folder = "";
    afterEach(() => rmSync(folder, { recursive: true, force: true }));

    it("fails the whole read on one malformed file", () => {
      folder = mkdtempSync(path.join(tmpdir(), "retired-"));
      writeFileSync(path.join(folder, "good.json"), JSON.stringify(VALID));
      writeFileSync(path.join(folder, "bad.json"), JSON.stringify({ instead: "" }));
      writeFileSync(path.join(folder, "README.md"), "# not read");
      expect(() => readRetired(folder)).toThrow(/bad\.json/u);
    });
  });
});

describe("the retired files", () => {
  it("baseline only files that exist, since the rule reads the files it lints and a deleted one leaves its row behind", () => {
    const missing = RETIRED.flatMap((retirement) => Object.keys(retirement.baseline)).filter(
      (file) => !existsSync(path.join(REPOSITORY_ROOT, file)),
    );
    expect(missing).toEqual([]);
  });
});

describe("retiredCssPlaces", () => {
  const sheet = [
    ".panel .retired-example:hover,",
    ".other { color: red; }",
    "@media (width > 1.5rem) {",
    "  .wrap > :not(.retired-example-part-head) { content: '.retired-example'; }",
    "}",
    '[class~="retired-example"] { margin: 0; }',
  ].join("\n");

  it("finds a retired class in a selector, nested or under a pseudo-class, with its line", () => {
    const places = retiredCssPlaces("packages/panel/src/styles/tasks.css", sheet);
    expect(places.map((place) => [place.retirement.name, place.line])).toEqual([
      ["retired-example", 1],
      ["retired-example-part-*", 4],
    ]);
  });

  it("passes the paths an entry allows", () => {
    const owner = "packages/ui/src/components/retired-example/retired-example.css";
    expect(
      retiredCssPlaces(owner, ".retired-example {}").map((place) => place.retirement.name),
    ).toEqual([]);
  });
});

describe("the suppression check", () => {
  const holding = { rules: { [RETIRED_GUARD_RULE]: "error" } };

  it("refuses a disable comment in a file that spells a retired name", () => {
    const text = [
      `// oxlint-disable-next-line ${RETIRED_GUARD_RULE} -- just this once`,
      '<div className="retired-example" />',
    ].join("\n");
    expect(namesRetired(text)).toBe(true);
    expect(guardSuppressionLines(text, RETIRED_GUARD_RULE)).toEqual([1]);
  });

  it("refuses a glyph's file by its bare name, whichever alias it spells", () => {
    expect(namesRetired('import { LucideRetiredExample } from "@luke/ui/icons";')).toBe(true);
    expect(namesRetired("const a = G.RETIRED_EXAMPLE;")).toBe(true);
    expect(namesRetired('import { BotIcon } from "@luke/ui/icons";')).toBe(false);
    // An import narrowed to names is spelled by them, not by its module, which every file spells.
    expect(namesRetired('import { BackIcon } from "@luke/ui";')).toBe(true);
    expect(namesRetired('import { Button } from "@luke/ui";')).toBe(false);
  });

  it("refuses a configuration that turns the rule down or overrides it", () => {
    expect(configWeakensGuard(holding, RETIRED_GUARD_RULE)).toBeUndefined();
    expect(configWeakensGuard({ rules: {} }, RETIRED_GUARD_RULE)).toBeDefined();
    expect(
      configWeakensGuard(
        { ...holding, overrides: [{ files: ["**"], rules: { [RETIRED_GUARD_RULE]: "off" } }] },
        RETIRED_GUARD_RULE,
      ),
    ).toBeDefined();
  });
});
