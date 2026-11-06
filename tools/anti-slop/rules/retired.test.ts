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

tester.run("retired (example.json)", retiredRule, {
  valid: [
    { code: '<div className="retired-example" />', filename: OWNER },
    { code: 'import { RetiredExampleIcon } from "@repo/ui/icons";', filename: OWNER },
    { code: 'import { x } from "retired-example";', filename: OWNER },
    {
      code: 'import { BotIcon, GLYPH } from "@repo/ui/icons"; <div className="retired-examples x" data-a={GLYPH.TASK} retired={1} />;',
      filename: PANEL,
    },
    { code: 'import { x } from "retired-example-not";', filename: PANEL },
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
    {
      code: 'import { LucideRetiredExample, RetiredExampleIcon as Mine } from "@repo/ui/icons";',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }],
    },
    {
      code: 'import * as icons from "@repo/ui/icons"; const A = icons.RetiredExample;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { GLYPH as G } from "@repo/ui/icons"; const a = G.RETIRED_EXAMPLE;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { GLYPH as G } from "@repo/ui/icons"; <G.RETIRED_EXAMPLE></G.RETIRED_EXAMPLE>;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import * as icons from "@repo/ui/icons"; <icons.RetiredExampleIcon />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { RetiredExample } from "../icons/icons.js";',
      filename: path.join(REPOSITORY_ROOT, "packages/ui/src/components/other.tsx"),
      errors: [{ messageId: "retired" }],
    },
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
    { code: '<a className="old-thing" /> ; <b className="old-thing" />;', filename: HELD_FILE },
    { code: 'import { New } from "old-lib";', filename: PANEL },
    { code: 'import * as lib from "old-lib"; <lib.New />; lib.New;', filename: PANEL },
  ],
  invalid: [
    {
      code: '<a className="old-thing" />; <b className="old-thing" />; <i className="old-thing" />;',
      filename: HELD_FILE,
      errors: [{ messageId: "retired", line: 1, column: 71 }],
    },
    {
      code: '<a className="old-thing" />;',
      filename: HELD_FILE,
      errors: [{ messageId: "staleBaseline" }],
    },
    { code: '<a className="old-thing" />;', filename: PANEL, errors: [{ messageId: "retired" }] },
    {
      code: 'import { New, Old } from "old-lib";',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
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
    { code: 'import { GLYPH } from "@repo/ui/icons"; <GLYPH.MORE />;', filename: MORE_BUTTON },
    { code: 'import { BarItem, EllipsisIcon } from "@repo/ui";', filename: MENU_BAR },
    { code: 'import { MoreButton, PlusIcon } from "@repo/ui";', filename: PANEL },
    { code: 'import { GLYPH } from "@repo/ui/icons"; <GLYPH.TASK />;', filename: PANEL },
  ],
  invalid: [
    {
      code: 'import { GLYPH } from "@repo/ui/icons"; <IconButton icon={<GLYPH.MORE />} label="Actions" />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { EllipsisIcon } from "@repo/ui"; <IconButton icon={<EllipsisIcon />} label="Actions" />;',
      filename: PANEL,
      errors: [{ messageId: "retired" }],
    },
    {
      code: 'import { Ellipsis, MoreHorizontalIcon } from "@repo/ui/icons";',
      filename: PANEL,
      errors: [{ messageId: "retired" }, { messageId: "retired" }],
    },
  ],
});
