import { describe, expect, it } from "vitest";

import { catalogProblems, componentsOf, drawnFrom, exportedValues } from "./catalog-examples.ts";
import { moduleRecord } from "./module-graph.ts";

const BARREL: Readonly<Record<string, string>> = {
  "index.ts":
    'export * from "./button.js";\nexport { Tip as Tooltip, type TipProps } from "./tip.js";',
  "button.tsx":
    "export function Button() {}\nexport const BUTTON_LOOK = {};\nexport type ButtonProps = {};\nexport function useBusy() {}\nexport const SaveIcon = () => null;",
  "tip.tsx": "export function Tip() {}\nexport type TipProps = {};",
};

describe("the catalog's coverage of @luke/ui", () => {
  it("reads a barrel's components through its re-exports, leaving constants, hooks, types, and glyphs", () => {
    const names = exportedValues(
      "index.ts",
      (file) => moduleRecord(file, BARREL[file] ?? ""),
      (_, specifier) => specifier.replace("./", "").replace(".js", ".tsx"),
    );
    expect(componentsOf(names)).toEqual(["Button", "Tooltip"]);
  });

  it("counts a component drawn as JSX or handed on as a value, and not one only imported", () => {
    const example = moduleRecord(
      "example.tsx",
      'import { Button, Card, Chip, type Look } from "@luke/ui";\nconst sections = [Card];\nexport const Render = () => <Button />;',
    );
    expect([...drawnFrom(example)].sort()).toEqual(["Button", "Card"]);
  });

  it("names a component nothing draws or exempts, and an exemption that no longer stands", () => {
    const problems = catalogProblems(["Button", "Chip", "Tip"], new Set(["Button", "Tip"]), {
      notAComponent: ["Gone"],
      awaitingAnExample: ["Tip"],
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^Chip: no example/u);
    expect(problems.slice(1).join("\n")).toMatch(/Gone is gone[\s\S]*Tip is gone/u);
  });
});
