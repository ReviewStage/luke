import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { parseRetiredFile } from "../shared/retired.ts";
import { retiredRule, retiredRuleFor } from "./retired.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OWNER = path.join(
  REPOSITORY_ROOT,
  "packages/ui/src/components/retired-example/retired-example.tsx",
);
const PANEL = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/somewhere.tsx");
const HELD = "packages/panel/src/tasks/held.tsx";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

// The shipped example, `tools/anti-slop/retired/example.json`, read as the plugin reads it.
tester.run("retired (example.json)", retiredRule, {
  valid: [
    // The owner keeps what it owns.
    { code: '<div className="retired-example" />', filename: OWNER },
    { code: 'import { RetiredExampleIcon } from "@luke/ui/icons";', filename: OWNER },
    { code: 'import { x } from "retired-example";', filename: OWNER },
    // Other classes, glyphs, props and modules, and a class only sharing a start with a retired one.
    {
      code: 'import { BotIcon, GLYPH } from "@luke/ui/icons"; <div className="retired-examples x" data-a={GLYPH.TASK} retired={1} />;',
      filename: PANEL,
    },
    { code: 'import { x } from "retired-example-not";', filename: PANEL },
    // A retired word in prose is no class, nor a value compared against, a key, or another attribute's value.
    { code: "<p>the retired-example class</p>", filename: PANEL },
    { code: 'const label = "Drop the retired-example class.";', filename: PANEL },
    {
      code: 'const mode = "a"; <div className={mode === "retired-example" ? "new-a" : "new-b"} />;',
      filename: PANEL,
    },
    {
      code: 'const map = { "retired-example": 1 }; type T = "retired-example"; <div data-kind="retired-example" />;',
      filename: PANEL,
    },
    { code: '<div data-kind={"retired-example"} />;', filename: PANEL },
  ],
  invalid: [
    {
      code: '<div className="a retired-example" />',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    // A prefix entry, and a class string inside a call or a template.
    {
      code: 'const on = true; <div className={cn("a", on && "retired-example-part-head")} />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: `<div className={\`x \${y} retired-example\`} />`,
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    // A class kept in a constant or an object reaches the DOM all the same.
    {
      code: '<div className={"retired-example"} />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'const OLD = "retired-example"; <div className={OLD} />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'const CLASSES = { bar: "x retired-example-part-bar" };',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    // A glyph by any of Lucide's aliases, through the door or a namespace of it, and a concept off the registry.
    {
      code: 'import { LucideRetiredExample, RetiredExampleIcon as Mine } from "@luke/ui/icons";',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }],
    },
    {
      code: 'import * as icons from "@luke/ui/icons"; const A = icons.RetiredExample;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { GLYPH as G } from "@luke/ui/icons"; const a = G.RETIRED_EXAMPLE;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    // Drawn as a JSX member, once however many tags the element spells.
    {
      code: 'import { GLYPH as G } from "@luke/ui/icons"; <G.RETIRED_EXAMPLE></G.RETIRED_EXAMPLE>;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import * as icons from "@luke/ui/icons"; <icons.RetiredExampleIcon />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { RetiredExample } from "../icons/icons.js";',
      filename: path.join(REPOSITORY_ROOT, "packages/ui/src/components/other.tsx"),
      errors: [{ messageId: "retired" }],
    },
    // A banned prop, and a banned module or its subpath however it is reached.
    { code: "<Row retiredExample />", filename: PANEL, errors: [{ messageId: "retired" }] },
    {
      code: 'import "retired-example/sub"; export * from "retired-example"; await import("retired-example");',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }, { messageId: "retired" }],
    },
  ],
});

const baselined = retiredRuleFor(
  parseRetiredFile(
    "baselined.json",
    JSON.stringify({
      instead: "Use Thing.",
      classes: [{ class: "old-thing", allow: [], baseline: { [HELD]: 2 } }],
      patterns: [{ import: "old-lib", names: ["Old"], allow: [] }],
    }),
  ),
);
const HELD_FILE = path.join(REPOSITORY_ROOT, HELD);

tester.run("retired (baseline)", baselined, {
  valid: [
    // A file at exactly its baseline.
    { code: '<a className="old-thing" /> ; <b className="old-thing" />;', filename: HELD_FILE },
    // An import narrowed to names passes the module's other names, by name or off a namespace.
    { code: 'import { New } from "old-lib";', filename: PANEL },
    { code: 'import * as lib from "old-lib"; <lib.New />; lib.New;', filename: PANEL },
  ],
  invalid: [
    // One place past the baseline: the new one is reported.
    {
      code: '<a className="old-thing" />; <b className="old-thing" />; <i className="old-thing" />;',
      filename: HELD_FILE,
      errors: [{ messageId: "retired", line: 1, column: 71 }],
    },
    // Fewer places than the baseline: the count comes down with the fix.
    {
      code: '<a className="old-thing" />;',
      filename: HELD_FILE,
      errors: [{ messageId: "staleBaseline" }],
    },
    // A file the baseline does not name holds none.
    { code: '<a className="old-thing" />;', filename: PANEL, errors: [{ messageId: "retired" }] },
    {
      code: 'import { New, Old } from "old-lib";',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    // A narrowed name read off a namespace or a default import, and a way in that takes every name at once.
    {
      code: 'import * as lib from "old-lib"; import dflt from "old-lib"; <lib.Old />; dflt.Old;',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }],
    },
    {
      code: 'export * from "old-lib"; const lib = require("old-lib"); await import("old-lib/x");',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }, { messageId: "retired" }],
    },
  ],
});

// The ⋯ guard as shipped, `tools/anti-slop/retired/more-button.json`: only MoreButton draws a thing's ⋯.
const MORE_BUTTON = path.join(
  REPOSITORY_ROOT,
  "packages/ui/src/components/more-button/more-button.tsx",
);
const MENU_BAR = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/mobile-bar.tsx");
const moreButton = retiredRuleFor(
  parseRetiredFile(
    "more-button.json",
    readFileSync(path.join(REPOSITORY_ROOT, "tools/anti-slop/retired/more-button.json"), "utf8"),
  ),
);

tester.run("retired (more-button.json)", moreButton, {
  valid: [
    { code: 'import { GLYPH } from "@luke/ui/icons"; <GLYPH.MORE />;', filename: MORE_BUTTON },
    { code: 'import { BarItem, EllipsisIcon } from "@luke/ui";', filename: MENU_BAR },
    { code: 'import { MoreButton, PlusIcon } from "@luke/ui";', filename: PANEL },
    { code: 'import { GLYPH } from "@luke/ui/icons"; <GLYPH.TASK />;', filename: PANEL },
  ],
  invalid: [
    {
      code: 'import { GLYPH } from "@luke/ui/icons"; <IconButton icon={<GLYPH.MORE />} label="Actions" />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { EllipsisIcon } from "@luke/ui"; <IconButton icon={<EllipsisIcon />} label="Actions" />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { Ellipsis, MoreHorizontalIcon } from "@luke/ui/icons";',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }],
    },
  ],
});
